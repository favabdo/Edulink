import * as signalR from '@microsoft/signalr'
import { apiFetch, readToken } from '../../lib/apiClient'
import { HUB_BASE_URL } from '../../lib/constants'
import type { SharedDoc } from './documents'
import { sanitizeIceServers } from './iceConfig'
import { parseSegment } from './whiteboard'

/**
 * عميل الاجتماعات الحقيقي: SignalR للإشارات + WebRTC P2P للوسائط.
 *
 * كل حصة = غرفة مستقلة (`room = كود الحصة`). المشاركون 1 مدرس + 1 طالب + مراقبون،
 * والشبكة mesh لأن الغرف ثنائية بالأساس — الوسائط لا تمر بالخادم إطلاقًا.
 */

export type ParticipantRole = 'teacher' | 'student' | 'observer'

export type Peer = {
  connId: string
  userId: number
  name: string
  role: ParticipantRole
  muted: boolean
  camera: boolean
  hand: boolean
}

export type ChatMessage = {
  id: string
  from: string
  name: string
  role: ParticipantRole | 'self'
  text: string
  at: string
  mine: boolean
}

export type Stroke = { x1: number; y1: number; x2: number; y2: number; color: string }

/** ما يضعه المدرس على المسرح: وجوه المشاركين، أو السبورة، أو المستند تحت القلم */
export type StageKind = 'video' | 'board' | 'doc';

export type BoardInit = {
  boardOn: boolean;
  stage: StageKind;
  segments: Stroke[];
  doc: SharedDoc | null;
};

export type MeetingStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'denied'

/** نوع مسار الوسائط بيني وبين مشارك — `relay` وحده يعني أنه يعمل عبر خادم وسيط (TURN) */
export type PeerLink = {
  state: RTCPeerConnectionState
  transport: 'host' | 'srflx' | 'relay' | 'unknown'
  /** بايتات مستقبَلة فعلًا: الدليل على أن الصورة والصوت يمرّان، لا أن ICE فقط «اتصل» */
  inboundBytes: number
}

export type MeetingEvents = {
  onPeers: (peers: Peer[]) => void
  onStream: (connId: string, stream: MediaStream | null) => void
  onChat: (message: ChatMessage) => void
  onStroke: (stroke: Stroke) => void
  onBoardClear: () => void
  /** قرار المدرس على المسرح يصل للجميع — الطالب لا يضغط شيئًا ليرى السبورة */
  onStage: (stage: StageKind, boardOn: boolean, fromConnId: string) => void
  /** المستند المعروض تحت القلم (null = أُغلق) */
  onDoc: (doc: SharedDoc | null, fromConnId: string) => void
  /** ما كان على السبورة قبل أن أدخل: الضربات والمستند والمسرح */
  onBoardInit: (init: BoardInit) => void
  onEnded: (by: string, durationIso: string) => void
  onStatus: (status: MeetingStatus) => void
  onFatal: (message: string) => void
  /** سبب حقيقي لا يجب أن يسقط بصمت: تفاوض فاشل، إذن مرفوض، ضربة تالفة */
  onNotice: (message: string) => void
  /** حالة مسار الوسائط لكل مشارك (host/srflx/relay + بايتات مستقبَلة) */
  onLink: (connId: string, link: PeerLink) => void
  /** تعذّر قراءة إعداد ICE من الخادم: الغرفة تعمل على STUN العام فقط، وهذا يسقط على شبكات NAT الصارمة */
  onIceDegraded: (reason: IceDegradation) => void
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
]

/** خادم التخطيط البارد من إعدادات السيرفر (STUN + TURN بتوقيع مؤقت) — مع سقوط آمن لـ STUN العام */
let iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS

export type IceDegradation = 'request-failed' | 'empty-response'

export async function ensureIceServers(): Promise<IceDegradation | null> {
  try {
    const res = await withTimeout(
      apiFetch<{ iceServers: RTCIceServer[] }>('/api/meeting/ice'),
      5_000,
    )
    const usable = sanitizeIceServers(res.iceServers)
    if (usable.length === 0) {
      iceServers = DEFAULT_ICE_SERVERS
      return 'empty-response'
    }
    iceServers = usable
    return null
  } catch {
    iceServers = DEFAULT_ICE_SERVERS
    return 'request-failed'
  }
}

/** إعدادات الكاميرا/الميكروفون من شاشة ما قبل الانضمام */
export function readDevicePrefs(): { audioId?: string; videoId?: string } {
  try {
    return JSON.parse(window.localStorage.getItem('edulink.devices') ?? '{}') as { audioId?: string; videoId?: string }
  } catch {
    return {}
  }
}

export function writeDevicePrefs(prefs: { audioId?: string; videoId?: string }) {
  window.localStorage.setItem('edulink.devices', JSON.stringify(prefs))
}

/** stream المعاينة الذي سلّمته شاشة ما قبل الانضمام (إن وجد) — يُستهلك مرة واحدة */
export function takePreJoinStream(): MediaStream | null {
  const key = '__edulinkPreJoinStream'
  const stream = (window as unknown as Record<string, MediaStream | null>)[key] ?? null
  ;(window as unknown as Record<string, MediaStream | null>)[key] = null
  return stream && stream.getTracks().some((t) => t.readyState === 'live') ? stream : null
}

export function readJoinFlags(): { micOff: boolean; camOff: boolean } {
  try {
    const raw = JSON.parse(window.localStorage.getItem('edulink.joinFlags') ?? '{}') as {
      micOff?: boolean
      camOff?: boolean
    }
    return { micOff: raw.micOff ?? false, camOff: raw.camOff ?? false }
  } catch {
    return { micOff: false, camOff: false }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

/** نص مفيد من خطأ WebRTC — `DOMException` وحدها لا تُعرض لفائدة المستخدم */
function errorText(err: unknown): string {
  if (err instanceof DOMException) return `${err.message} (${err.name})`
  if (err instanceof Error) return err.message
  return String(err)
}

/** طلب الوسائط الحقيقي — يسقط تدريجيًا: كاميرا+صوت → صوت فقط → بلا وسائط (مستقبل فقط).
 *  مع مهلة 10 ثوانٍ حتى لا تُعلَّق غرفة الحصة إذا لم يُجاوب طلب الإذن. */
export async function acquireLocalMedia(role: ParticipantRole): Promise<MediaStream | null> {
  if (role === 'observer') return null // المراقب يستقبل فقط — بلا كاميرا ولا ميكروفون
  const { audioId, videoId } = readDevicePrefs()
  try {
    return await withTimeout(
      navigator.mediaDevices.getUserMedia({
        audio: audioId ? { deviceId: { exact: audioId } } : true,
        video: videoId ? { deviceId: { exact: videoId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
      }),
      10_000,
    )
  } catch {
    try {
      return await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true, video: false }), 8_000)
    } catch {
      return null
    }
  }
}

export class MeetingClient {
  private hub: signalR.HubConnection
  private readonly peers = new Map<string, Peer>()
  private readonly pcs = new Map<string, RTCPeerConnection>()
  private readonly pendingIce = new Map<string, RTCIceCandidateInit[]>()
  private readonly renegotiating = new Set<string>()
  private local: MediaStream | null = null
  /** MediaStream التي تغلّف مسار المشاركة حتى يقبلها addTrack */
  private shareStream: MediaStream | null = null
  private selfConn = ''
  private lastNotice = ''
  private started = false
  private readonly room: string
  private readonly role: ParticipantRole
  private readonly selfName: string
  private readonly ev: MeetingEvents

  constructor(room: string, role: ParticipantRole, selfName: string, ev: MeetingEvents) {
    this.room = room
    this.role = role
    this.selfName = selfName
    this.ev = ev
    this.hub = new signalR.HubConnectionBuilder()
      .withUrl(`${HUB_BASE_URL}/hubs/meetings?access_token=${encodeURIComponent(readToken() ?? '')}&room=${encodeURIComponent(room)}`)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .configureLogging(signalR.LogLevel.Warning)
      .build()

    this.bind()
  }

  private bind() {
    this.hub.on('peer-joined', (peer: Peer) => {
      this.peers.set(peer.connId, peer)
      // الطرف الموجود مسبقًا هو المبادر (impolite) — يتجنب تصادم العروض
      this.createPeer(peer.connId, true)
      this.ev.onPeers(this.snapshot())
    })

    this.hub.on('peer-left', (connId: string) => {
      this.peers.delete(connId)
      this.closePeer(connId)
      this.ev.onStream(connId, null)
      this.ev.onPeers(this.snapshot())
    })

    this.hub.on('offer', async (from: string, sdp: string) => {
      const pc = this.ensurePeer(from)
      try {
        await this.applyRemote(pc, from, 'offer', sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await this.hub.invoke('sendAnswer', from, pc.localDescription?.sdp ?? '')
      } catch (err) {
        this.ev.onNotice(`تعذّر قبول عرض من ${this.peers.get(from)?.name ?? 'مشارك'}: ${errorText(err)}`)
      }
    })

    this.hub.on('answer', async (from: string, sdp: string) => {
      const pc = this.pcs.get(from)
      if (!pc) return
      // كان يُمرَّر type:'offer' للعرض والإجابة معًا، فيعلّق الاتصال بلا أي خطأ ظاهر
      try {
        await this.applyRemote(pc, from, 'answer', sdp)
      } catch (err) {
        this.ev.onNotice(`تعذّرت إكمال الاتصال بـ ${this.peers.get(from)?.name ?? 'مشارك'}: ${errorText(err)}`)
      }
    })

    this.hub.on('ice', async (from: string, candidate: string) => {
      let init: RTCIceCandidateInit | null = null
      try {
        init = JSON.parse(candidate) as RTCIceCandidateInit
      } catch {
        this.noticeOnce('وصلت معلومة مسار غير سليمة من مشارك — تُجاهَل.')
        return
      }
      if (!init?.candidate) return
      const pc = this.pcs.get(from)
      if (!pc || !pc.remoteDescription) {
        const list = this.pendingIce.get(from) ?? []
        list.push(init)
        this.pendingIce.set(from, list)
        return
      }
      try {
        await pc.addIceCandidate(init)
      } catch (err) {
        this.noticeOnce(`تعذّر إضافة معلومة مسار من ${this.peers.get(from)?.name ?? 'مشارك'}: ${errorText(err)}`)
      }
    })

    this.hub.on('state', (connId: string, muted: boolean, camera: boolean, hand: boolean) => {
      const peer = this.peers.get(connId)
      if (peer) {
        this.peers.set(connId, { ...peer, muted, camera, hand })
        this.ev.onPeers(this.snapshot())
      }
    })

    this.hub.on('chat', (connId: string, name: string, role: ParticipantRole, text: string, at: string) => {
      this.ev.onChat({ id: `${connId}-${at}-${Math.random()}`, from: connId, name, role, text, at, mine: false })
    })

    this.hub.on('stroke', (_connId: string, seg: string) => {
      const stroke = parseSegment(seg)
      if (stroke) this.ev.onStroke(stroke)
    })

    this.hub.on('wb-clear', () => this.ev.onBoardClear())

    this.hub.on('stage', (stage: string, boardOn: boolean, from: string) => {
      const kind: StageKind = stage === 'board' || stage === 'doc' ? stage : 'video'
      this.ev.onStage(kind, !!boardOn, from)
    })

    this.hub.on('doc', (docJson: string | null, from: string) => {
      if (!docJson) {
        this.ev.onDoc(null, from)
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(docJson)
      } catch {
        this.noticeOnce('وصل وصف مستند غير سليم — تُجاهَل.')
        return
      }
      const value = parsed as Record<string, unknown>
      if (typeof value?.fileId !== 'number' || typeof value?.page !== 'number') return
      this.ev.onDoc(
        {
          fileId: value.fileId,
          fileName: typeof value.fileName === 'string' ? value.fileName.slice(0, 255) : 'ملف',
          mime: typeof value.mime === 'string' ? value.mime.slice(0, 120) : 'application/pdf',
          page: value.page,
        },
        from,
      )
    })

    this.hub.on('ended', (by: string, duration: string) => this.ev.onEnded(by, duration))

    this.hub.onreconnecting(() => this.ev.onStatus('reconnecting'))
    this.hub.onreconnected(async () => {
      this.ev.onStatus('connected')
      await this.joinAndSync()
    })
    this.hub.onclose(() => this.ev.onStatus('disconnected'))
  }

  private snapshot(): Peer[] {
    return [...this.peers.values()]
  }

  /** الاتصال والانضمام — يجب أن يسبقه attachLocalMedia إن وُجدت وسائط */
  async start(local: MediaStream | null) {
    if (this.started) return
    this.started = true
    this.local = local
    this.ev.onStatus('connecting')
    const iceDegraded = await ensureIceServers()
    if (iceDegraded) this.ev.onIceDegraded(iceDegraded)
    try {
      await this.hub.start()
    } catch {
      this.ev.onStatus('denied')
      this.ev.onFatal('تعذّر الوصول إلى خادم الاجتماعات. تأكد أن الـ API يعمل على المنفذ 5279.')
      return
    }
    await this.joinAndSync()
    this.ev.onStatus('connected')
  }

  private async joinAndSync() {
    // تنظيف أي اتصالات قديمة قبل إعادة الانضمام
    for (const connId of [...this.pcs.keys()]) this.closePeer(connId)
    this.peers.clear()

    const info = (await this.hub.invoke('join', this.room, this.role, this.selfName)) as {
      room: string;
      self?: string;
      peers: Peer[];
      board?: { isOn?: boolean; stage?: string; segments?: string[]; doc?: string | null };
    }
    this.selfConn = info.self ?? ''
    for (const peer of info.peers) this.peers.set(peer.connId, peer)
    // الوافد الجديد يستقبل العروض من الموجودين — لا يبادر
    this.ev.onPeers(this.snapshot())

    const board = info.board
    const segments = (board?.segments ?? []).map(parseSegment).filter((s): s is Stroke => s !== null)
    let doc: SharedDoc | null = null
    if (board?.doc) {
      try {
        const parsed = JSON.parse(board.doc) as Record<string, unknown>
        if (typeof parsed.fileId === 'number' && typeof parsed.page === 'number') {
          doc = {
            fileId: parsed.fileId,
            fileName: typeof parsed.fileName === 'string' ? parsed.fileName : 'ملف',
            mime: typeof parsed.mime === 'string' ? parsed.mime : 'application/pdf',
            page: parsed.page,
          }
        }
      } catch {
        doc = null
      }
    }
    const stage: StageKind = board?.stage === 'board' || board?.stage === 'doc' ? board.stage : 'video'
    this.ev.onBoardInit({ boardOn: !!board?.isOn || doc !== null, stage, segments, doc })
  }

  private ensurePeer(connId: string): RTCPeerConnection {
    const existing = this.pcs.get(connId)
    if (existing) return existing
    return this.createPeer(connId, false)
  }

  /**
   * بناء الاتصال بفخّ أمان: رفض المتصفح لإعداد ICE (سطر فارغ في `Meeting:TurnUrls`
   * أو توقيع TURN خاطئ) كان يقتل ردّ `peer-joined` بصمت. هنا يسقط إلى STUN العام
   * ويخبر المستخدم بالسبب — لا غرفة صامتة تقول «متصل».
   */
  private buildConnection(connId: string): RTCPeerConnection {
    const name = this.peers.get(connId)?.name ?? 'مشارك';
    try {
      return new RTCPeerConnection({ iceServers });
    } catch (err) {
      this.noticeOnce(`إعداد الخادم الوسيط مرفوض من المتصفح (${errorText(err)}) — التجربة بخوادم STUN العامة.`);
      try {
        return new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });
      } catch (fatal) {
        this.noticeOnce(`تعذّر إنشاء اتصال مع ${name}: ${errorText(fatal)}`);
        throw fatal;
      }
    }
  }

  private createPeer(connId: string, initiator: boolean): RTCPeerConnection {
    const pc = this.buildConnection(connId)
    this.pcs.set(connId, pc)

    pc.onicecandidate = (e) => {
      if (e.candidate) void this.hub.invoke('sendIce', connId, JSON.stringify(e.candidate.toJSON())).catch(() => undefined)
    }

    pc.onicecandidateerror = (event) => {
      // فشل gathering هو أول ما يجب أن يراه المستخدم (لا صمت ولا زر ميت):
      // عادةً خادم وسيط غير مضبوط أو منفذ محجوب.
      const err = event as unknown as { host?: string; errorText?: string; errorCode?: number };
      const host = err.host ?? '';
      const reason = err.errorText ?? `رمز ${String(err.errorCode ?? '?')}`;
      this.noticeOnce(`تعذّر فحص مسار الوسائط${host ? ` مع ${host}` : ''}: ${reason}`);
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (stream) this.ev.onStream(connId, stream)
    }

    pc.onconnectionstatechange = () => {
      this.reportTransport(pc, connId)
      if (pc.connectionState === 'failed') {
        this.noticeOnce(
          `انقطاع الوسائط مع ${this.peers.get(connId)?.name ?? 'مشارك'} — يحتاج إعادة تفاوض أو خادمًا وسيطًا (TURN) على شبكتين مختلفتين.`,
        )
      }
      if (pc.connectionState === 'closed') this.closePeer(connId)
    }

    if (this.local) {
      for (const track of this.local.getTracks()) pc.addTrack(track, this.local)
    }

    if (initiator) {
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.hub.invoke('sendOffer', connId, pc.localDescription?.sdp ?? ''))
        .catch((err) => this.noticeOnce(`تعذّر بدء الاتصال بـ ${this.peers.get(connId)?.name ?? 'مشارك'}: ${errorText(err)}`))
    }
    return pc
  }

  /** إعادة نفس الرسالة بلا إغراق الشاشة عند فشل كل محاولة gathering */
  private noticeOnce(message: string) {
    if (this.lastNotice === message) return
    this.lastNotice = message
    this.ev.onNotice(message)
  }

  private async applyRemote(
    pc: RTCPeerConnection,
    connId: string,
    type: RTCSdpType,
    sdp: string,
  ) {
    await pc.setRemoteDescription({ type, sdp } as RTCSessionDescriptionInit)
    const buffered = this.pendingIce.get(connId) ?? []
    this.pendingIce.delete(connId)
    for (const c of buffered) await pc.addIceCandidate(c)
    this.reportTransport(pc, connId)
  }

  /**
   * نوع المسار + البايتات المستقبَلة فعلًا. تُقرأ أكثر من مرة لأن `inbound-rtp`
   * لا يظهر إلا بعد مرور وسائط، فلقطة واحدة بعد الوصف مباشرة تقول «متصل» وهي
   * صامتة — وهذا بالضبط ما يجب أن يُمسك لا أن يُحسب نجاحًا.
   */
  private reportTransport(pc: RTCPeerConnection, connId: string) {
    const emit = () => {
      if (this.pcs.get(connId) !== pc) return
      void (async () => {
        try {
          const stats = await pc.getStats()
          const rows = [...stats.values()]
          let transport: PeerLink['transport'] = 'unknown'
          let inboundBytes = 0
          // Chrome يشير للزوج المختار عبر الـ transport، علم `selected` على الزوج
          // نفسه غير موثوق — فالقراءة منه وحدها كانت تُظهر «غير معروف» وهو يعمل
          const transportStat = rows.find((s) => s.type === 'transport')
          const pairId = (transportStat as unknown as { selectedCandidatePairId?: string })?.selectedCandidatePairId
          const pair = (pairId ? stats.get(pairId) : undefined)
            ?? rows.find((s) => s.type === 'candidate-pair' && (s as unknown as { selected?: boolean }).selected)
            ?? rows.find((s) => s.type === 'candidate-pair' && (s as unknown as { nominated?: boolean }).nominated)
          const localId = (pair as unknown as { localCandidateId?: string })?.localCandidateId
          const local = localId ? stats.get(localId) : undefined
          const type = (local as unknown as { candidateType?: string })?.candidateType
          if (type === 'relay' || type === 'srflx' || type === 'host') transport = type
          rows.forEach((s) => {
            if (s.type === 'inbound-rtp') inboundBytes += (s as unknown as { bytesReceived?: number }).bytesReceived ?? 0
          })
          this.ev.onLink(connId, { state: pc.connectionState, transport, inboundBytes })
        } catch {
          this.ev.onLink(connId, { state: pc.connectionState, transport: 'unknown', inboundBytes: 0 })
        }
      })()
    }
    emit()
    // إعادة قياس بعد ثانيتين وأربع: الوسائط تبدأ بعد الوصف بقليل
    window.setTimeout(emit, 2000)
    window.setTimeout(emit, 4000)
  }

  private closePeer(connId: string) {
    const pc = this.pcs.get(connId)
    if (pc) {
      pc.ontrack = null
      pc.close()
      this.pcs.delete(connId)
    }
    this.pendingIce.delete(connId)
    this.renegotiating.delete(connId)
  }

  /**
   * استبدال مسار الفيديو المرسل (مشاركة شاشة أو كاميرا خلفية) أو إرجاع الكاميرا.
   *
   * كان المسار يُضاف إلى `this.local` فقط ثم يُعاد التفاوض — فلا يصل لأي اتصال
   * لأنه لم يُحقن في الـ RTCPeerConnection أصلًا، وهذا سبب «زرار مشاركة الشاشة
   * ما بيجيب حاجة». الآن: إن وُجد sender فيديو يُستبدل (بلا إعادة تفاوض)، وإلا
   * يُضاف المسار إلى ذلك الاتصال ثم يُعاد التفاوض عليه وحده.
   */
  async publishVideoTrack(track: MediaStreamTrack | null) {
    const camera = this.local?.getVideoTracks()[0] ?? null;

    for (const [connId, pc] of this.pcs) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      try {
        if (track) {
          if (sender) await sender.replaceTrack(track);
          else {
            pc.addTrack(track, this.shareStreamFor(track));
            this.renegotiate(connId, pc);
          }
        } else if (sender) {
          if (camera) await sender.replaceTrack(camera);
          else {
            pc.removeTrack(sender);
            this.renegotiate(connId, pc);
          }
        }
      } catch (err) {
        this.noticeOnce(`تعذّرت مشاركة الفيديو مع ${this.peers.get(connId)?.name ?? 'مشارك'}: ${errorText(err)}`);
      }
    }
  }

  /** WebRTC يطلب حزمة (MediaStream) مرتبطة بالمسار المرسل وإلا لا يراها الطرف الآخر */
  private shareStreamFor(track: MediaStreamTrack): MediaStream {
    if (this.local?.getTracks().includes(track)) return this.local;
    if (!this.shareStream) this.shareStream = new MediaStream([track]);
    else {
      for (const old of this.shareStream.getVideoTracks()) this.shareStream.removeTrack(old);
      this.shareStream.addTrack(track);
    }
    return this.shareStream;
  }

  private renegotiate(connId: string, pc: RTCPeerConnection) {
    if (this.renegotiating.has(connId)) return
    this.renegotiating.add(connId)
    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => this.hub.invoke('sendOffer', connId, pc.localDescription?.sdp ?? ''))
      .catch(() => undefined)
      .finally(() => this.renegotiating.delete(connId))
  }

  /** معرّف اتصالي في الغرفة — يعيده الخادم في نتيجة join (عميل SignalR لا يكشفه) */
  get selfConnId(): string {
    return this.selfConn
  }

  setState(muted: boolean, camera: boolean, hand: boolean) {
    void this.hub.invoke('setState', muted, camera, hand).catch(() => undefined)
  }

  sendChat(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return null
    const at = new Date().toISOString()
    const id = `self-${at}-${Math.random()}`
    void this.hub.invoke('sendChat', trimmed).catch(() => undefined)
    return { id, from: 'self', name: this.selfName, role: 'self' as const, text: trimmed, at, mine: true } satisfies ChatMessage
  }

  sendStroke(stroke: Stroke) {
    void this.hub.invoke('sendStroke', JSON.stringify(stroke)).catch(() => undefined)
  }

  clearBoard() {
    void this.hub.invoke('clearWhiteboard').catch(() => undefined)
  }

  /** قرار المدرس: ما الذي يشغل المسرح، وهل السبورة مفتوحة أصلًا */
  setStage(stage: StageKind, boardOn: boolean) {
    return this.hub.invoke('setStage', stage, boardOn)
  }

  /** عرض مستند تحت القلم (null = إغلاقه) */
  shareDoc(doc: SharedDoc | null) {
    return this.hub.invoke('shareDocument', doc ? JSON.stringify(doc) : 'null')
  }

  /** إعادة تفاوض بعد `failed` — بلا هذه الزر يضطر المستخدم للخروج والدخول */
  retryPeer(connId: string) {
    const pc = this.pcs.get(connId)
    if (!pc) return
    this.closePeer(connId)
    this.createPeer(connId, true)
  }

  endRoom(durationIso: string) {
    return this.hub.invoke('endRoom', durationIso)
  }

  stop() {
    for (const connId of [...this.pcs.keys()]) this.closePeer(connId)
    this.local?.getTracks().forEach((t) => t.stop())
    this.local = null
    void this.hub.stop()
  }
}
