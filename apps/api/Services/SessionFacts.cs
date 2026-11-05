using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Services;

/// <summary>
/// الوقت الفعلي داخل الغرفة — المصدر الوحيد للساعات والحضور في كل الأسطح.
///
/// السبب: كل رقم «ساعات» في المنصة كان يُحسب من <c>durationMin</c> (المدة
/// المكتوبة في الجدول) لا من الزمن الذي قُضِّي فعلًا في اللايف، وكانت الشاشات
/// المختلفة تجمع من مصادر وفتحات مختلفة فتخرج بأرقام لا تتطابق لنفس الطالبة
/// (روان عصام: 1.5 في الرئيسية و3.2 في شاشة الطلاب — نفس الحصص، مصدران).
///
/// الأرقام كلها تُشتَق الآن من <see cref="EduSessionPresence"/> (قسم 12 في
/// schema.sql): مجموع أشرطة الدخول لكل حساب. وبما أن القاعدة الحالية فيها حصص
/// مكتملة من قبل هذا الجدول، فسلسلة البدائل **ثابتة ومحددة** وإلا رجعت
/// الشاشات تختلف من جديد:
///   1) أشرطة الحضور الفعلية — أدق ما يكون، وهي المُسجَّل من الآن فصاعدًا.
///   2) <c>metadata.durationMinutes</c> — الزمن الذي أرسلته شاشة الفصل عند الإنهاء.
///   3) <c>endsAt − joinedAt</c> — إن لم يُرسل شيء.
///   4) <c>durationMin</c> — الحصة التي لم تُعقد أصلًا أو الأقدم من كله.
/// </summary>
public sealed class SessionFacts
{
    private sealed record Totals(double ClosedMinutes, DateTime? OpenSince)
    {
        public double MinutesAt(DateTime nowUtc) =>
            ClosedMinutes + (OpenSince is { } since ? Math.Max(0, (nowUtc - since).TotalMinutes) : 0);
    }

    private readonly Dictionary<(long sessionId, string kind, long accountId), Totals> _segments;
    private readonly Dictionary<(long sessionId, long studentId), string> _attendanceMarks;

    /// <summary>
    /// معرّفات الحساب في جداول مختلفة (<c>Edu_Users</c> و<c>Edu_Students</c>)
    /// تتكرر الأرقام بينها عمدًا، فـ <c>kind</c> جزء من المفتاح — بدونه تُنسَب
    /// دقائق طالب إلى مدرس بنفس الـ id.
    /// </summary>
    public static async Task<SessionFacts> LoadAsync(EduDbContext db, ICollection<long> sessionIds, CancellationToken ct = default)
    {
        var segments = new Dictionary<(long, string, long), Totals>();
        if (sessionIds.Count > 0)
        {
            var rows = await db.SessionPresences.AsNoTracking()
                .Where(p => sessionIds.Contains(p.SessionId))
                .Select(p => new { p.SessionId, p.AccountKind, p.AccountId, p.JoinedAt, p.LeftAt, p.DurationMs })
                .ToListAsync(ct);

            foreach (var group in rows.GroupBy(r => (r.SessionId, r.AccountKind, r.AccountId)))
            {
                double closed = 0;
                DateTime? open = null;
                foreach (var row in group)
                {
                    if (row.LeftAt is null) open = row.JoinedAt;
                    else closed += Math.Max(0, row.DurationMs) / 60_000.0;
                }
                segments[group.Key] = new Totals(closed, open);
            }
        }

        var marks = new Dictionary<(long, long), string>();
        if (sessionIds.Count > 0)
        {
            var attendanceRows = await db.SessionAttendances.AsNoTracking()
                .Where(a => sessionIds.Contains(a.SessionId))
                .Select(a => new { a.SessionId, a.StudentId, a.Mark, a.DurationMs })
                .ToListAsync(ct);

            foreach (var row in attendanceRows)
                marks[(row.SessionId, row.StudentId)] = row.Mark;
        }

        return new SessionFacts(segments, marks);
    }

    private SessionFacts(
        Dictionary<(long, string, long), Totals> segments,
        Dictionary<(long, long), string> attendanceMarks)
    {
        _segments = segments;
        _attendanceMarks = attendanceMarks;
    }

    /// <summary>هل لهذا الحساب شريط حضور مُسجَّل فعلًا في هذه الحصة؟</summary>
    public bool HasPresence(long sessionId, string kind, long accountId) =>
        _segments.ContainsKey((sessionId, kind, accountId));

    public double PresenceMinutes(long sessionId, string kind, long accountId, DateTime nowUtc) =>
        _segments.TryGetValue((sessionId, kind, accountId), out var totals) ? totals.MinutesAt(nowUtc) : 0;

    /// <summary>
    /// المدة الفعلية للحصة = الزمن الذي قضّاه **مدرسها** داخل الغرفة. هو الرقم
    /// الذي تُبنى عليه ساعات المدرس والتقارير وكل كارت «ساعات مكتملة».
    /// </summary>
    public double ActualMinutes(EduSession session, DateTime nowUtc)
    {
        if (HasPresence(session.Id, AccountKinds.Staff, session.TeacherId))
            return PresenceMinutes(session.Id, AccountKinds.Staff, session.TeacherId, nowUtc);

        if (session.Status == SessionStatuses.Completed)
        {
            if (ReportedMinutes(session.Metadata) is { } reported) return reported;
            if (session.EndsAt is { } end && session.JoinedAt is { } start && end > start)
                return (end - start).TotalMinutes;
        }

        return session.DurationMin;
    }

    /// <summary>
    /// مدة حضور طالب بعينه في حصة: أشرطته هو، ثم <c>durationMs</c> المُسجَّل في
    /// <c>Edu_SessionAttendance</c> قبل قسم 12، ثم مدة الحصة كاملة إن حُضِر ولم
    /// يُسجَّل خروجه قط.
    /// </summary>
    public double StudentMinutes(EduSession session, long studentId, DateTime nowUtc)
    {
        if (HasPresence(session.Id, AccountKinds.Student, studentId))
            return PresenceMinutes(session.Id, AccountKinds.Student, studentId, nowUtc);

        if (_attendanceMarks.TryGetValue((session.Id, studentId), out var mark))
        {
            if (mark == "absent") return 0;
            return session.DurationMin;
        }

        // لا شريط ولا سجل حضور: الحصة لم يُحضر فيها أحد مسجَّلًا
        return 0;
    }

    /// <summary>حضر فعلًا؟ تُستخدم بدل الاعتماد على عمود attendance وحده.</summary>
    public bool Attended(EduSession session, long studentId) =>
        HasPresence(session.Id, AccountKinds.Student, studentId) ||
        (_attendanceMarks.TryGetValue((session.Id, studentId), out var mark) && mark != "absent");

    /// <summary>
    /// <c>metadata.durationMinutes</c> كما ترسله شاشة الفصل عند الإنهاء. الـ JSON
    /// يُكتب من موضعين مختلفين (الإنهاء والإلغاء) بأشكال مختلفة، فلا يُقرأ إلا
    /// كعدد صحيح موجب — أي شكل آخر يعني «لا معلومة» لا «صفر».
    /// </summary>
    private static double? ReportedMinutes(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata) || metadata == "{}") return null;
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(metadata);
            if (document.RootElement.ValueKind != System.Text.Json.JsonValueKind.Object) return null;
            if (!document.RootElement.TryGetProperty("durationMinutes", out var value)) return null;
            if (value.ValueKind != System.Text.Json.JsonValueKind.Number || !value.TryGetInt32(out var minutes)) return null;
            return minutes > 0 ? minutes : null;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// غياب = أُغلقت no_show، أو فُتحت حصة ولم يحضر الطالب. تعريف واحد لأن
    /// الاختلاف بينهما كان أحد أسباب أرقام لا تتطابق (الشاشة تعدّ حالة
    /// <c>no_show</c> وحدها والتقارير تعدّ معها <c>attendance = absent</c>).
    /// </summary>
    public static bool IsNoShow(EduSession session) =>
        session.Status == SessionStatuses.NoShow ||
        (session.Status != SessionStatuses.Scheduled && session.Attendance == "absent");

    /// <summary>الحصة الملغاة لا تدخل في أي مقام: لا في الالتزام ولا في الإجمالي المُنفَّذ.</summary>
    public static bool IsCounted(EduSession session) => session.Status != SessionStatuses.Cancelled;
}
