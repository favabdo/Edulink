using System.Security.Claims;
using EduspaceApi.Auth;
using EduspaceApi.Data;
using EduspaceApi.Models;
using EduspaceApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Controllers;

/// <summary>
/// المراسلة الحقيقية بين الحسابات الثلاثة (موظف/طالب/ولي أمر).
/// قواعد الاتصال: الموظف يبادر بأي أحد؛ الطالب بمدرّسه فقط؛ ولي الأمر بمدرّسي أبنائه فقط.
/// بعد إنشاء الخيط يرسو المحادثات لأطرافها فقط.
/// </summary>
[ApiController]
[Route("api/messages")]
[Authorize]
public class MessagesController(EduDbContext db, NotificationService notifications) : ControllerBase
{
    private long CurrentUserId =>
        long.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : 0L;

    private string Aud => User.FindFirstValue(TokenAuthenticationHandler.AudClaim) ?? "staff";

    private record ConversationRow(
        long ConversationId,
        IReadOnlyList<Counterpart> With,
        string LastBody,
        DateTimeOffset LastAt,
        string LastSenderName,
        string LastSenderKind,
        long LastSenderId,
        int Unread);

    private record Counterpart(string Kind, long Id, string Name);

    /// <summary>صناديق ورده: محادثاتي مع آخر رسالة وعدّاد غير المقروء.</summary>
    [HttpGet("conversations")]
    public async Task<IActionResult> Conversations()
    {
        var mine = await db.ConversationMembers
            .Where(m => m.MemberKind == Aud && m.MemberId == CurrentUserId && m.States == 1)
            .Select(m => m.ConversationId)
            .ToListAsync();

        var rows = await db.Messages
            .Where(x => mine.Contains(x.ConversationId))
            .GroupBy(x => x.ConversationId)
            .Select(g => new { ConversationId = g.Key, LastAt = g.Max(x => x.CreatedAt) })
            .ToListAsync();

        var names = await LoadNamesForMyMembersAsync();
        var result = new List<ConversationRow>();
        foreach (var row in rows)
        {
            var last = await db.Messages
                .Where(x => x.ConversationId == row.ConversationId && x.CreatedAt == row.LastAt)
                .FirstAsync();
            var members = await db.ConversationMembers
                .Where(m => m.ConversationId == row.ConversationId && m.States == 1)
                .ToListAsync();
            var me = members.First(m => m.MemberKind == Aud && m.MemberId == CurrentUserId);
            var others = members.Where(m => !(m.MemberKind == Aud && m.MemberId == CurrentUserId)).ToList();

            var unread = await db.Messages.CountAsync(x =>
                x.ConversationId == row.ConversationId &&
                x.CreatedAt > (me.LastReadAt ?? DateTime.MinValue) &&
                !(x.SenderKind == Aud && x.SenderId == CurrentUserId));

            result.Add(new ConversationRow(
                row.ConversationId,
                others.Select(o => new Counterpart(o.MemberKind, o.MemberId,
                    names.GetValueOrDefault((o.MemberKind, o.MemberId), o.MemberKind))).ToList(),
                last.Body,
                new DateTimeOffset(DateTime.SpecifyKind(last.CreatedAt, DateTimeKind.Utc)),
                names.GetValueOrDefault((last.SenderKind, last.SenderId), last.SenderKind),
                last.SenderKind,
                last.SenderId,
                unread));
        }

        return Ok(result.OrderByDescending(x => x.LastAt).ToList());
    }

    /// <summary>أسماء كل أطراف محادثات هذا الحساب — استعلام واحد لكل جدول بدل N+1.</summary>
    private async Task<Dictionary<(string, long), string>> LoadNamesForMyMembersAsync()
    {
        var myConversations = await db.ConversationMembers
            .Where(m => m.MemberKind == Aud && m.MemberId == CurrentUserId)
            .Select(m => m.ConversationId)
            .ToListAsync();
        var members = await db.ConversationMembers
            .Where(m => myConversations.Contains(m.ConversationId))
            .Select(m => new { m.MemberKind, m.MemberId })
            .Distinct()
            .ToListAsync();

        var staffIds = members.Where(m => m.MemberKind == AccountKinds.Staff).Select(m => m.MemberId).ToList();
        var studentIds = members.Where(m => m.MemberKind == AccountKinds.Student).Select(m => m.MemberId).ToList();
        var parentIds = members.Where(m => m.MemberKind == AccountKinds.Parent).Select(m => m.MemberId).ToList();

        var names = new Dictionary<(string, long), string>();
        foreach (var u in await db.Users.AsNoTracking().Where(u => staffIds.Contains(u.Id)).ToListAsync())
            names[(AccountKinds.Staff, u.Id)] = u.Name ?? u.Email;
        foreach (var s in await db.Students.AsNoTracking().Where(s => studentIds.Contains(s.Id)).ToListAsync())
            names[(AccountKinds.Student, s.Id)] = s.Name ?? s.Email;
        foreach (var p in await db.Parents.AsNoTracking().Where(p => parentIds.Contains(p.Id)).ToListAsync())
            names[(AccountKinds.Parent, p.Id)] = p.Name ?? p.Email;
        return names;
    }

    /// <summary>رسائل محادثة واحدة — للأطراف فقط، وتُعلَّم مقروءة عند الفتح.</summary>
    [HttpGet("conversations/{id}")]
    public async Task<IActionResult> Thread(long id)
    {
        var me = await db.ConversationMembers
            .FirstOrDefaultAsync(m => m.ConversationId == id && m.MemberKind == Aud && m.MemberId == CurrentUserId && m.States == 1);
        if (me is null) return NotFound(new { message = "المحادثة غير موجودة." });

        var messages = await db.Messages
            .Where(x => x.ConversationId == id)
            .OrderBy(x => x.CreatedAt)
            .Take(500)
            .ToListAsync();

        me.LastReadAt = DateTime.UtcNow;
        await db.SaveChangesAsync();

        var names = new Dictionary<(string, long), string>();
        foreach (var m in messages)
        {
            var key = (m.SenderKind, m.SenderId);
            if (!names.ContainsKey(key)) names[key] = await NameOfAsync(m.SenderKind, m.SenderId);
        }

        return Ok(messages.Select(m => new
        {
            id = m.Id,
            body = m.Body,
            senderKind = m.SenderKind,
            senderId = m.SenderId,
            senderName = names[(m.SenderKind, m.SenderId)],
            mine = m.SenderKind == Aud && m.SenderId == CurrentUserId,
            at = new DateTimeOffset(DateTime.SpecifyKind(m.CreatedAt, DateTimeKind.Utc)),
        }));
    }

    public record SendMessageRequest(string? RecipientKind, long? RecipientId, string? Body, long? ConversationId);

    /// <summary>إرسال رسالة — مع conversationId للرد، أو recipientKind/recipientId لفتح خيط جديد.</summary>
    [HttpPost("send")]
    public async Task<IActionResult> Send([FromBody] SendMessageRequest request)
    {
        var body = request.Body?.Trim();
        if (string.IsNullOrWhiteSpace(body) || body.Length > 4000)
            return BadRequest(new { message = "الرسالة فارغة أو طويلة جدًا." });

        long conversationId;
        (string Kind, long Id) recipient;

        if (request.ConversationId.HasValue)
        {
            conversationId = request.ConversationId.Value;
            var member = await db.ConversationMembers
                .FirstOrDefaultAsync(m => m.ConversationId == conversationId && m.MemberKind == Aud && m.MemberId == CurrentUserId && m.States == 1);
            if (member is null) return NotFound(new { message = "المحادثة غير موجودة." });

            var others = await db.ConversationMembers
                .Where(m => m.ConversationId == conversationId && !(m.MemberKind == Aud && m.MemberId == CurrentUserId))
                .ToListAsync();
            recipient = others.Count > 0 ? (others[0].MemberKind, others[0].MemberId) : (Aud, CurrentUserId);
        }
        else
        {
            var kind = request.RecipientKind;
            if (!AccountKinds.IsValid(kind) || request.RecipientId is not { } rid || rid <= 0 || kind is null)
                return BadRequest(new { message = "مستلم غير صالح." });
            if (kind == Aud && rid == CurrentUserId)
                return BadRequest(new { message = "لا يمكنك مراسلة نفسك." });
            if (!await CanInitiateAsync(kind, rid))
                return StatusCode(403, new { message = "لا تملك صلاحية بدء محادثة مع هذا الحساب." });

            var conversation = new EduConversation();
            db.Conversations.Add(conversation);
            await db.SaveChangesAsync();
            db.ConversationMembers.AddRange(
                new EduConversationMember { ConversationId = conversation.Id, MemberKind = Aud, MemberId = CurrentUserId },
                new EduConversationMember { ConversationId = conversation.Id, MemberKind = kind, MemberId = rid });
            conversationId = conversation.Id;
            recipient = (kind, rid);
        }

        var message = new EduMessage
        {
            ConversationId = conversationId,
            SenderKind = Aud,
            SenderId = CurrentUserId,
            Body = body,
        };
        db.Messages.Add(message);
        await db.SaveChangesAsync();

        if (!(recipient.Kind == Aud && recipient.Id == CurrentUserId))
        {
            var myName = await NameOfAsync(Aud, CurrentUserId);
            await notifications.NotifyAsync(recipient.Kind, recipient.Id, "message",
                $"رسالة جديدة من {myName}", body.Length > 120 ? body[..120] + "…" : body,
                link: $"/messages?conversation={conversationId}");
        }

        return Ok(new { id = message.Id, conversationId, at = new DateTimeOffset(DateTime.SpecifyKind(message.CreatedAt, DateTimeKind.Utc)) });
    }

    /// <summary>قواعد المباشرة: موظف↔الكل، طالب↔مدرّسه، ولي أمر↔مدرّسي أبنائه.</summary>
    private async Task<bool> CanInitiateAsync(string recipientKind, long recipientId)
    {
        if (Aud == AccountKinds.Staff)
            return recipientKind switch
            {
                AccountKinds.Staff => await db.Users.AnyAsync(u => u.Id == recipientId),
                AccountKinds.Student => await db.Students.AnyAsync(s => s.Id == recipientId),
                _ => await db.Parents.AnyAsync(p => p.Id == recipientId),
            };

        var teacherIds = await TeacherIdsForMeAsync();

        if (Aud == AccountKinds.Student)
            return recipientKind == AccountKinds.Staff && teacherIds.Contains(recipientId);

        // ولي أمر: مدرّسو أبنائه فقط
        return recipientKind == AccountKinds.Staff && teacherIds.Contains(recipientId);
    }

    private async Task<List<long>> TeacherIdsForMeAsync()
    {
        if (Aud == AccountKinds.Student)
        {
            return await db.Sessions.AsNoTracking()
                .Where(s => s.StudentId == CurrentUserId)
                .Select(s => s.TeacherId).Distinct().ToListAsync();
        }

        var childIds = await db.Relations.AsNoTracking()
            .Where(r => r.ParentId == CurrentUserId && r.States == 1)
            .Select(r => r.StudentId).ToListAsync();
        return await db.Sessions.AsNoTracking()
            .Where(s => childIds.Contains(s.StudentId))
            .Select(s => s.TeacherId).Distinct().ToListAsync();
    }

    private async Task<string> NameOfAsync(string kind, long id) => kind switch
    {
        AccountKinds.Student => (await db.Students.AsNoTracking().FirstOrDefaultAsync(s => s.Id == id)) is { } s
            ? s.Name ?? s.Email : "طالب محذوف",
        AccountKinds.Parent => (await db.Parents.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id)) is { } p
            ? p.Name ?? p.Email : "ولي أمر محذوف",
        _ => (await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == id)) is { } u
            ? u.Name ?? u.Email : "موظف محذوف",
    };
}
