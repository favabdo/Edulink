using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Services;

/// <summary>
/// الحصة التي مرّ موعدها ولم تُفتح قطّ: تُقفل <c>no_show</c> ويصل إشعار للطالب
/// وولي أمره والمدرس.
///
/// قبل هذاSERVICE كانت الحصة الفائتة تبقى <c>scheduled</c> إلى الأبد: لا في الشاشة
/// ولا في التقارير ولا في الإشعارات — وهو ما قِيس فعليًا على سيرفر الإنتاج
/// (حصة موعدها 08:00 بقيت scheduled بعد 18 دقيقة، وإشعار الطالب الوحيد كان
/// <c>session_scheduled</c> الذي أُنشئ وقت الجدولة).
///
/// القرار: «انتهت» = بدأ الموعد ومضى عليه زمن الحصة نفسه + فترة سماح
/// (<c>Sessions:MissedGraceMinutes</c>) لأن المدرس قد يتأخر دقائق فيبدأ متأخرًا؛
/// وأول ما تُفتح الغرفة تنتقل الحصة إلى <c>live</c> فلا يمسها هذا الفحص إطلاقًا.
///
/// التكرار ممنوع بحكم التصميم: القلب في <c>status = scheduled</c>، والصفلة تُكتب
/// في **نفس** المعاملة التي تكتب الإشعارات ⇒ إن ماتت العملية في المنتصف يُرجَع
/// كل شيء ويعيد الفحص التالي المحاولة، ولا يُرسل إشعار مرتين أبدًا.
/// </summary>
public class MissedSessionWatcher(
    IServiceScopeFactory scopeFactory,
    IConfiguration config,
    ILogger<MissedSessionWatcher> logger) : BackgroundService
{
    /// <summary>عدد الحصص التي تُعالَج في الجولة الواحدة — يكفي لتصريف أي تراكم بلا حصار للقاعدة.</summary>
    private const int BatchSize = 200;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var seconds = config.GetValue("Sessions:MissedCheckSeconds", 60);
        if (seconds < 10) seconds = 10;

        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(seconds));

        // أول جولة فور الإقلاع: قاعدة كانت مغلقة طوال الليل لا يجب أن تنتظر دقيقة كاملة
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ScanAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // الفحص خلفي: فشل مؤقت (قاعدة مشغولة/شبكة) لا يُسقِط الخدمة ولا التطبيق
                logger.LogError(ex, "فشل فحص الحصص الفائتة — ستُعاد المحاولة في الجولة التالية");
            }

            try
            {
                await timer.WaitForNextTickAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task ScanAsync(CancellationToken ct)
    {
        var graceMinutes = config.GetValue("Sessions:MissedGraceMinutes", 15);
        if (graceMinutes < 0) graceMinutes = 0;

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<EduDbContext>();
        var notifications = scope.ServiceProvider.GetRequiredService<NotificationService>();
        var nowUtc = DateTime.UtcNow;

        var candidates = await db.Sessions
            .Where(s => s.Status == SessionStatuses.Scheduled && s.StartsAt < nowUtc)
            .OrderBy(s => s.StartsAt)
            .Take(BatchSize)
            .ToListAsync(ct);

        // المدة تُضاف هنا لا في SQL: حساب الفرق بين المحرّكين لا يستحق اختلاف السلوك
        var expired = candidates.Where(s => s.StartsAt.AddMinutes(s.DurationMin + graceMinutes) < nowUtc).ToList();

        foreach (var session in expired)
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            session.Status = SessionStatuses.NoShow;
            session.Attendance = "absent";

            var when = session.StartsAt.ToString("yyyy-MM-dd HH:mm");
            const string title = "حصة لم تُعقد";
            var body = $"{session.Subject} — {when} UTC — انتهى الموعد دون أن تُفتح الغرفة";
            var link = $"/sessions/{session.Id}";

            await notifications.NotifyStudentAndParentsAsync(session.StudentId, "session_missed", title, body, link, ct);
            await notifications.NotifyAsync(AccountKinds.Staff, session.TeacherId, "session_missed", title, body, link, ct);

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            logger.LogInformation(
                "الحصة {SessionId} ({Code}) أُغلقت no_show — إشعار للطالب {StudentId} والمدرس {TeacherId}",
                session.Id, session.Code, session.StudentId, session.TeacherId);
        }
    }
}
