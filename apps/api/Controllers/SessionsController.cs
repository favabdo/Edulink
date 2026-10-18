using System.Security.Claims;
using EduspaceApi.Contracts;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// إدارة الجلسات الحقيقية — الجدول، الانضمام، الحضور، الإحصائيات.
/// المصدر الحقيقي للبيانات بدل المولّد التجريبي في الواجهة.
/// </summary>
[ApiController]
[Route("api/sessions")]
[Authorize]
public class SessionsController(EduDbContext db, Services.NotificationService notifications) : ControllerBase
{
    private short CurrentRole =>
        short.TryParse(User.FindFirstValue(ClaimTypes.Role), out var role) ? role : (short)-1;

    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0L;

    /// <summary>توكن من Edu_Students — الطالب يرى حصصه فقط ولا ينفذ عمليات الإدارة.</summary>
    private bool IsStudent =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) == "student";

    /// <summary>ولي الأمر — يقرأ حصص أبنائه فقط ولا يكتب شيئًا.</summary>
    private bool IsParent =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) == "parent";

    private Task<List<long>> ChildIdsAsync() =>
        db.Relations.AsNoTracking()
            .Where(r => r.ParentId == CurrentUserId && r.States == 1)
            .Select(r => r.StudentId)
            .ToListAsync();

    /// <summary>جلب الحصص مع فلترة حسب الدور والنطاق الزمني.</summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] long? from,
        [FromQuery] long? to)
    {
        var query = db.Sessions
            .AsNoTracking()
            .Include(s => s.Teacher)
            .Include(s => s.Student)
            .AsQueryable();

        // الطالب يرى حصصه هو فقط؛ ولي الأمر يرى حصص أبنائه فقط
        if (IsStudent)
            query = query.Where(s => s.StudentId == CurrentUserId);
        else if (IsParent)
        {
            var childIds = await ChildIdsAsync();
            query = query.Where(s => childIds.Contains(s.StudentId));
        }

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(s => s.Status == status);

        if (from.HasValue)
            query = query.Where(s => s.StartsAt >= DateTimeOffset.FromUnixTimeMilliseconds(from.Value).UtcDateTime);
        if (to.HasValue)
            query = query.Where(s => s.StartsAt <= DateTimeOffset.FromUnixTimeMilliseconds(to.Value).UtcDateTime);

        // المدرس يرى حصصه فقط؛ المشرف/المدير/الأونر يرون الكل
        if (CurrentRole == UserRoles.Teacher)
            query = query.Where(s => s.TeacherId == CurrentUserId);

        var rows = await query
            .OrderByDescending(s => s.StartsAt)
            .ToListAsync();

        return Ok(rows.Select(s => s.ToDto()));
    }

    /// <summary>إنشاء حصة جديدة (مشرف فأعلى — أو مدرس لحصصه هو فقط).</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateSessionRequest request)
    {
        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "إنشاء الحصص وتوزيعها للإدارة (مشرف فأعلى) فقط — المدرس ينفّذ حصصه ولا يجدولها." });

        if (string.IsNullOrWhiteSpace(request.Subject))
            return BadRequest(new { message = "المادة مطلوبة." });
        if (request.StudentId <= 0)
            return BadRequest(new { message = "الطالب مطلوب." });
        if (request.DurationMin is < 15 or > 240)
            return BadRequest(new { message = "مدة الحصة يجب أن تكون بين 15 و240 دقيقة." });

        var studentExists = await db.Students.AnyAsync(st => st.Id == request.StudentId);
        if (!studentExists)
            return BadRequest(new { message = "الطالب غير موجود في قاعدة البيانات." });

        var teacherId = request.TeacherId;
        var teacherExists = await db.Users.AnyAsync(u => u.Id == teacherId && u.Role == UserRoles.Teacher);
        if (!teacherExists)
            return BadRequest(new { message = "المدرس غير موجود في قاعدة البيانات." });

        var session = new EduSession
        {
            Code = await GenerateUniqueCodeAsync(),
            Subject = request.Subject.Trim(),
            TeacherId = teacherId,
            StudentId = request.StudentId,
            GradeKey = string.IsNullOrWhiteSpace(request.GradeKey) ? "g7" : request.GradeKey!.Trim(),
            DurationMin = request.DurationMin,
            Status = SessionStatuses.Scheduled,
            StartsAt = request.StartsAt.UtcDateTime,
            Metadata = string.IsNullOrWhiteSpace(request.Metadata) ? "{}" : request.Metadata!,
        };

        db.Sessions.Add(session);
        await db.SaveChangesAsync();

        // إعادة القراءة مع العلاقات حتى يرجّع الردّ أسماء المدرس والطالب
        var created = await db.Sessions
            .AsNoTracking()
            .Include(s => s.Teacher)
            .Include(s => s.Student)
            .FirstAsync(s => s.Id == session.Id);

        await NotifyStudentAndParentsAsync(session, "session_scheduled",
            "حصة جديدة مجدولة", $"{session.Subject} — {session.StartsAt:yyyy-MM-dd HH:mm} UTC");
        if (teacherId != CurrentUserId)
            await notifications.NotifyAsync("staff", teacherId, "session_scheduled",
                "حصة جديدة في جدولك", $"{session.Subject} — {session.StartsAt:yyyy-MM-dd HH:mm} UTC",
                link: $"/schedule");

        return Created($"/api/sessions/{session.Id}", created.ToDto());
    }

    private Task NotifyStudentAndParentsAsync(EduSession session, string kind, string title, string? body = null) =>
        notifications.NotifyStudentAndParentsAsync(session.StudentId, kind, title, body, link: $"/sessions/{session.Id}");

    /// <summary>تفاصيل حصة واحدة مع سجل الحضور.</summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> Get(long id)
    {
        var session = await db.Sessions
            .AsNoTracking()
            .Include(s => s.Teacher)
            .Include(s => s.Student)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (session is null) return NotFound(new { message = "الحصة غير موجودة." });

        // الطالب لا يرى غير حصصه
        if (IsStudent && session.StudentId != CurrentUserId)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "هذه الحصة ليست من حصصك." });
        if (IsParent && !(await ChildIdsAsync()).Contains(session.StudentId))
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "هذه الحصة ليست لأبنائك." });
        if (CurrentRole == UserRoles.Teacher && session.TeacherId != CurrentUserId)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "هذه الحصة ليست من حصصك." });

        var attendance = await db.SessionAttendances
            .AsNoTracking()
            .Where(a => a.SessionId == id)
            .ToListAsync();

        return Ok(new
        {
            session = session.ToDto(),
            attendance = attendance.Select(a => a.ToDto()),
        });
    }

    /// <summary>تحديث حالة الحصة (live/completed/cancelled/no_show) أو الموعد.</summary>
    [HttpPatch("{id}")]
    public async Task<IActionResult> Update(long id, [FromBody] UpdateSessionRequest request)
    {
        var session = await db.Sessions.FindAsync(id);
        if (session is null) return NotFound(new { message = "الحصة غير موجودة." });

        if (IsStudent || IsParent)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "تعديل الحصص للإدارة والمدرسين فقط." });
        if (CurrentRole == UserRoles.Teacher)
        {
            if (session.TeacherId != CurrentUserId)
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "هذه الحصة ليست من حصصك." });
            // المدرس ينفّذ فقط: يشغّل أو ينهي — الإلغاء وتحديد No-Show قرار إداري
            if (request.Status is not (SessionStatuses.Live or SessionStatuses.Completed))
                return StatusCode(StatusCodes.Status403Forbidden, new { message = "المدرس يشغّل أو ينهي حصته فقط — الإلغاء للإدارة." });
        }

        var now = DateTime.UtcNow;
        switch (request.Status)
        {
            case SessionStatuses.Live:
                session.Status = SessionStatuses.Live;
                session.JoinedAt ??= now;
                session.RoomCode = string.IsNullOrWhiteSpace(request.RoomCode) ? session.RoomCode : request.RoomCode;
                break;
            case SessionStatuses.Completed:
                session.Status = SessionStatuses.Completed;
                session.EndsAt = now;
                break;
            case SessionStatuses.Cancelled:
                session.Status = SessionStatuses.Cancelled;
                session.EndsAt = now;
                break;
            case SessionStatuses.NoShow:
                session.Status = SessionStatuses.NoShow;
                session.EndsAt = now;
                break;
            default:
                return BadRequest(new { message = "حالة الحصة غير معروفة." });
        }

        await db.SaveChangesAsync();
        return Ok(session.ToDto());
    }

    /// <summary>إلغاء حصة مع سبب (يُحفظ في metadata).</summary>
    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(long id, [FromBody] CancelSessionRequest request)
    {
        var session = await db.Sessions.FindAsync(id);
        if (session is null) return NotFound(new { message = "الحصة غير موجودة." });

        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "إلغاء الحصص قرار إداري (مشرف فأعلى)." });

        session.Status = SessionStatuses.Cancelled;
        session.EndsAt = DateTime.UtcNow;
        session.Metadata = System.Text.Json.JsonSerializer.Serialize(new
        {
            cancelledBy = string.IsNullOrWhiteSpace(request.By) ? "staff" : request.By!.Trim(),
            reason = string.IsNullOrWhiteSpace(request.Reason) ? null : request.Reason!.Trim(),
        });

        await db.SaveChangesAsync();

        await NotifyStudentAndParentsAsync(session, "session_cancelled",
            "إلغاء حصة", request.Reason);
        await notifications.NotifyAsync("staff", session.TeacherId, "session_cancelled",
            "إلغاء حصة في جدولك", request.Reason, link: "/schedule");

        return Ok(session.ToDto());
    }

    /// <summary>تسجيل حضور طالب في الحصة — present إن كان في الوقت، late إذا تأخر.</summary>
    [HttpPost("{id}/attendance")]
    public async Task<IActionResult> MarkAttendance(long id, [FromBody] MarkAttendanceRequest request)
    {
        var session = await db.Sessions.FindAsync(id);
        if (session is null) return NotFound(new { message = "الحصة غير موجودة." });
        if (session.Status is not (SessionStatuses.Live or SessionStatuses.Scheduled))
            return BadRequest(new { message = "لا يمكن تسجيل الحضور إلا لحصة مجدولة أو جارية." });

        if (request.StudentId <= 0)
            return BadRequest(new { message = "معرّف الطالب مطلوب." });

        // الحضور يسجّله المدرس/الإدارة أو الطالب لنفسه فقط
        if (IsParent)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "تسجيل الحضور للمدرس والإدارة والطالب نفسه." });
        if (IsStudent && request.StudentId != CurrentUserId)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "لا يمكنك تسجيل الحضور إلا لنفسك." });

        var now = DateTime.UtcNow;
        var mark = string.IsNullOrWhiteSpace(request.Mark) ? DefaultMark(session, now) : request.Mark!.Trim();

        var existing = await db.SessionAttendances
            .FirstOrDefaultAsync(a => a.SessionId == id && a.StudentId == request.StudentId);

        if (existing is null)
        {
            existing = new EduSessionAttendance
            {
                SessionId = id,
                StudentId = request.StudentId,
                Mark = mark,
                JoinedAt = now,
            };
            db.SessionAttendances.Add(existing);
        }
        else
        {
            existing.Mark = mark;
            existing.JoinedAt ??= now;
        }

        // الحصة نفسها تنتقل إلى live عند أول حضور، وعمود attendance في Edu_Sessions
        // يُحدَّث معه لأن تقارير الالتزام تحسب منه مباشرة.
        if (session.Status == SessionStatuses.Scheduled)
        {
            session.Status = SessionStatuses.Live;
            session.JoinedAt ??= now;
            session.RoomCode = session.RoomCode ?? $"EL-{session.Id:D4}";
        }
        if (session.Attendance != "late")
            session.Attendance = mark;

        await db.SaveChangesAsync();
        return Ok(existing.ToDto());
    }

    /// <summary>تسجيل مغادرة الطالب — يُحسب منها طول الحضور الفعلي.</summary>
    [HttpPost("{id}/attendance/{studentId}/leave")]
    public async Task<IActionResult> LeaveAttendance(long id, long studentId)
    {
        var attendance = await db.SessionAttendances
            .FirstOrDefaultAsync(a => a.SessionId == id && a.StudentId == studentId);
        if (attendance is null)
            return NotFound(new { message = "لا يوجد سجل حضور لهذا الطالب في هذه الحصة." });

        if (IsParent)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "المغادرة يسجّلها الطالب نفسه." });
        if (IsStudent && studentId != CurrentUserId)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "لا يمكنك تسجيل المغادرة إلا لنفسك." });

        var now = DateTime.UtcNow;
        attendance.LeftAt = now;
        if (attendance.JoinedAt.HasValue)
        {
            attendance.DurationMs = Math.Max(0, (long)(now - attendance.JoinedAt.Value).TotalMilliseconds);
            // المدة الفعلية تُحفظ كما هي — تقارير الالتزام تحسب منها لاحقًا
        }

        await db.SaveChangesAsync();
        return Ok(attendance.ToDto());
    }

    /// <summary>إنهاء الحصة: تُعلَّم منتهية + الغياب يُسجَّل لمن لم يحضر + ملخص metadata.</summary>
    [HttpPost("{id}/end")]
    public async Task<IActionResult> End(long id, [FromBody] EndSessionRequest request)
    {
        var session = await db.Sessions
            .Include(s => s.Teacher)
            .Include(s => s.Student)
            .FirstOrDefaultAsync(s => s.Id == id);
        if (session is null) return NotFound(new { message = "الحصة غير موجودة." });

        if (IsStudent || IsParent)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "إنهاء الحصة للمدرس أو الإدارة." });
        if (CurrentRole == UserRoles.Teacher && session.TeacherId != CurrentUserId)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "هذه الحصة ليست من حصصك." });

        var now = DateTime.UtcNow;
        session.Status = SessionStatuses.Completed;
        session.EndsAt = now;

        // من لم يُسجَّل حضوره يُعلَّم غائبًا
        var attended = await db.SessionAttendances.AnyAsync(a => a.SessionId == id && a.Mark != "absent");
        if (!attended && session.StudentId > 0)
        {
            var existing = await db.SessionAttendances
                .FirstOrDefaultAsync(a => a.SessionId == id && a.StudentId == session.StudentId);
            if (existing is null)
            {
                db.SessionAttendances.Add(new EduSessionAttendance
                {
                    SessionId = id,
                    StudentId = session.StudentId,
                    Mark = "absent",
                });
                session.Attendance = "absent";
            }
        }

        session.Metadata = System.Text.Json.JsonSerializer.Serialize(new
        {
            durationMinutes = request.DurationMinutes,
            endedBy = string.IsNullOrWhiteSpace(request.By) ? "teacher" : request.By!.Trim(),
            endedAt = now,
        });

        await db.SaveChangesAsync();

        await NotifyStudentAndParentsAsync(session, "session_ended",
            "انتهت الحصة", request.DurationMinutes is { } m ? $"مدتها {m} دقيقة" : null);
        if (CurrentRole != UserRoles.Teacher || session.TeacherId != CurrentUserId)
            await notifications.NotifyAsync("staff", session.TeacherId, "session_ended",
                "انتهت حصة في جدولك", null, link: "/sessions");

        return Ok(session.ToDto());
    }

    /// <summary>إحصائيات الالتزام لمدرس أو لطالب خلال أسابيع.</summary>
    [HttpGet("stats")]
    public async Task<IActionResult> Stats(
        [FromQuery] long? teacherId,
        [FromQuery] long? studentId,
        [FromQuery] int? weeks)
    {
        // الحد الزمني يُحسب في الكود أولًا حتى تُترجم الاستعلامات إلى SQL
        var cutoff = weeks.HasValue && weeks.Value > 0
            ? DateTime.UtcNow.AddDays(-weeks.Value * 7)
            : (DateTime?)null;

        var query = db.Sessions.AsNoTracking().AsQueryable();
        if (IsStudent) studentId = CurrentUserId; // الطالب لا يقرأ إحصائيات غيره
        if (IsParent)
        {
            var childFilter = await ChildIdsAsync();
            query = query.Where(s => childFilter.Contains(s.StudentId)); // ولي الأمر: أبناءه فقط
        }
        // المدرس لا يقرأ إحصائيات زميل: تقييد teacherId لحصصه هو، أي رقم آخر يتجاهله الخادم
        if (CurrentRole == UserRoles.Teacher) teacherId = CurrentUserId;
        if (teacherId.HasValue) query = query.Where(s => s.TeacherId == teacherId.Value);
        if (studentId.HasValue) query = query.Where(s => s.StudentId == studentId.Value);
        if (cutoff.HasValue) query = query.Where(s => s.StartsAt >= cutoff.Value);

        var all = await query.ToListAsync();
        var scheduled = all.Where(s => s.Status != SessionStatuses.Cancelled).ToList();
        var total = scheduled.Count;
        var present = scheduled.Count(s => s.Attendance == "present");
        var late = scheduled.Count(s => s.Attendance == "late");
        var noShow = scheduled.Count(s => s.Status == SessionStatuses.NoShow || s.Attendance == "absent");
        var completed = scheduled.Count(s => s.Status == SessionStatuses.Completed);
        var hours = Math.Round(scheduled
            .Where(s => s.Status == SessionStatuses.Completed)
            .Sum(s => (double)s.DurationMin) / 60.0, 1);

        return Ok(new
        {
            totalSessions = total,
            completed,
            present,
            late,
            noShow,
            hours,
            commitmentPercent = total > 0 ? Math.Round((double)(present + late) / total * 100, 1) : 0.0,
        });
    }

    /// <summary>
    /// تأجيل حصة مجدولة إلى وقت آخر (أو تغيير مدتها). الحصص المنتهية/الملغية لا تُؤجَّل.
    /// يُبلِّغ الطالب وأولياءه والمدرس بالموعد الجديد.
    /// </summary>
    [HttpPost("{id}/reschedule")]
    public async Task<IActionResult> Reschedule(long id, [FromBody] RescheduleSessionRequest request)
    {
        var session = await db.Sessions.FindAsync(id);
        if (session is null) return NotFound(new { message = "الحصة غير موجودة." });

        if (CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "تأجيل الحصص وإعادة جدولتها للإدارة (مشرف فأعلى)." });

        if (session.Status is SessionStatuses.Completed or SessionStatuses.Cancelled or SessionStatuses.NoShow)
            return BadRequest(new { message = "لا يمكن تأجيل حصة منتهية أو ملغاة." });

        var startsAt = request.StartsAt.UtcDateTime;
        if (startsAt < DateTime.UtcNow.AddMinutes(-5))
            return BadRequest(new { message = "الموعد الجديد في الماضي." });

        var durationMin = request.DurationMin ?? session.DurationMin;
        if (durationMin is < 15 or > 240)
            return BadRequest(new { message = "مدة الحصة يجب أن تكون بين 15 و240 دقيقة." });

        // نفس المدرس أو نفس الطالب في فترة متداخلة = تعارض حقيقي في الجدول
        var newEnd = startsAt.AddMinutes(durationMin);
        var clash = await db.Sessions.AnyAsync(s =>
            s.Id != session.Id && s.Status != SessionStatuses.Cancelled &&
            (s.TeacherId == session.TeacherId || s.StudentId == session.StudentId) &&
            s.StartsAt < newEnd && startsAt < s.StartsAt.AddMinutes(s.DurationMin));
        if (clash)
            return Conflict(new { message = "الموعد الجديد يتعارض مع حصة أخرى لنفس المدرس أو الطالب." });

        session.StartsAt = startsAt;
        session.DurationMin = durationMin;
        await db.SaveChangesAsync();

        var when = startsAt.ToString("yyyy-MM-dd HH:mm");
        await NotifyStudentAndParentsAsync(session, "session_rescheduled", "تأجيل حصة", $"الموعد الجديد: {when} UTC");
        await notifications.NotifyAsync("staff", session.TeacherId, "session_rescheduled",
            "تأجيل حصة في جدولك", $"الموعد الجديد: {when} UTC", link: "/schedule");

        return Ok(session.ToDto());
    }

    // ──────────── helpers ────────────

    /// <summary>التأخر عن بداية الحصة بأكثر من 10 دقائق = late.</summary>
    private static string DefaultMark(EduSession session, DateTime now) =>
        now <= session.StartsAt.AddMinutes(10) ? "present" : "late";

    /// <summary>كود الحصة هو نفسها معرّف الغرفة — التصادم يعني غرفتين برمز واحد،
    /// لذلك يُعاد التوليد حتى يخلو الجدول منه (و-5 خانات عند تشبّع المدى).</summary>
    private async Task<string> GenerateUniqueCodeAsync()
    {
        for (var attempt = 0; attempt < 25; attempt++)
        {
            var code = $"EL-{Random.Shared.Next(1000, 10_000)}";
            if (!await db.Sessions.AnyAsync(s => s.Code == code)) return code;
        }
        string wide;
        do
        {
            wide = $"EL-{Random.Shared.Next(10_000, 100_000)}";
        }
        while (await db.Sessions.AnyAsync(s => s.Code == wide));
        return wide;
    }
}

// ──────────── DTOs ────────────

public record CreateSessionRequest(
    string? Code,
    string? Subject,
    long TeacherId,
    long StudentId,
    string? GradeKey,
    short DurationMin,
    string? Metadata,
    DateTimeOffset StartsAt);

public record UpdateSessionRequest(
    string Status,
    string? RoomCode);

public record RescheduleSessionRequest(DateTimeOffset StartsAt, short? DurationMin);

public record CancelSessionRequest(string? By, string? Reason);

public record EndSessionRequest(string? By, int? DurationMinutes);

public record MarkAttendanceRequest(
    long StudentId,
    string? Mark);
