using System.Security.Claims;
using EduspaceApi.Auth;
using EduspaceApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>إشعارات الحساب الحالي (جرس الواجهة).</summary>
[ApiController]
[Route("api/notifications")]
[Authorize]
public class NotificationsController(EduDbContext db) : ControllerBase
{
    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0L;

    private string Aud => User.FindFirstValue(TokenAuthenticationHandler.AudClaim) ?? "staff";

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int unreadOnly, [FromQuery] int take = 30)
    {
        take = Math.Clamp(take, 1, 100);
        var query = db.Notifications.AsNoTracking()
            .Where(n => n.RecipientKind == Aud && n.RecipientId == CurrentUserId);
        if (unreadOnly == 1) query = query.Where(n => n.ReadAt == null);

        var rows = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(take)
            .ToListAsync();

        return Ok(new
        {
            unread = rows.Count(n => n.ReadAt == null),
            items = rows.Select(n => new
            {
                id = n.Id,
                kind = n.Kind,
                title = n.Title,
                body = n.Body,
                link = n.Link,
                readAt = n.ReadAt,
                at = new DateTimeOffset(DateTime.SpecifyKind(n.CreatedAt, DateTimeKind.Utc)),
            }),
        });
    }

    [HttpPost("{id}/read")]
    public async Task<IActionResult> Read(long id)
    {
        var n = await db.Notifications
            .FirstOrDefaultAsync(x => x.Id == id && x.RecipientKind == Aud && x.RecipientId == CurrentUserId);
        if (n is null) return NotFound();
        n.ReadAt ??= DateTime.UtcNow;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll()
    {
        var rows = await db.Notifications
            .Where(n => n.RecipientKind == Aud && n.RecipientId == CurrentUserId && n.ReadAt == null)
            .ToListAsync();
        var now = DateTime.UtcNow;
        foreach (var n in rows) n.ReadAt = now;
        await db.SaveChangesAsync();
        return NoContent();
    }
}
