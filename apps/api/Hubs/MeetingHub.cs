using System.Collections.Concurrent;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Hubs;

/// <summary>معلومات مشارك داخل غرفة (تُحفظ في الذاكرة فقط — الجلسة media تتم بين المتصفحين مباشرة).</summary>
public record PeerInfo(string ConnId, long UserId, string Name, string Role, bool Muted, bool Camera, bool Hand);

public record RoomInfo(string Room, IReadOnlyList<PeerInfo> Peers);

/// <summary>
/// غرفة اجتماع واحدة لكل حصة: `room = code الحصة` (مثال EL-1146).
//  كل غرفة معزولة عن الأخرى، والوسائط P2P بين المتصفحين — الخادم ينقل الإشارات فقط.
///
/// ⚠️ السجل هنا في الذاكرة (يكفي سيرفرًا واحدًا). للتوسع المستقبلي:
/// LiveKit SFU self-hosted (docs/02-tech-stack.md) أو Redis backplane.
/// </summary>
public class MeetingHub : Hub
{
    private static readonly ConcurrentDictionary<string, ConcurrentDictionary<string, PeerInfo>> Rooms = new();

    private readonly EduDbContext _db;

    public MeetingHub(EduDbContext db) => _db = db;

    public override async Task OnConnectedAsync()
    {
        // متصفحات لا تستطيع وضع Authorization في ترويسة الـ WebSocket —
        // لذلك يصل التوكن في query string ويُتحقق منه هنا من Edu_Tokens
        // (نفس منطق TokenAuthenticationHandler: جلسة لكل جهاز مهما كان نوع الحساب).
        var token = Context.GetHttpContext()?.Request.Query["access_token"].ToString();
        if (string.IsNullOrWhiteSpace(token))
        {
            Context.Abort();
            return;
        }

        var session = await _db.Tokens.AsNoTracking().FirstOrDefaultAsync(t => t.Value == token);
        if (session is null)
        {
            Context.Abort();
            return;
        }

        bool ok = session.Kind switch
        {
            AccountKinds.Staff => await _db.Users.AnyAsync(u => u.Id == session.AccountId && u.Access == 1),
            AccountKinds.Student => await _db.Students.AnyAsync(s => s.Id == session.AccountId && s.Access == 1),
            AccountKinds.Parent => await _db.Parents.AnyAsync(p => p.Id == session.AccountId && p.Access == 1),
            _ => false,
        };
        if (!ok)
        {
            Context.Abort();
            return;
        }

        Context.Items["userId"] = session.AccountId;
        Context.Items["aud"] = session.Kind;
        Context.Items["userName"] = session.Kind switch
        {
            AccountKinds.Staff => (await _db.Users.AsNoTracking().FirstAsync(u => u.Id == session.AccountId)) is { } u ? u.Name ?? u.Email : "موظف",
            AccountKinds.Student => (await _db.Students.AsNoTracking().FirstAsync(s => s.Id == session.AccountId)) is { } s ? s.Name ?? s.Email : "طالب",
            _ => (await _db.Parents.AsNoTracking().FirstAsync(p => p.Id == session.AccountId)) is { } p ? p.Name ?? p.Email : "ولي أمر",
        };
        if (session.Kind == AccountKinds.Staff)
        {
            var staff = await _db.Users.AsNoTracking().FirstAsync(u => u.Id == session.AccountId);
            Context.Items["staffRole"] = staff.Role;
        }
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// الانضمام إلى غرفة الحصة. **الدور يُحدَّد هنا من القاعدة ولا يُقبل من العميل**:
    /// مدرس الحصة = teacher، الطالب المجدول له = student، ومشرف/مدير/أونر = observer.
    /// الانضمام يسجّل الحضور تلقائيًا (present/late حسب الموعد) ويحوّل الحصة إلى live.
    /// </summary>
    public async Task<RoomInfo> Join(string room, string participantRole, string? displayName)
    {
        if (string.IsNullOrWhiteSpace(room) || room.Length > 64)
            throw new HubException("رمز الحصة غير صالح.");

        var userId = Convert.ToInt64(Context.Items["userId"] ?? 0L);
        var aud = (string?)Context.Items["aud"] ?? "staff";
        var isStudent = aud == "student";
        var staffRole = Convert.ToInt16(Context.Items["staffRole"] ?? (short)-1);

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Code == room)
            ?? throw new HubException("الحصة غير موجودة.");
        if (session.Status is SessionStatuses.Cancelled or SessionStatuses.Completed)
            throw new HubException("هذه الحصة منتهية أو ملغاة.");

        string resolvedRole;
        if (isStudent)
        {
            if (session.StudentId != userId)
                throw new HubException("هذه الحصة ليست من حصصك.");
            resolvedRole = "student";
        }
        else if (aud == "parent")
        {
            var linked = await _db.Relations.AnyAsync(r => r.ParentId == userId && r.StudentId == session.StudentId);
            if (!linked) throw new HubException("هذه الحصة ليست لأبنائك.");
            resolvedRole = "observer";
        }
        else if (session.TeacherId == userId && staffRole == UserRoles.Teacher)
        {
            resolvedRole = "teacher";
        }
        else if (staffRole >= UserRoles.Supervisor)
        {
            resolvedRole = "observer";
        }
        else
        {
            throw new HubException("لا تملك صلاحية الانضمام لهذه الحصة.");
        }

        var provided = (displayName ?? "").Trim();
        var name = provided.Length > 0 && provided.Length <= 64
            ? provided
            : (string?)Context.Items["userName"] ?? "مشارك";

        Context.Items["room"] = room;
        Context.Items["sessionId"] = session.Id;
        Context.Items["role"] = resolvedRole;
        Context.Items["displayName"] = name;

        await RecordAttendanceAsync(session, resolvedRole, isStudent, userId);

        var peers = Rooms.GetOrAdd(room, _ => new ConcurrentDictionary<string, PeerInfo>());
        var self = new PeerInfo(Context.ConnectionId, userId, name, resolvedRole, false, resolvedRole != "observer", false);
        peers[Context.ConnectionId] = self;

        await Groups.AddToGroupAsync(Context.ConnectionId, room);

        var existing = peers.Values.Where(p => p.ConnId != Context.ConnectionId).ToList();
        await Clients.OthersInGroup(room).SendAsync("peer-joined", self);

        return new RoomInfo(room, existing);
    }

    /// <summary>الحضور التلقائي: الطالب يُسجَّل present/late، ودخول المدرس يحول الحصة إلى live.</summary>
    private async Task RecordAttendanceAsync(EduSession session, string role, bool isStudent, long userId)
    {
        var now = DateTime.UtcNow;

        if (role == "teacher" && session.Status == SessionStatuses.Scheduled)
        {
            session.Status = SessionStatuses.Live;
            session.JoinedAt ??= now;
            session.RoomCode ??= session.Code;
        }

        if (isStudent && session.StudentId == userId)
        {
            var late = now > session.StartsAt.AddMinutes(10);
            var mark = late ? "late" : "present";

            var attendance = await _db.SessionAttendances
                .FirstOrDefaultAsync(a => a.SessionId == session.Id && a.StudentId == userId);
            if (attendance is null)
            {
                _db.SessionAttendances.Add(new EduSessionAttendance
                {
                    SessionId = session.Id,
                    StudentId = userId,
                    Mark = mark,
                    JoinedAt = now,
                });
            }
            else
            {
                attendance.Mark = mark;
                attendance.JoinedAt ??= now;
                attendance.LeftAt = null;
            }

            if (session.Status == SessionStatuses.Scheduled)
            {
                session.Status = SessionStatuses.Live;
                session.JoinedAt ??= now;
                session.RoomCode ??= session.Code;
            }
            if (session.Attendance != "late")
                session.Attendance = mark;
        }

        await _db.SaveChangesAsync();
    }

    // ---------------- إشارات WebRTC (تُمرَّر بين متصفح ومتصفح فقط) ----------------

    public Task SendOffer(string to, string sdp) =>
        Clients.Client(to).SendAsync("offer", Context.ConnectionId, sdp);

    public Task SendAnswer(string to, string sdp) =>
        Clients.Client(to).SendAsync("answer", Context.ConnectionId, sdp);

    public Task SendIce(string to, string candidate) =>
        Clients.Client(to).SendAsync("ice", Context.ConnectionId, candidate);

    // ---------------- حالة المشارك والرسائل والسبورة ----------------

    public async Task SetState(bool muted, bool camera, bool hand)
    {
        if (Context.Items["room"] is not string room) return;
        if (Rooms.TryGetValue(room, out var peers) && peers.TryGetValue(Context.ConnectionId, out var peer))
        {
            peers[Context.ConnectionId] = peer with { Muted = muted, Camera = camera, Hand = hand };
        }
        await Clients.OthersInGroup(room).SendAsync("state", Context.ConnectionId, muted, camera, hand);
    }

    public Task SendChat(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 2000) return Task.CompletedTask;
        if (Context.Items["room"] is not string room) return Task.CompletedTask;
        var name = (string?)Context.Items["displayName"] ?? (string?)Context.Items["userName"] ?? "";
        var role = (string?)Context.Items["role"] ?? "student";
        return Clients.Group(room).SendAsync("chat", Context.ConnectionId, name, role, text.Trim(), DateTime.UtcNow);
    }

    /// <summary>تمرير ضربة قلم للسبورة المشتركة: إحداثيات نسبية 0..1 + لون.</summary>
    public Task SendStroke(string segmentJson)
    {
        if (segmentJson is null || segmentJson.Length > 512) return Task.CompletedTask;
        if (Context.Items["room"] is not string room) return Task.CompletedTask;
        return Clients.OthersInGroup(room).SendAsync("stroke", Context.ConnectionId, segmentJson);
    }

    public Task ClearWhiteboard()
    {
        if (Context.Items["room"] is not string room) return Task.CompletedTask;
        return Clients.OthersInGroup(room).SendAsync("wb-clear", Context.ConnectionId);
    }

    /// <summary>إنهاء الحصة: يُبلّغ كل من في الغرفة ثم تُغلق. (الحفظ في القاعدة لاحقًا مع Edu_Sessions)</summary>
    public async Task EndRoom(string durationIso)
    {
        if (Context.Items["room"] is not string room) return;
        if (Context.Items["role"] is not "teacher" and not "observer")
            throw new HubException("المدرس أو الإدارة فقط يمكنها إنهاء الحصة.");
        var by = (string?)Context.Items["displayName"] ?? (string?)Context.Items["userName"] ?? "";
        await Clients.Group(room).SendAsync("ended", by, durationIso);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items["room"] is string room && Rooms.TryGetValue(room, out var peers))
        {
            peers.TryRemove(Context.ConnectionId, out _);
            if (peers.IsEmpty) Rooms.TryRemove(room, out _);
            await Clients.OthersInGroup(room).SendAsync("peer-left", Context.ConnectionId);
        }

        // مغادرة الطالب تُنهي مدة حضوره الفعلية في سجل الحضور
        if (Context.Items["role"] is "student"
            && Context.Items["sessionId"] is long sessionId
            && Context.Items["userId"] is long studentId)
        {
            var attendance = await _db.SessionAttendances
                .FirstOrDefaultAsync(a => a.SessionId == sessionId && a.StudentId == studentId);
            if (attendance is { JoinedAt: not null, LeftAt: null })
            {
                attendance.LeftAt = DateTime.UtcNow;
                attendance.DurationMs = Math.Max(0, (long)(attendance.LeftAt.Value - attendance.JoinedAt.Value).TotalMilliseconds);
                await _db.SaveChangesAsync();
            }
        }

        await base.OnDisconnectedAsync(exception);
    }
}
