using EduspaceApi.Models;

namespace EduspaceApi.Services;

/// <summary>
/// نافذة الانضمام إلى غرفة الحصة — القرار والخِطاب معًا في مكان واحد.
///
/// قبل هذا الكلاس كان الانضمام مفتوحًا طول اليوم: <c>MeetingHub.Join</c> كان
/// يرفض <c>cancelled/completed</c> فقط بلا أي مقارنة بالموعد، و
/// <c>PATCH status=live</c> و<c>POST /{id}/attendance</c> مقبولان في أي ساعة،
/// فأي حصة مجدولة تصلح للدخول من أول ما تُنشأ.
///
/// القرار (طلب صاحب المشروع 2026-11-05): الحصة تُفتح قبل موعدها بفترة محددة
/// وتُقفل بعد نهايتها، والانتظار يكون على الحصة التي بعدها — لا باب مفتوح
/// طوال اليوم.
/// </summary>
public sealed record SessionWindowOptions(int EarlyMinutes, int GraceMinutes)
{
    public static SessionWindowOptions From(IConfiguration config) => new(
        Math.Max(0, config.GetValue("Sessions:JoinEarlyMinutes", 30)),
        Math.Max(0, config.GetValue("Sessions:JoinGraceMinutes", 5)));
}

public enum JoinState
{
    /// <summary>الدور لهذه الحصة: الباب مفتوح الآن.</summary>
    Open,

    /// <summary>مبكرًا جدًا — تُفتح في <c>OpensAt</c>.</summary>
    TooEarly,

    /// <summary>انتهت نافذتها وهي ما زالت مجدولة (لم يفتحها أحد) — الدور للتي بعدها.</summary>
    WindowClosed,

    /// <summary>مقفولة نهائيًا: completed / cancelled / no_show.</summary>
    Finished,
}

public static class SessionWindow
{
    /// <summary>
    /// حالة الانضمام الآن. <c>live</c> تُترك مفتوحة دائمًا لأن المدرس داخل
    /// الغرفة فعلًا: لو انقطع اتصال الطالب أثناء حصة متأخرة عن جدولها أُغلق
    /// الباب في وجهه وهو في منتصف الحصة، وهذا أسوأ من النافذة نفسها.
    /// </summary>
    public static JoinState Evaluate(EduSession session, DateTime nowUtc, SessionWindowOptions options)
    {
        if (session.Status is SessionStatuses.Completed or SessionStatuses.Cancelled or SessionStatuses.NoShow)
            return JoinState.Finished;

        if (session.Status == SessionStatuses.Live) return JoinState.Open;

        if (nowUtc < session.StartsAt.AddMinutes(-options.EarlyMinutes)) return JoinState.TooEarly;
        if (nowUtc > EndsAt(session, options)) return JoinState.WindowClosed;

        return JoinState.Open;
    }

    public static DateTime OpensAt(EduSession session, SessionWindowOptions options) =>
        session.StartsAt.AddMinutes(-options.EarlyMinutes);

    /// <summary>نهاية النافذة = الموعد + مدة الحصة + فترة السماح (لا تُمدَّد بأكثر من ذلك).</summary>
    public static DateTime EndsAt(EduSession session, SessionWindowOptions options) =>
        session.StartsAt.AddMinutes(session.DurationMin + options.GraceMinutes);

    /// <summary>
    /// رسالة الرفض بالعربية، بها الوقت المتبقي حتى الفتح أو أن الحصة انتهت —
    /// تُقال في <c>HubException</c> وفي تلميح الزرار الباهت، فتكون الشاشة والخادم
    /// بنفس الكلام حرفيًا.
    /// </summary>
    public static string DenyMessage(JoinState state, EduSession session, DateTime nowUtc, SessionWindowOptions options) =>
        state switch
        {
            JoinState.TooEarly =>
                $"هذه الحصة لم يحن موعدها بعد: تُفتح قبل البداية بـ{options.EarlyMinutes} دقيقة " +
                $"(باقٍ {MinutesUntil(session, nowUtc, options)} دقيقة) — ادخل على حصة دورك.",
            JoinState.WindowClosed =>
                $"انتهت نافذة هذه الحصة: مضى موعدها ومدتها {session.DurationMin} دقيقة " +
                "والدور على الحصة التالية في جدولك.",
            JoinState.Finished =>
                session.Status switch
                {
                    SessionStatuses.Cancelled => "هذه الحصة ملغاة.",
                    SessionStatuses.NoShow => "هذه الحصة لم تُعقد وأُغلقت.",
                    _ => "هذه الحصة انتهت بالفعل.",
                },
            _ => "الحصة مفتوحة الآن.",
        };

    /// <summary>كم دقيقة وتُفتح — تُستخدم في الرسالة وفي تلميح الزرار الباهت.</summary>
    public static int MinutesUntil(EduSession session, DateTime nowUtc, SessionWindowOptions options)
    {
        var remaining = (OpensAt(session, options) - nowUtc).TotalMinutes;
        return remaining <= 0 ? 0 : (int)Math.Ceiling(remaining);
    }
}
