using System.Security.Claims;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// كونسول الإدارة التشغيلي: إحصائيات شاملة لكل المدرسين والطلاب، قابلة للتخصيص
/// بمدرس/طالب/صف/مادة وفترة زمنية. للأدوار الإدارية (مشرف فأعلى) فقط — المدرس
/// يقرأ أرقامه من /api/sessions/stats.
/// </summary>
[ApiController]
[Route("api/reports")]
[Authorize]
public class ReportsController(EduDbContext db) : ControllerBase
{
    private short CurrentRole =>
        short.TryParse(User.FindFirstValue(ClaimTypes.Role), out var role) ? role : (short)-1;

    private string Aud =>
        User.FindFirstValue(Auth.TokenAuthenticationHandler.AudClaim) ?? "staff";

    /// <param name="from">Unix ms لبداية الفترة (اختياري).</param>
    /// <param name="to">Unix ms لنهايتها (اختياري).</param>
    [HttpGet("overview")]
    public async Task<IActionResult> Overview(
        [FromQuery] long? from,
        [FromQuery] long? to,
        [FromQuery] long? teacherId,
        [FromQuery] long? studentId,
        [FromQuery] string? gradeKey,
        [FromQuery] string? subject)
    {
        if (Aud != AccountKinds.Staff || CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "كونسول الإدارة للمشرف فأعلى فقط." });

        var toUtc = to is null ? DateTime.UtcNow : DateTimeOffset.FromUnixTimeMilliseconds(to.Value).UtcDateTime;
        var fromUtc = from is null
            ? toUtc.AddDays(-90)
            : DateTimeOffset.FromUnixTimeMilliseconds(from.Value).UtcDateTime;
        if (fromUtc > toUtc) (fromUtc, toUtc) = (toUtc, fromUtc);

        var sessions = await db.Sessions.AsNoTracking()
            .Include(s => s.Teacher)
            .Include(s => s.Student)
            .Where(s => s.StartsAt >= fromUtc && s.StartsAt <= toUtc)
            .ToListAsync();

        if (teacherId.HasValue) sessions = sessions.Where(s => s.TeacherId == teacherId.Value).ToList();
        if (studentId.HasValue) sessions = sessions.Where(s => s.StudentId == studentId.Value).ToList();
        if (!string.IsNullOrWhiteSpace(gradeKey)) sessions = sessions.Where(s => s.GradeKey == gradeKey).ToList();
        if (!string.IsNullOrWhiteSpace(subject))
            sessions = sessions.Where(s => EF.Functions.Like(s.Subject, $"%{subject.Trim()}%")).ToList();

        // الفترة السابقة بنفس الطول — للمقارنة (نمو/انكماش)
        var span = toUtc - fromUtc;
        var prev = await db.Sessions.AsNoTracking()
            .Where(s => s.StartsAt >= fromUtc - span && s.StartsAt < fromUtc)
            .ToListAsync();
        if (teacherId.HasValue) prev = prev.Where(s => s.TeacherId == teacherId.Value).ToList();
        if (studentId.HasValue) prev = prev.Where(s => s.StudentId == studentId.Value).ToList();

        var upcomingUtc = DateTime.UtcNow;
        return Ok(new
        {
            range = new { from = fromUtc, to = toUtc },
            filters = new { teacherId, studentId, gradeKey, subject },
            totals = Summarize(sessions, upcomingUtc),
            previous = Summarize(prev, upcomingUtc),
            teachers = sessions.GroupBy(s => s.TeacherId)
                .Select(g =>
                {
                    var t = g.First().Teacher;
                    return new
                    {
                        id = g.Key,
                        name = t?.Name ?? t?.Email ?? $"#{g.Key}",
                        email = t?.Email ?? "",
                        rows = Summarize(g.ToList(), upcomingUtc),
                    };
                })
                .OrderByDescending(x => x.rows.CompletedHours)
                .ToList(),
            students = sessions.GroupBy(s => s.StudentId)
                .Select(g =>
                {
                    var st = g.First().Student;
                    return new
                    {
                        id = g.Key,
                        name = st?.Name ?? st?.Email ?? $"#{g.Key}",
                        grade = g.First().GradeKey,
                        rows = Summarize(g.ToList(), upcomingUtc),
                    };
                })
                .OrderByDescending(x => x.rows.CompletedHours)
                .ToList(),
            subjects = sessions.GroupBy(s => s.Subject.Trim())
                .Select(g => new { subject = g.Key, sessions = g.Count(), hours = Hours(g) })
                .OrderByDescending(x => x.sessions)
                .ToList(),
            grades = sessions.GroupBy(s => s.GradeKey)
                .Select(g => new { grade = g.Key, sessions = g.Count(), hours = Hours(g) })
                // g7 قبل g10: الترتيب بالحروف يجعل g10 يسبق g7
                .OrderBy(x => x.grade.Length).ThenBy(x => x.grade)
                .ToList(),
            weekly = Weekly(sessions),
            weekdayHours = WeekdayHours(sessions),
            alerts = Alerts(sessions, upcomingUtc),
        });
    }

    /// <summary>صفحة تفاصيل لمدرس واحد: حصصه، طلابه، مؤشراته الأسبوعية، وتنبيهاته.</summary>
    [HttpGet("teachers/{id:long}")]
    public async Task<IActionResult> TeacherDetail(long id, [FromQuery] long? from, [FromQuery] long? to)
    {
        if (Aud != AccountKinds.Staff || CurrentRole < UserRoles.Supervisor)
            return StatusCode(StatusCodes.Status403Forbidden, new { message = "لإدارة المنصة فقط." });

        var teacher = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id && u.Role == UserRoles.Teacher);
        if (teacher is null) return NotFound(new { message = "المدرس غير موجود." });

        var toUtc = to is null ? DateTime.UtcNow : DateTimeOffset.FromUnixTimeMilliseconds(to.Value).UtcDateTime;
        var fromUtc = from is null ? toUtc.AddDays(-90) : DateTimeOffset.FromUnixTimeMilliseconds(from.Value).UtcDateTime;

        var mine = await db.Sessions.AsNoTracking()
            .Include(s => s.Student)
            .Where(s => s.TeacherId == id && s.StartsAt >= fromUtc && s.StartsAt <= toUtc)
            .ToListAsync();

        var now = DateTime.UtcNow;
        return Ok(new
        {
            teacher = new { id = teacher.Id, name = teacher.Name ?? teacher.Email, email = teacher.Email, states = teacher.States, access = teacher.Access },
            totals = Summarize(mine, now),
            weekly = Weekly(mine),
            subjects = mine.GroupBy(s => s.Subject.Trim())
                .Select(g => new { subject = g.Key, sessions = g.Count(), hours = Hours(g) })
                .OrderByDescending(x => x.sessions).ToList(),
            students = mine.GroupBy(s => s.StudentId)
                .Select(g => new { id = g.Key, name = g.First().Student?.Name ?? $"#{g.Key}", rows = Summarize(g.ToList(), now) })
                .OrderByDescending(x => x.rows.CompletedHours).ToList(),
            upcoming = mine.Where(s => s.StartsAt >= now && s.Status == SessionStatuses.Scheduled)
                .OrderBy(s => s.StartsAt).Take(20)
                .Select(s => new { s.Id, s.Code, s.Subject, s.StartsAt, s.DurationMin, student = s.Student?.Name }).ToList(),
        });
    }

    // ──────────── تجميع ────────────

    private static double Hours(IEnumerable<EduSession> g) =>
        Math.Round(g.Where(s => s.Status == SessionStatuses.Completed).Sum(s => (double)s.DurationMin) / 60.0, 1);

    private static Metrics Summarize(List<EduSession> list, DateTime now)
    {
        var completed = list.Where(s => s.Status == SessionStatuses.Completed).ToList();
        var cancelled = list.Where(s => s.Status == SessionStatuses.Cancelled).ToList();
        var noShow = list.Where(s => s.Status == SessionStatuses.NoShow || (s.Status != SessionStatuses.Scheduled && s.Attendance == "absent")).ToList();
        var upcoming = list.Where(s => s.StartsAt >= now && s.Status == SessionStatuses.Scheduled).ToList();
        var attended = completed.Count(s => s.Attendance is "present" or "late");
        var late = completed.Count(s => s.Attendance == "late");

        // الانضباط: المدرس بدأ في الوقت؟ (JoinedAt لا يتأخر عن الموعد بأكثر من 5 دقائق)
        var startedOnTime = completed.Count(s => s.JoinedAt is null || s.JoinedAt <= s.StartsAt.AddMinutes(5));

        return new Metrics(
            list.Count,
            completed.Count,
            cancelled.Count,
            noShow.Count,
            upcoming.Count,
            Math.Round(completed.Sum(s => (double)s.DurationMin) / 60.0, 1),
            Math.Round(upcoming.Sum(s => (double)s.DurationMin) / 60.0, 1),
            completed.Count == 0 ? 0.0 : Math.Round((double)attended / completed.Count * 100, 1),
            completed.Count == 0 ? 0.0 : Math.Round((double)late / completed.Count * 100, 1),
            list.Count == 0 ? 0.0 : Math.Round((double)(list.Count - cancelled.Count - noShow.Count) / list.Count * 100, 1),
            completed.Count == 0 ? 0.0 : Math.Round((double)startedOnTime / completed.Count * 100, 1),
            list.Select(s => s.StudentId).Distinct().Count());
    }

    private static List<object> Weekly(List<EduSession> list)
    {
        var done = list.Where(s => s.Status == SessionStatuses.Completed).ToList();
        var now = DateTime.UtcNow;
        var startOfThisWeek = now.Date.AddDays(-(int)now.DayOfWeek);
        var rows = new List<object>();
        for (var w = 11; w >= 0; w--)
        {
            var ws = startOfThisWeek.AddDays(-7 * w);
            var we = ws.AddDays(7);
            var inWeek = done.Where(s => s.StartsAt >= ws && s.StartsAt < we).ToList();
            rows.Add(new
            {
                weekStart = ws,
                sessions = inWeek.Count,
                hours = Math.Round(inWeek.Sum(s => (double)s.DurationMin) / 60.0, 1),
            });
        }
        return rows;
    }

    /// <summary>توزيع الحصص المكتملة على أيام الأسبوع × ساعات اليوم — لمشاكل الجدولة.</summary>
    private static List<object> WeekdayHours(List<EduSession> list)
    {
        string[] days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return list.Where(s => s.Status != SessionStatuses.Cancelled)
            .GroupBy(s => new { Day = (int)s.StartsAt.DayOfWeek, Hour = s.StartsAt.Hour })
            .Select(g => new { day = days[g.Key.Day], hour = g.Key.Hour, sessions = g.Count() })
            .OrderBy(x => x.day).ThenBy(x => x.hour)
            .Cast<object>()
            .ToList();
    }

    /// <summary>تنبيهات تشغيلية سريعة ترى المشكلة قبل أن يشتكي العميل.</summary>
    private static object Alerts(List<EduSession> list, DateTime now)
    {
        var done = list.Where(s => s.Status == SessionStatuses.Completed).ToList();

        var idleTeachers = list.GroupBy(s => s.TeacherId)
            .Where(g => !g.Any(s => s.StartsAt >= now && s.Status == SessionStatuses.Scheduled))
            .Select(g => new { id = g.Key, name = g.First().Teacher?.Name ?? $"#{g.Key}", lastSession = g.Max(s => s.StartsAt) })
            .ToList();

        var studentsWithoutUpcoming = list.GroupBy(s => s.StudentId)
            .Where(g => !g.Any(s => s.StartsAt >= now && s.Status == SessionStatuses.Scheduled))
            .Select(g => new { id = g.Key, name = g.First().Student?.Name ?? $"#{g.Key}" })
            .ToList();

        var lowAttendance = list.GroupBy(s => s.TeacherId)
            .Select(g =>
            {
                var d = g.Where(s => s.Status == SessionStatuses.Completed).ToList();
                var rate = d.Count == 0 ? 100.0 : (double)d.Count(s => s.Attendance is "present" or "late") / d.Count * 100;
                return new { id = g.Key, name = g.First().Teacher?.Name ?? $"#{g.Key}", rate = Math.Round(rate, 1), sessions = d.Count };
            })
            .Where(x => x.sessions >= 3 && x.rate < 70)
            .ToList();

        var heavyCancellers = list.GroupBy(s => s.TeacherId)
            .Select(g => new
            {
                id = g.Key,
                name = g.First().Teacher?.Name ?? $"#{g.Key}",
                cancelled = g.Count(s => s.Status == SessionStatuses.Cancelled),
                total = g.Count(),
            })
            .Where(x => x.total >= 5 && (double)x.cancelled / x.total > 0.2)
            .ToList();

        return new
        {
            idleTeachers,
            studentsWithoutUpcoming,
            lowAttendanceTeachers = lowAttendance,
            heavyCancellers,
            sessionsTodayUnmarked = list.Count(s =>
                s.StartsAt.Date == now.Date &&
                s.Status != SessionStatuses.Cancelled &&
                s.Status != SessionStatuses.NoShow &&
                s.Attendance == null &&
                s.StartsAt < now.AddMinutes(-15)),
            // تأخر البداية المتوسط — من دمج الجلسة داخل نافذة معقولة فقط (5 دقائق مبكرًا حتى 4 ساعات)،
            // وإلا سجل واحد شاذ من بيانات قديمة يُفسد المتوسط بالآلاف.
            avgLatencyMinutes = done
                .Where(s => s.JoinedAt != null &&
                            s.JoinedAt >= s.StartsAt.AddMinutes(-5) &&
                            s.JoinedAt <= s.StartsAt.AddHours(4))
                .Select(s => Math.Max(0, (s.JoinedAt!.Value - s.StartsAt).TotalMinutes))
                .DefaultIfEmpty(0).Average(m => Math.Round(m, 1)),
        };
    }
}

/// <summary>مؤشرات موحدة تُحسب لكل نطاق (مؤسسة/مدرس/طالب).</summary>
public record Metrics(
    int Total,
    int Completed,
    int Cancelled,
    int NoShow,
    int Upcoming,
    double CompletedHours,
    double ScheduledHours,
    double AttendanceRate,
    double LateRate,
    double CommitmentRate,
    double OnTimeStartRate,
    int UniqueStudents);
