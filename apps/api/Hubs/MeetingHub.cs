using System.Collections.Concurrent;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Hubs;

/// <summary>معلومات مشارك داخل غرفة (تُحفظ في الذاكرة فقط — الجلسة media تتم بين المتصفحين مباشرة).</summary>
public record PeerInfo(string ConnId, long UserId, string Name, string Role, bool Muted, bool Camera, bool Hand);

/// <summary>حالة السبورة والمستند والمسرح لكل غرفة — تُقرأ عند الانضمام حتى لا يبدأ داخلٌ متأخرٌ صفحة بيضاء.</summary>
public record BoardSnapshot(bool IsOn, string Stage, IReadOnlyList<string> Segments, string? Doc);

public record RoomInfo(string Room, string Self, IReadOnlyList<PeerInfo> Peers, BoardSnapshot Board);

/// <summary>
/// غرفة اجتماع واحدة لكل حصة: `room = code الحصة` (مثال EL-1146).
//  كل غرفة معزولة عن الأخرى، والوسائط P2P بين المتصفحين — الخادم ينقل الإشارات فقط.
///
/// السجل في الذاكرة (يكفي سيرفرًا واحدًا). للتوسع المستقبلي:
/// LiveKit SFU self-hosted (docs/02-tech-stack.md) أو Redis backplane.
///
/// السبورة والمستند محفوظان هنا **مؤقتًا** (لا جدول لهما): لا يُعاد رسم درس كامل من
/// القاعدة بعد إغلاق الغرفة، والهدف أن من دخل متأخرًا أو انقطع ورجع يرى نفس السبورة
/// ومن نفس الصفحة. السقف FIFO حتى لا تنفجر الذاكرة مع الغرف المتزامنة (مقيس 2000 غرفة).
/// </summary>
public class MeetingHub : Hub
{
    /// <summary>أقصى عدد مقاطع قلم تُحمَل لمن يدخل متأخرًا، وسقف بايتات لكل غرفة.</summary>
    private const int BoardSegmentCap = 400;
    private const int BoardByteCap = 48_000;

    private sealed class RoomState
    {
        public ConcurrentDictionary<string, PeerInfo> Peers { get; } = new();
        public LinkedList<string> Segments { get; } = new();
        public long SegmentBytes;
        public string? Doc;
        public bool BoardOn;
        public string Stage = "video";
    }

    private static readonly ConcurrentDictionary<string, RoomState> Rooms = new();

    private readonly EduDbContext _db;
    private readonly Services.SessionWindowOptions _window;

    public MeetingHub(EduDbContext db, IConfiguration config)
    {
        _db = db;
        _window = Services.SessionWindowOptions.From(config);
    }

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
            AccountKinds.Staff => await _db.Users.AnyAsync(u => u.Id == session.AccountId && u.TenantId == session.TenantId && u.Access == 1),
            AccountKinds.Student => await _db.Students.AnyAsync(s => s.Id == session.AccountId && s.TenantId == session.TenantId && s.Access == 1),
            AccountKinds.Parent => await _db.Parents.AnyAsync(p => p.Id == session.AccountId && p.TenantId == session.TenantId && p.Access == 1),
            _ => false,
        };
        if (!ok)
        {
            Context.Abort();
            return;
        }

        Context.Items["userId"] = session.AccountId;
        Context.Items["aud"] = session.Kind;
        Context.Items["tenantId"] = session.TenantId;
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
        var tenantId = Convert.ToInt64(Context.Items["tenantId"] ?? 1L);

        var session = await _db.Sessions.FirstOrDefaultAsync(s => s.Code == room && s.TenantId == tenantId)
            ?? throw new HubException("الحصة غير موجودة.");

        string resolvedRole;
        if (isStudent)
        {
            if (session.StudentId != userId)
                throw new HubException("هذه الحصة ليست من حصصك.");
            resolvedRole = "student";
        }
        else if (aud == "parent")
        {
            var linked = await _db.Relations.AnyAsync(r => r.ParentId == userId && r.StudentId == session.StudentId && r.TenantId == session.TenantId);
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

        // النافذة الزمنية تُفرض هنا لا على الشاشة: حجب الزرار في الواجهة لا يمنع
        // من يكتب /hubs/meeting/join في DevTools.
        var joinState = Services.SessionWindow.Evaluate(session, DateTime.UtcNow, _window);
        if (joinState != Services.JoinState.Open)
            throw new HubException(Services.SessionWindow.DenyMessage(joinState, session, DateTime.UtcNow, _window));

        var provided = (displayName ?? "").Trim();
        var name = provided.Length > 0 && provided.Length <= 64
            ? provided
            : (string?)Context.Items["userName"] ?? "مشارك";

        Context.Items["room"] = room;
        Context.Items["sessionId"] = session.Id;
        Context.Items["role"] = resolvedRole;
        Context.Items["displayName"] = name;
        // من يقود السبورة والمستند والمسرح: مدرس الحصة أو من هو مشرف فأعلى —
        // لا الطالب ولا ولي الأمر المراقب (التحقيق في الخادم، لا بحجب الزرار).
        Context.Items["host"] = resolvedRole == "teacher"
            || (aud == AccountKinds.Staff && staffRole >= UserRoles.Supervisor);

        await RecordAttendanceAsync(session, resolvedRole, isStudent, userId);
        await OpenPresenceAsync(session, resolvedRole, aud, userId);

        var state = Rooms.GetOrAdd(room, _ => new RoomState());
        var self = new PeerInfo(Context.ConnectionId, userId, name, resolvedRole, false, resolvedRole != "observer", false);
        state.Peers[Context.ConnectionId] = self;

        await Groups.AddToGroupAsync(Context.ConnectionId, room);

        var existing = state.Peers.Values.Where(p => p.ConnId != Context.ConnectionId).ToList();
        await Clients.OthersInGroup(room).SendAsync("peer-joined", self);

        BoardSnapshot snapshot;
        lock (state.Segments)
        {
            snapshot = new BoardSnapshot(state.BoardOn, state.Stage, state.Segments.ToList(), state.Doc);
        }
        return new RoomInfo(room, Context.ConnectionId, existing, snapshot);
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
                    TenantId = session.TenantId,
                });
            }
            else
            {
                attendance.Mark = mark;
                attendance.JoinedAt ??= now;
                // leftAt لا تُمسح: كان مسحها عند كل إعادة دخول يُلغي الشريط السابق
                // فلا يُحسب من «طلع ودخل تاني» إلا آخر زيارة. الأشرطة الآن في
                // Edu_SessionPresence وهي المصدر، وصف الحضور يبقى كما هو.
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

    /// <summary>
    /// فتح شريط حضور لهذا الدخول بالتحديد. أي شريط مفتوح قديم لنفس الحساب في
    /// نفس الحصة يُغلَق أولًا: متصفح انقطع بلا <c>OnDisconnected</c> (قفل النافذة
    /// أو موت الشبكة) يترك شريطًا مفتوحًا، ولو تُرك لعدّت كل إعادة دخول زمنًا
    /// موصولًا من أول زيارة لا من آخرها.
    /// </summary>
    private async Task OpenPresenceAsync(EduSession session, string roomRole, string accountKind, long accountId)
    {
        var now = DateTime.UtcNow;

        var dangling = await _db.SessionPresences
            .Where(p => p.SessionId == session.Id && p.AccountKind == accountKind &&
                        p.AccountId == accountId && p.LeftAt == null)
            .ToListAsync();
        foreach (var open in dangling)
        {
            open.LeftAt = now;
            open.DurationMs = Math.Max(0, (long)(now - open.JoinedAt).TotalMilliseconds);
        }

        var segment = new EduSessionPresence
        {
            SessionId = session.Id,
            TenantId = session.TenantId,
            AccountKind = accountKind,
            AccountId = accountId,
            RoomRole = roomRole,
            JoinedAt = now,
        };
        _db.SessionPresences.Add(segment);
        await _db.SaveChangesAsync();

        Context.Items["presenceId"] = segment.Id;
    }

    /// <summary>إغلاق الشريط الذي فتحه هذا الاتصال — لا يمس أشرطة اتصالات أخرى.</summary>
    private async Task ClosePresenceAsync()
    {
        if (Context.Items["presenceId"] is not long presenceId) return;
        Context.Items.Remove("presenceId");

        var segment = await _db.SessionPresences.FirstOrDefaultAsync(p => p.Id == presenceId && p.LeftAt == null);
        if (segment is null) return;

        var now = DateTime.UtcNow;
        segment.LeftAt = now;
        segment.DurationMs = Math.Max(0, (long)(now - segment.JoinedAt).TotalMilliseconds);
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
        if (Rooms.TryGetValue(room, out var state) && state.Peers.TryGetValue(Context.ConnectionId, out var peer))
        {
            state.Peers[Context.ConnectionId] = peer with { Muted = muted, Camera = camera, Hand = hand };
        }
        await Clients.OthersInGroup(room).SendAsync("state", Context.ConnectionId, muted, camera, hand);
    }

    /// <summary>
    /// رسالة الحصة. تُمرَّر لغير المُرسل فقط: الشاشة تُظهر نسخة محلية فور الإرسال،
    /// فكانت كل رسالة تظهر **مرتين** عند كاتبها.
    /// </summary>
    public Task SendChat(string text)
    {
        if (string.IsNullOrWhiteSpace(text) || text.Length > 2000) return Task.CompletedTask;
        if (Context.Items["room"] is not string room) return Task.CompletedTask;
        var name = (string?)Context.Items["displayName"] ?? (string?)Context.Items["userName"] ?? "";
        var role = (string?)Context.Items["role"] ?? "student";
        return Clients.OthersInGroup(room).SendAsync("chat", Context.ConnectionId, name, role, text.Trim(), DateTime.UtcNow);
    }

    /// <summary>
    /// تمرير ضربة قلم: إحداثيات نسبية 0..1 + لون. تُخزَّن أيضًا للغرفة حتى يرى
    /// من دخل متأخرًا (أو رجع بعد انقطاع) ما كُتب قبله لا صفحة بيضاء.
    /// </summary>
    public async Task SendStroke(string segmentJson)
    {
        if (segmentJson is null || segmentJson.Length > 512) return;
        if (Context.Items["room"] is not string room) return;
        if (Rooms.TryGetValue(room, out var state))
        {
            lock (state.Segments)
            {
                state.Segments.AddLast(segmentJson);
                state.SegmentBytes += segmentJson.Length;
                while (state.Segments.Count > BoardSegmentCap || state.SegmentBytes > BoardByteCap)
                {
                    var oldest = state.Segments.First;
                    if (oldest is null) break;
                    state.SegmentBytes -= oldest.Value.Length;
                    state.Segments.RemoveFirst();
                }
            }
        }
        await Clients.OthersInGroup(room).SendAsync("stroke", Context.ConnectionId, segmentJson);
    }

    public async Task ClearWhiteboard()
    {
        if (!IsHost()) throw new HubException("مسح السبورة للمدرس أو الإشراف فقط — الكتابة للطالب مسموحة.");
        if (Context.Items["room"] is not string room) return;
        if (Rooms.TryGetValue(room, out var state))
        {
            lock (state.Segments)
            {
                state.Segments.Clear();
                state.SegmentBytes = 0;
            }
        }
        await Clients.OthersInGroup(room).SendAsync("wb-clear", Context.ConnectionId);
    }

    /// <summary>
    /// السبورة على المسرح أو خارجه، وما الذي يُكبَّر (`video` | `board` | `doc`).
    /// قرار المدرس يصل **لكل** الغرفة — الطالب لا يحتاج يضغط شيئًا ليرى السبورة.
    /// </summary>
    public async Task SetStage(string stage, bool boardOn)
    {
        if (!IsHost()) throw new HubException("تحكم السبورة والمسرح للمدرس أو الإشراف فقط.");
        if (Context.Items["room"] is not string room) return;
        var normalized = stage switch { "board" or "doc" or "video" => stage, _ => "video" };
        if (Rooms.TryGetValue(room, out var state))
        {
            state.Stage = normalized;
            state.BoardOn = boardOn;
        }
        await Clients.Group(room).SendAsync("stage", normalized, boardOn, Context.ConnectionId);
    }

    /// <summary>
    /// مستند معروض تحت طبقة القلم: `{fileId, name, mime, page, pageCount}`.
    /// `fileId` لا بد أن يكون ملفًا **للمرسل** في `Edu_Files` — حتى لا يتهرّب أحد
    /// ويعرض ملف زميل أو حساب آخر بكتابة معرّف في DevTools.
    /// </summary>
    public async Task ShareDocument(string docJson)
    {
        if (!IsHost()) throw new HubException("عرض الملفات داخل الحصة للمدرس أو الإشراف فقط.");
        if (Context.Items["room"] is not string room) return;
        var sessionId = Convert.ToInt64(Context.Items["sessionId"] ?? 0L);
        if (sessionId == 0) return;
        if (docJson is null || docJson.Length > 2048) throw new HubException("وصف الملف غير صالح.");

        if (docJson == "null")
        {
            if (Rooms.TryGetValue(room, out var off))
            {
                RevokeDoc(off, sessionId);
                off.Doc = null;
            }
            await Clients.Group(room).SendAsync("doc", null, Context.ConnectionId);
            return;
        }

        var fileId = ReadFileId(docJson);
        var tenantId = Convert.ToInt64(Context.Items["tenantId"] ?? 1L);
        var userId = Convert.ToInt64(Context.Items["userId"] ?? 0L);
        var aud = (string?)Context.Items["aud"] ?? AccountKinds.Staff;
        if (aud != AccountKinds.Staff) throw new HubException("عرض الملفات من حسابات الفريق فقط.");
        var owns = await _db.Files.AnyAsync(f => f.Id == fileId && f.OwnerId == userId && f.TenantId == tenantId);
        if (!owns) throw new HubException("هذا الملف ليس في مكتبتك.");

        if (Rooms.TryGetValue(room, out var state))
        {
            // المنح مقصور على المستند المعروض الآن: ما سبقه لم يعد يُنزَّل من الغرفة
            RevokeDoc(state, sessionId);
            state.Doc = docJson;
            RoomSharedDocs.Grant(sessionId, fileId);
        }
        await Clients.Group(room).SendAsync("doc", docJson, Context.ConnectionId);
    }

    private static void RevokeDoc(RoomState state, long sessionId)
    {
        if (state.Doc is null) return;
        try
        {
            RoomSharedDocs.Revoke(sessionId, ReadFileId(state.Doc));
        }
        catch (HubException)
        {
            // وصف قديم تالف: لا شيء ليُلغى، والمستند سيُستبدل رغم ذلك
        }
    }

    private bool IsHost() => Context.Items["host"] is true;

    private static long ReadFileId(string docJson)
    {
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(docJson);
            return document.RootElement.TryGetProperty("fileId", out var id) && id.TryGetInt64(out var value)
                ? value
                : throw new HubException("وصف الملف بلا معرّف.");
        }
        catch (System.Text.Json.JsonException)
        {
            throw new HubException("وصف الملف غير صالح.");
        }
    }

    /// <summary>إنهاء الحصة: يُبلّغ كل من في الغرفة ثم تُغلق.</summary>
    public async Task EndRoom(string durationIso)
    {
        if (Context.Items["room"] is not string room) return;
        // كان القبول على دور observer يشمل **ولي الأمر** المرتبط بالطالب، فيقدر على إنهاء حصة غيره
        if (!IsHost()) throw new HubException("المدرس أو الإشراف فقط يمكنهما إنهاء الحصة.");
        var by = (string?)Context.Items["displayName"] ?? (string?)Context.Items["userName"] ?? "";
        await Clients.Group(room).SendAsync("ended", by, durationIso);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await ClosePresenceAsync();

        if (Context.Items["room"] is string room && Rooms.TryGetValue(room, out var state))
        {
            state.Peers.TryRemove(Context.ConnectionId, out _);
            // الغرفة الفارغة تُقلع بسبورتها ومستندها — لا تراكم عبر الحصص
            if (state.Peers.IsEmpty)
            {
                Rooms.TryRemove(room, out _);
                if (Context.Items["sessionId"] is long emptied) RoomSharedDocs.RevokeAllOfSession(emptied);
            }
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
