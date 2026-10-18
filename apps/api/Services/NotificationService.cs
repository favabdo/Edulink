using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Services;

/// <summary>
/// إنشاء الإشعارات الموجهة. لا بريد ولا Push بعد (قرار مؤجل في docs/04) —
/// الجرس في الواجهة يقرأ هذه الصفوف عبر /api/notifications.
/// </summary>
public class NotificationService(EduDbContext db)
{
    public async Task NotifyAsync(
        string recipientKind, long recipientId, string kind, string title,
        string? body = null, string? link = null, CancellationToken ct = default)
    {
        if (!AccountKinds.IsValid(recipientKind) || recipientId <= 0) return;

        db.Notifications.Add(new EduNotification
        {
            RecipientKind = recipientKind,
            RecipientId = recipientId,
            Kind = kind,
            Title = title,
            Body = body,
            Link = link,
        });
        await db.SaveChangesAsync(ct);
    }

    /// <summary>إشعار ولي أمر الطالب (كل المرتبطين به) + الطالب نفسه.</summary>
    public async Task NotifyStudentAndParentsAsync(
        long studentId, string kind, string title, string? body = null,
        string? link = null, CancellationToken ct = default)
    {
        await NotifyAsync(AccountKinds.Student, studentId, kind, title, body, link, ct);

        var parentIds = await db.Relations
            .Where(r => r.StudentId == studentId && r.States == 1)
            .Select(r => r.ParentId)
            .ToListAsync(ct);
        foreach (var pid in parentIds)
            await NotifyAsync(AccountKinds.Parent, pid, kind, title, body, link, ct);
    }
}
