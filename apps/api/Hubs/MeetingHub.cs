using System.Collections.Concurrent;
using EduspaceApi.Data;
using EduspaceApi.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace EduspaceApi.Hubs;

/// <summary>
/// معلومات مشارك داخل الغرفة (تُحفظ في الذاكرة فقط — الجلسة media تتم بين المتصفحين مباشرة).
///
/// `Muted/Camera/Hand` يُعلنها العميل، أما **`CanSpeak/CanVideo/CanWrite/CanShare` فقرار المدرس
/// وحده**: الحالة اللي بتتحكم في Participant لا الحالة اللي بيقولها عنها. الفارق ملموس لأن حجب
/// الزرار في الواجهة لا يمنع من ينادي `annotate` من DevTools.
/// </summary>
public record PeerInfo(string ConnId, long UserId, string Name, string Role, bool Muted, bool Camera, bool Hand,
                       bool CanSpeak, bool CanVideo, bool CanWrite, bool CanShare);

/// <summary>نافذة عدّ لدفعات الشرح لكل اتصال — السقف بالدفعات لا بالنقاط لأن العميل يدمج الحركة في دفعة.</summary>
internal sealed class StrokeWindow
{
    public long WindowStartMs;
    public int Count;
}

/// <summary>حالة السبورة والمستند والمسرح لكل غرفة — تُقرأ عند الانضمام حتى لا يبدأ داخلٌ متأخرٌ صفحة بيضاء.</summary>
public record BoardSnapshot(bool IsOn, string Stage, IReadOnlyList<string> Annotations, string? Doc);

/// <summary>
/// نتيجة الانضمام. `Me` هو صف المنضم نفسه بما قرره الخادم من صلاحيات: في رسالة منفصلة
/// تصل قبل أن يخزّن العميل معرّف اتصاله، فلا يعرف أنه ممنوع.
/// </summary>
public record RoomInfo(string Room, string Self, PeerInfo Me, IReadOnlyList<PeerInfo> Peers, BoardSnapshot Board);

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
    /// <summary>أقصى عدد كائنات الشرح تُحمَل لمن يدخل متأخرًا، وسقف بايتات لكل غرفة.</summary>
    private const int BoardObjectCap = 300;
    private const int BoardByteCap = 48_000;

    /// <summary>
    /// سقف دفعة الشرح: العميل يدمج حركة المؤشر في رسالة واحدة كل ~50 مللي ثانية،
    /// فالحركة السريعة تُنتج عشرات النقاط في الدفعة الواحدة. الرقمان معًا يمنعَان
    /// أن تتحول نافذة قلم واحدة إلى عشرات النداءات على نفس الاتصال.
    /// </summary>
    private const int AnnotationBatchCap = 64;
    private const int AnnotationBatchesPerSecond = 30;

    /// <summary>حدود الكائن الواحد — نفس أرقام `ANNOTATION_LIMITS` في الواجهة، والخادم لا يثق بها.</summary>
    private const int AnnotationPointsCap = 400;
    private const int AnnotationTextCap = 200;
    private const int AnnotationIdCap = 64;
    private const double AnnotationWidthMin = 1;
    private const double AnnotationWidthMax = 40;

    /// <summary>منع قرار على **الشخص**: اتصال ثانٍ لنفس الحساب أو عودة بعد انقطاع لا تلغيه.</summary>
    private sealed class PeerBlocks
    {
        public bool Speak;
        public bool Video;
        public bool Write;
        public bool Share;
        public bool Any => Speak || Video || Write || Share;
    }

    /// <summary>سقف الدور لكل حساب — المرجع الذي لا يتجاوزه قرار المدرس عند العودة.</summary>
    private sealed record PermissionDefaults(bool Speak, bool Video, bool Write, bool Share);

    /// <summary>كائن شرح واحد كما أرسَله صاحبه: JSON مُتحقَّق منه + من كتبه ليُعرف عند التراجع.</summary>
    private sealed class BoardObject
    {
        public string Id = "";
        public long AuthorUserId;
        public string Json = "";
        public int Bytes;
    }

    private sealed class RoomState
    {
        public ConcurrentDictionary<string, PeerInfo> Peers { get; } = new();
        public ConcurrentDictionary<long, PeerBlocks> Blocks { get; } = new();
        public ConcurrentDictionary<long, PermissionDefaults> Defaults { get; } = new();

        /// <summary>اللوحة بالترتيب: FIFO يسقط الأقدم عند السقف، والمفهرس بالمعرّف للممحاة والتراجع.</summary>
        public LinkedList<BoardObject> Objects { get; } = new();
        public Dictionary<string, LinkedListNode<BoardObject>> Index { get; } = new(StringComparer.Ordinal);
        public long ObjectBytes;

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
        // الصلاحيات الافتراضية قرار دور لا قرار العميل: الطالب يكتب ويتكلم ولا يشارك ملفًا
        // (المكتبة للحسابات الفريقية)، والمراقب بلا وسائط أصلًا والكتابة منه للمشرف لا لولي الأمر.
        var canWrite = resolvedRole != "observer" || aud == AccountKinds.Staff;
        var canShare = resolvedRole == "teacher";
        var defaults = new PermissionDefaults(resolvedRole != "observer", resolvedRole != "observer",
            canWrite, canShare);
        state.Defaults[userId] = defaults;
        // الاتصال الجديد له معرّف جديد، فالمنع الذي وضعه المدرس على هذا الحساب لا يُحمَل
        // من الاتصالات الحيّة (تنقطع فينمحو القرار) بل من سجل المنع على **معرّف الشخص**.
        state.Blocks.TryGetValue(userId, out var blocked);
        static bool Allowed(bool fromRole, bool isBlocked) => isBlocked ? false : fromRole;
        var self = new PeerInfo(Context.ConnectionId, userId, name, resolvedRole,
            Muted: blocked?.Speak == true,
            Camera: Allowed(defaults.Video, blocked?.Video == true),
            Hand: false,
            CanSpeak: Allowed(defaults.Speak, blocked?.Speak == true),
            CanVideo: Allowed(defaults.Video, blocked?.Video == true),
            CanWrite: Allowed(defaults.Write, blocked?.Write == true),
            CanShare: Allowed(defaults.Share, blocked?.Share == true));
        state.Peers[Context.ConnectionId] = self;

        await Groups.AddToGroupAsync(Context.ConnectionId, room);

        var existing = state.Peers.Values.Where(p => p.ConnId != Context.ConnectionId).ToList();
        await Clients.OthersInGroup(room).SendAsync("peer-joined", self);

        BoardSnapshot snapshot;
        lock (state.Objects)
        {
            snapshot = new BoardSnapshot(state.BoardOn, state.Stage, state.Objects.Select(o => o.Json).ToList(), state.Doc);
        }
        return new RoomInfo(room, Context.ConnectionId, self, existing, snapshot);
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
            // قرار المدرس يسبق إعلان العميل: مقفول الكلام لا يرجّع نفسه «غير مكتوم» بنداء مباشر.
            state.Peers[Context.ConnectionId] = peer with
            {
                Muted = peer.CanSpeak ? muted : true,
                Camera = peer.CanVideo ? camera : false,
                Hand = hand,
            };
            muted = state.Peers[Context.ConnectionId].Muted;
            camera = state.Peers[Context.ConnectionId].Camera;
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
    /// دفعة شرح: مصفوفة عمليات `add`/`del` على كائنات مُصنَّفة (قلم، ناسر، خط، سهم،
    /// مستطيل، دائرة، نص) بإحداثيات نسبية 0..1.
    ///
    /// كانت كل حركة مؤشر = نداء مستقل (`pointermove` على 60-120/ث) يُعاد رسمه عند
    /// كل طرف بالكامل، وهذا ما كان يُختنق به مسار الوسائط نفسه. الدمج في العميل
    /// والتخزين هنا والبثّ رسالة واحدة بقيا كما هما، **لكن التحقق صار للخادم لا
    /// للمتصفح**: ضربة تالفة من DevTools كانت تُطير كل ما على اللوحة، فكل كائن
    /// يُفحص حقلًا حقلًا ولا يُخزَّن ولا يُبثّ إلا إذا مرّ من هنا.
    ///
    /// المُرسَل هو ما قُبل فعلًا (لا ما أُرسل): لو كانت الدفعة فيها كائنًا تالفًا
    /// واحدًا بقي بقية الكائنات عند الجميع بلا فجوة صامتة.
    /// </summary>
    public async Task Annotate(string batchJson)
    {
        if (batchJson is null || batchJson.Length > 32_000) return;
        if (Context.Items["room"] is not string room) throw new HubException("انتهت صلاحية هذا الاتصال — أعد الانضمام إلى الغرفة.");
        if (!Rooms.TryGetValue(room, out var state) || !state.Peers.TryGetValue(Context.ConnectionId, out var peer))
            throw new HubException("انتهت صلاحية هذا الاتصال — أعد الانضمام إلى الغرفة.");
        if (!peer.CanWrite) throw new HubException("المدرس منع الكتابة على السبورة في الحصة دي.");
        if (!AnnotationBatchAllowed()) throw new HubException("الكتابة أسرع من المسموح — استنى جزء من الثانية.");

        var author = Convert.ToInt64(Context.Items["userId"] ?? 0L);
        var applied = new List<string>(AnnotationBatchCap);
        lock (state.Objects)
            {
                foreach (var op in ReadOps(batchJson))
                {
                    if (op.Kind == OpKind.Add)
                    {
                        if (state.Index.ContainsKey(op.Id)) continue;
                        var node = state.Objects.AddLast(new BoardObject
                        {
                            Id = op.Id,
                            AuthorUserId = author,
                            Json = op.Json,
                            Bytes = op.Json.Length,
                        });
                        state.Index[op.Id] = node;
                        state.ObjectBytes += node.Value.Bytes;
                        while (state.Objects.Count > BoardObjectCap || state.ObjectBytes > BoardByteCap)
                        {
                            var oldest = state.Objects.First;
                            if (oldest is null) break;
                            state.ObjectBytes -= oldest.Value.Bytes;
                            state.Index.Remove(oldest.Value.Id);
                            state.Objects.RemoveFirst();
                        }
                        applied.Add(WrapAdd(op.Json));
                    }
                    else
                    {
                        var removed = new List<string>(op.Ids.Count);
                        foreach (var id in op.Ids)
                        {
                            if (!state.Index.TryGetValue(id, out var node)) continue;
                            state.ObjectBytes -= node.Value.Bytes;
                            state.Objects.Remove(node);
                            state.Index.Remove(id);
                            removed.Add(id);
                        }
                        if (removed.Count > 0) applied.Add(DeletedOp(removed));
                    }
                }
            }

        if (applied.Count == 0) return;
        await Clients.OthersInGroup(room).SendAsync("annotate", Context.ConnectionId, applied);
    }

    /// <summary>
    /// تراجع زووم: يُمسح **آخر كائن كتبه هذا الحساب وحده**، لا آخر ما ظهر على الشاشة.
    /// يعيد المعرّف ليُطبَّقه كاتبه على لوحته فورًا، ويُخبَر به بقية الغرفة — فلو
    /// اعتمد المتصفح على ذاكرته المحلية لتناقضت اللوحة عند من يرى كائنين متشابهين.
    /// </summary>
    public async Task<string?> UndoAnnotation()
    {
        if (Context.Items["room"] is not string room) return null;
        if (!Rooms.TryGetValue(room, out var state) || !state.Peers.TryGetValue(Context.ConnectionId, out var peer)) return null;
        if (!peer.CanWrite) throw new HubException("المدرس منع الكتابة على السبورة في الحصة دي.");

        var author = Convert.ToInt64(Context.Items["userId"] ?? 0L);
        string? removedId = null;
        lock (state.Objects)
            {
                for (var node = state.Objects.Last; node is not null; node = node.Previous)
                {
                    if (node.Value.AuthorUserId != author) continue;
                    removedId = node.Value.Id;
                    state.ObjectBytes -= node.Value.Bytes;
                    state.Objects.Remove(node);
                    state.Index.Remove(removedId);
                    break;
                }
            }
        if (removedId is null) return null;
        await Clients.OthersInGroup(room).SendAsync("annotate", Context.ConnectionId, new[] { DeletedOp(new[] { removedId }) });
        return removedId;
    }

    /// <summary>
    /// مؤشر الشرح الحيّ: **يُمرَّر ولا يُخزَّن** — كما في زووم يختفي بعد لحظات، ومن
    /// يدخل متأخرًا لا ينبغي أن يرى أيدٍ بلا أصحابها. السقف أعلى من سقف الكتابة لأن
    /// الرسالة أرخص، والتجاوز **يُسقط الرسالة بصمت** لا برمي استثناء: أن يتأخر
    /// المؤشر أهون من أن تُغلق غرفة لأن أحدهم حرّك الفأرة بسرعة.
    /// </summary>
    public async Task SendPointer(double x, double y, string tool)
    {
        if (Context.Items["room"] is not string room) return;
        if (!Rooms.TryGetValue(room, out var state) || !state.Peers.TryGetValue(Context.ConnectionId, out var peer)) return;
        if (!peer.CanWrite) return;
        if (!double.IsFinite(x) || !double.IsFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
        if (!PointerAllowed()) return;
        var normalized = tool is ("highlighter" or "eraser" or "text" or "arrow") ? tool : "pen";
        await Clients.OthersInGroup(room).SendAsync("pointer", Context.ConnectionId, x, y, normalized);
    }

    private bool PointerAllowed()
    {
        const int pointersPerSecond = 20;
        var nowMs = Environment.TickCount64;
        if (Context.Items["pointerWindow"] is not StrokeWindow window)
        {
            window = new StrokeWindow { WindowStartMs = nowMs };
            Context.Items["pointerWindow"] = window;
        }
        if (nowMs - window.WindowStartMs >= 1000)
        {
            window.WindowStartMs = nowMs;
            window.Count = 0;
        }
        window.Count++;
        return window.Count <= pointersPerSecond;
    }

    /// <summary>
    /// المسح يصل **لكل** الغرفة بمن فيهم من ضغط الزر. كان `OthersInGroup` فيُصير
    /// المدرس هو الوحيد الذي يبقى ما كتبه على شاشته بعد أن تبيضّ شاشة الطالب —
    /// والمسح لا يتضاعف عند من يرسم محليًا لأنه وضعُ صفر لا زيادةُ رسم.
    /// </summary>
    public async Task ClearWhiteboard()
    {
        if (!IsHost()) throw new HubException("مسح السبورة للمدرس أو الإشراف فقط — الكتابة للطالب مسموحة.");
        if (Context.Items["room"] is not string room) return;
        if (Rooms.TryGetValue(room, out var state))
        {
            lock (state.Objects)
            {
                state.Objects.Clear();
                state.Index.Clear();
                state.ObjectBytes = 0;
            }
        }
        await Clients.Group(room).SendAsync("wb-clear", Context.ConnectionId);
    }

    /// <summary>
    /// كنترول المدرس على مشارك: إسكات، إطفاء كاميرا، قفل القلم، قفل الملف.
    /// تُكتب في حالة الغرفة على الخادم ثم تُبثّ لكل الغرفة — بمن فيه المستهدف نفسه
    /// الذي يطبّقها على مساراته، لأن بقية الغرفة لا ترى وسائطه بل تراها فقط تُرسل.
    /// </summary>
    public async Task SetPermissions(string targetConnId, bool? canSpeak, bool? canVideo, bool? canWrite, bool? canShare)
    {
        if (!IsHost()) throw new HubException("كنترول المشاركين للمدرس أو الإشراف فقط.");
        if (Context.Items["room"] is not string room) return;
        // كان النداء على معرّف خرج يرجع صامتًا، فتبقى شاشة المدرس قد بدّلت الزر وكذبت
        if (string.IsNullOrEmpty(targetConnId) || !Rooms.TryGetValue(room, out var state)
            || !state.Peers.TryGetValue(targetConnId, out var target))
        {
            throw new HubException("هذا المشارك لم يعد في الغرفة — المنع يُوجَّه لحساب موجود فيها.");
        }

        var def = state.Defaults.TryGetValue(target.UserId, out var d)
            ? d
            : new PermissionDefaults(true, true, true, true);
        // المدرس يحصر لا يرفع: طلب «اسمح بالمشاركة» لطالب سقف دوره لا يشارك يبقى محصورًا
        static bool Blocked(bool? requested, bool current, bool roleAllows) =>
            !roleAllows || !(requested ?? current);
        var blocks = new PeerBlocks
        {
            Speak = Blocked(canSpeak, target.CanSpeak, def.Speak),
            Video = Blocked(canVideo, target.CanVideo, def.Video),
            Write = Blocked(canWrite, target.CanWrite, def.Write),
            Share = Blocked(canShare, target.CanShare, def.Share),
        };
        if (blocks.Any) state.Blocks[target.UserId] = blocks;
        else state.Blocks.TryRemove(target.UserId, out _);

        // القرار على الشخص لا على المقبس: كل اتصال حيّ لهذا الحساب يأخذه وتصله رسالته
        foreach (var peer in state.Peers.Values.Where(p => p.UserId == target.UserId).ToList())
        {
            var updated = peer with
            {
                CanSpeak = def.Speak && !blocks.Speak,
                CanVideo = def.Video && !blocks.Video,
                CanWrite = def.Write && !blocks.Write,
                CanShare = def.Share && !blocks.Share,
            };
            if (!updated.CanSpeak) updated = updated with { Muted = true };
            if (!updated.CanVideo) updated = updated with { Camera = false };
            state.Peers[peer.ConnId] = updated;

            await Clients.Group(room).SendAsync("perms", updated.ConnId, updated.CanSpeak, updated.CanVideo,
                updated.CanWrite, updated.CanShare, updated.Muted, updated.Camera);
        }
    }

    /// <summary>نافذة ثانية واحدة لكل اتصال: رسائل الشرح لا نقاطها هو ما يُقاس.</summary>
    private bool AnnotationBatchAllowed()
    {
        var nowMs = Environment.TickCount64;
        if (Context.Items["strokeWindow"] is not StrokeWindow window)
        {
            window = new StrokeWindow { WindowStartMs = nowMs };
            Context.Items["strokeWindow"] = window;
        }
        if (nowMs - window.WindowStartMs >= 1000)
        {
            window.WindowStartMs = nowMs;
            window.Count = 0;
        }
        window.Count++;
        return window.Count <= AnnotationBatchesPerSecond;
    }

    private enum OpKind { Add, Del }

    private readonly record struct BoardOp(OpKind Kind, string Id, string Json, IReadOnlyList<string> Ids);

    /// <summary>
    /// دفعة مفسَّرة إلى عمليات: ما لا يُفهم يُترك بلا عقاب للغرفة كلها، وما يُفهم
    /// لا يمر إلا بعد <see cref="AnnotationOk"/> — فالخادم هنا هو المرجع لا المتصفح.
    /// </summary>
    private static List<BoardOp> ReadOps(string batchJson)
    {
        var accepted = new List<BoardOp>(AnnotationBatchCap);
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(batchJson);
            if (document.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array) return accepted;
            foreach (var element in document.RootElement.EnumerateArray())
            {
                if (accepted.Count >= AnnotationBatchCap) break;
                if (element.ValueKind != System.Text.Json.JsonValueKind.Object) continue;
                var kind = element.TryGetProperty("op", out var op) && op.ValueKind == System.Text.Json.JsonValueKind.String
                    ? op.GetString()
                    : null;
                if (kind == "add")
                {
                    if (!element.TryGetProperty("a", out var annotation) || !AnnotationOk(annotation)) continue;
                    accepted.Add(new BoardOp(OpKind.Add, ReadId(annotation), annotation.GetRawText(), Array.Empty<string>()));
                }
                else if (kind == "del")
                {
                    if (!element.TryGetProperty("ids", out var ids) || ids.ValueKind != System.Text.Json.JsonValueKind.Array) continue;
                    var list = new List<string>(AnnotationBatchCap);
                    foreach (var id in ids.EnumerateArray())
                    {
                        if (list.Count >= AnnotationBatchCap) break;
                        if (id.ValueKind != System.Text.Json.JsonValueKind.String) continue;
                        var text = id.GetString();
                        if (string.IsNullOrEmpty(text) || text.Length > AnnotationIdCap) continue;
                        list.Add(text);
                    }
                    if (list.Count > 0) accepted.Add(new BoardOp(OpKind.Del, "", "", list));
                }
            }
        }
        catch (System.Text.Json.JsonException)
        {
            // دفعة غير مفسَّرة: تُترك كما هي، ولا تُعقِب عليها الغرفة كلها
        }
        return accepted;
    }

    private static string ReadId(System.Text.Json.JsonElement annotation) => annotation.GetProperty("id").GetString()!;

    /// <summary>
    /// فحص حقلًا حقلًا بحدود `ANNOTATION_LIMITS`: الأداة من القائمة، والمعرّف غير طويل، واللون
    /// `#hex`، والسماكة في المدى، والنقاط أزواجًا داخل 0..1 بعدد يسمح به الشكل، والنص
    /// للحاجة النصية وحدها وبسقف. كائن واحد تالف لا يُبثّ ولا يُخزَّن، وبقية الدفعة تمر.
    /// </summary>
    private static bool AnnotationOk(System.Text.Json.JsonElement element)
    {
        if (element.ValueKind != System.Text.Json.JsonValueKind.Object) return false;
        if (!element.TryGetProperty("id", out var id)
            || id.ValueKind != System.Text.Json.JsonValueKind.String) return false;
        var idText = id.GetString();
        if (string.IsNullOrEmpty(idText) || idText.Length > AnnotationIdCap) return false;

        if (!element.TryGetProperty("tool", out var tool) || tool.ValueKind != System.Text.Json.JsonValueKind.String) return false;
        var name = tool.GetString();
        if (name is not ("pen" or "highlighter" or "line" or "arrow" or "rect" or "ellipse" or "text")) return false;

        if (!element.TryGetProperty("color", out var color)
            || color.ValueKind != System.Text.Json.JsonValueKind.String || !SafeColor(color.GetString())) return false;

        if (!element.TryGetProperty("width", out var width) || width.ValueKind != System.Text.Json.JsonValueKind.Number) return false;
        var w = width.GetDouble();
        if (!double.IsFinite(w) || w < AnnotationWidthMin || w > AnnotationWidthMax) return false;

        if (!element.TryGetProperty("points", out var points) || points.ValueKind != System.Text.Json.JsonValueKind.Array) return false;
        var count = 0;
        foreach (var value in points.EnumerateArray())
        {
            if (count >= AnnotationPointsCap * 2) return false;
            if (value.ValueKind != System.Text.Json.JsonValueKind.Number) return false;
            var number = value.GetDouble();
            if (!double.IsFinite(number) || number < 0 || number > 1) return false;
            count++;
        }
        if (count < 2 || count % 2 != 0) return false;
        var expected = name switch
        {
            "text" => 2,
            "line" or "arrow" or "rect" or "ellipse" => 4,
            _ => 0,
        };
        if (expected != 0 && count != expected) return false;

        if (name == "text")
        {
            if (!element.TryGetProperty("text", out var text) || text.ValueKind != System.Text.Json.JsonValueKind.String) return false;
            var value = text.GetString();
            if (string.IsNullOrEmpty(value) || value.Length > AnnotationTextCap) return false;
        }
        return true;
    }

    /// <summary>عملية حذف بصيغة الشبكة، تُكتب من الخادم حتى لا يثق العميل بصيغة طرف آخر.</summary>
    private static string DeletedOp(IReadOnlyList<string> ids) =>
        System.Text.Json.JsonSerializer.Serialize(new { op = "del", ids });

    /// <summary>
    /// كائن مُتحقَّق منه داخل عملية add: القناة الحيّة تحمل العمليات دائمًا (لا الكائن
    /// عاريًا) كما أُرسلت، بينما اللقطة المحفوظة تحمل الكائن وحده.
    /// </summary>
    private static string WrapAdd(string annotationJson) => $"{{\"op\":\"add\",\"a\":{annotationJson}}}";

    private static bool SafeColor(string? color) =>
        color is not null && System.Text.RegularExpressions.Regex.IsMatch(color, "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$");

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
        if (Context.Items["room"] is not string room) return;
        if (!Rooms.TryGetValue(room, out var state) || !state.Peers.TryGetValue(Context.ConnectionId, out var peer)) return;
        // القيد قرار المدرس لا الدور وحده: `canShare` ممنوحة من الخادم فتكفي، وسحبها يوقف
        // المشاركة في نفس اللحظة لأن الفحص هنا لا في الواجهة.
        if (!IsHost() && !peer.CanShare) throw new HubException("عرض الملفات داخل الحصة للمدرس أو لمن سمح له المدرس.");
        var sessionId = Convert.ToInt64(Context.Items["sessionId"] ?? 0L);
        if (sessionId == 0) return;
        if (docJson is null || docJson.Length > 2048) throw new HubException("وصف الملف غير صالح.");

        if (docJson == "null")
        {
            RevokeDoc(state, sessionId);
            state.Doc = null;
            // بإغلاق الملف تعود السبورة إن كانت ما زالت مفتوحة، وإلا يعود الفيديو.
            state.Stage = state.BoardOn ? "board" : "video";
            await Clients.Group(room).SendAsync("doc", null, Context.ConnectionId);
            await Clients.Group(room).SendAsync("stage", state.Stage, state.BoardOn, Context.ConnectionId);
            return;
        }

        var fileId = ReadFileId(docJson);
        var tenantId = Convert.ToInt64(Context.Items["tenantId"] ?? 1L);
        var userId = Convert.ToInt64(Context.Items["userId"] ?? 0L);
        var aud = (string?)Context.Items["aud"] ?? AccountKinds.Staff;
        if (aud != AccountKinds.Staff) throw new HubException("مكتبة الملفات لحسابات الفريق — اطلب من المدرس يرفع الملف.");
        var owns = await _db.Files.AnyAsync(f => f.Id == fileId && f.OwnerId == userId && f.TenantId == tenantId);
        if (!owns) throw new HubException("هذا الملف ليس في مكتبتك.");

        // المنح مقصور على المستند المعروض الآن: ما سبقه لم يعد يُنزَّل من الغرفة
        RevokeDoc(state, sessionId);
        state.Doc = docJson;
        RoomSharedDocs.Grant(sessionId, fileId);
        // المسرح يُقرَّر هنا لا في الواجهة وحدها: لو بقيت السبورة مغلقة في حالة الغرفة
        // ورأى كل من يدخل متأخرًا مستندًا مفتوحًا بلا سطح كتابة فوقه.
        state.BoardOn = true;
        state.Stage = "doc";

        await Clients.Group(room).SendAsync("doc", docJson, Context.ConnectionId);
        await Clients.Group(room).SendAsync("stage", state.Stage, state.BoardOn, Context.ConnectionId);
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
