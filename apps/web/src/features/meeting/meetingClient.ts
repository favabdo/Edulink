import * as signalR from '@microsoft/signalr'
import { apiFetch, readToken } from '../../lib/apiClient'
import { HUB_BASE_URL } from '../../lib/constants'

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

export type MeetingStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'denied'

export type MeetingEvents = {
  onPeers: (peers: Peer[]) => void
  onStream: (connId: string, stream: MediaStream | null) => void
  onChat: (message: ChatMessage) => void
  onStroke: (stroke: Stroke) => void
  onBoardClear: () => void
  onEnded: (by: string, durationIso: string) => void
  onStatus: (status: MeetingStatus) => void
  onFatal: (message: string) => void
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
    if (res.iceServers?.length) {
      iceServers = res.iceServers
      return null
    }
    iceServers = DEFAULT_ICE_SERVERS
    return 'empty-response'
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
      await this.setRemote(pc, from, sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await this.hub.invoke('sendAnswer', from, pc.localDescription?.sdp ?? '')
    })

    this.hub.on('answer', async (from: string, sdp: string) => {
      const pc = this.pcs.get(from)
      if (pc) await this.setRemote(pc, from, sdp)
    })

    this.hub.on('ice', async (from: string, candidate: string) => {
      const pc = this.pcs.get(from)
      if (!pc || !pc.remoteDescription) {
        const list = this.pendingIce.get(from) ?? []
        list.push(JSON.parse(candidate) as RTCIceCandidateInit)
        this.pendingIce.set(from, list)
        return
      }
      await pc.addIceCandidate(JSON.parse(candidate) as RTCIceCandidateInit)
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
      try {
        this.ev.onStroke(JSON.parse(seg) as Stroke)
      } catch {
        // تجاهل أي مقطع تالف
      }
    })

    this.hub.on('wb-clear', () => this.ev.onBoardClear())

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

    const info = (await this.hub.invoke('join', this.room, this.role, this.selfName)) as { room: string; peers: Peer[] }
    for (const peer of info.peers) this.peers.set(peer.connId, peer)
    // الوافد الجديد يستقبل العروض من الموجودين — لا يبادر
    this.ev.onPeers(this.snapshot())
  }

  private ensurePeer(connId: string): RTCPeerConnection {
    const existing = this.pcs.get(connId)
    if (existing) return existing
    return this.createPeer(connId, false)
  }

  private createPeer(connId: string, initiator: boolean): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers })
    this.pcs.set(connId, pc)

    pc.onicecandidate = (e) => {
      if (e.candidate) void this.hub.invoke('sendIce', connId, JSON.stringify(e.candidate.toJSON()))
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      if (stream) this.ev.onStream(connId, stream)
    }

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        this.ev.onStream(connId, null)
        this.closePeer(connId)
      }
    }

    if (this.local) {
      for (const track of this.local.getTracks()) pc.addTrack(track, this.local)
    }

    if (initiator) {
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.hub.invoke('sendOffer', connId, pc.localDescription?.sdp ?? ''))
        .catch(() => undefined)
    }
    return pc
  }

  private async setRemote(pc: RTCPeerConnection, connId: string, sdp: string) {
    await pc.setRemoteDescription({ type: 'offer', sdp } as RTCSessionDescriptionInit)
    const buffered = this.pendingIce.get(connId) ?? []
    this.pendingIce.delete(connId)
    for (const c of buffered) await pc.addIceCandidate(c)
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

  /** استبدال/إضافة مسار الفيديو (مشاركة الشاشة) في كل الاتصالات بإعادة تفاوض */
  async publishVideoTrack(track: MediaStreamTrack | null) {
    for (const [connId, pc] of this.pcs) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
      try {
        if (sender && track) {
          await sender.replaceTrack(track)
        } else {
          if (this.local && track) this.local.addTrack(track)
          if (this.local && !track) {
            const old = this.local.getVideoTracks()[0]
            if (old) this.local.removeTrack(old)
          }
          this.renegotiate(connId, pc)
        }
      } catch {
        // اتصال ميت سيُزال عبر onconnectionstatechange
      }
    }
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
