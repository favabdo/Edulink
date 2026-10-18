import {
  ArrowLeft,
  Ban,
  Check,
  Circle,
  Eraser,
  Hand,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Monitor,
  MonitorOff,
  Pen,
  PhoneOff,
  ShieldQuestion,
  Users,
  Video as VideoIcon,
  VideoOff as VideoOffIcon,
  Mic,
  MicOff,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ROUTES } from '../../app/router/paths'
import { useAuth } from '../../features/auth/authContext'
import {
  acquireLocalMedia,
  MeetingClient,
  readJoinFlags,
  takePreJoinStream,
  type ChatMessage,
  type IceDegradation,
  type MeetingStatus,
  type Peer,
  type Stroke,
} from '../../features/meeting/meetingClient'
import { useLanguage } from '../../i18n/useLanguage'
import { effectiveRoleFor, participantRoleFor, roleLabelKey } from '../../lib/roles'
import { subjectDisplayName } from '../../lib/data/eduStore'
import { useAppData } from '../../features/sessions/DataProvider'
import styles from './ClassroomPage.module.css'

const BOARD_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#111827'] as const

type Phase = 'live' | 'confirm' | 'summary' | 'saved'
type PanelTab = 'chat' | 'people'

function mmss(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** غرفة الحصة الحقيقية — WebRTC عبر MeetingHub، كل حصة room منفصل بكودها */
export function ClassroomPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const { sessions, students, teachers, loading, endSessionAction, markAttendanceAction } = useAppData()
  const session = sessions.find((s) => s.id === Number(sessionId)) ?? null
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()

  const role = effectiveRoleFor(user)
  const participantRole = participantRoleFor(role)
  const isObserver = participantRole === 'observer'
  const selfName = user?.name ?? user?.email ?? ''

  const clientRef = useRef<MeetingClient | null>(null)
  const startedAtRef = useRef<number>(Date.now())
  const boardCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const strokesRef = useRef<Stroke[]>([])

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [streams, setStreams] = useState<Record<string, MediaStream>>({})
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<MeetingStatus>('connecting')
  const [fatal, setFatal] = useState<string | null>(null)
  const [iceNotice, setIceNotice] = useState<IceDegradation | null>(null)
  const [phase, setPhase] = useState<Phase>('live')
  const [endedBy, setEndedBy] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [handRaised, setHandRaised] = useState(false)
  const [screenOn, setScreenOn] = useState(false)
  const [stageMode, setStageMode] = useState<'video' | 'board'>('video')
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<PanelTab>('chat')
  const [draft, setDraft] = useState('')
  const [boardColor, setBoardColor] = useState<string>(BOARD_COLORS[0])
  const [attendance, setAttendance] = useState<'present' | 'late' | 'absent'>('present')
  const [note, setNote] = useState('')

  // ---------------- تهيئة الجلسة ----------------
  useEffect(() => {
    if (!session) return
    let disposed = false
    let client: MeetingClient | null = null

    async function boot() {
      const flags = readJoinFlags()
      let media = takePreJoinStream()
      if (!media && !isObserver) media = await acquireLocalMedia(participantRole)
      if (disposed) {
        media?.getTracks().forEach((tr) => tr.stop())
        return
      }
      if (media) {
        media.getAudioTracks().forEach((tr) => (tr.enabled = !flags.micOff))
        media.getVideoTracks().forEach((tr) => (tr.enabled = !flags.camOff))
        setLocalStream(media)
        setMicOn(!flags.micOff)
        setCamOn(!flags.camOff)
      }
      startedAtRef.current = Date.now()

      client = new MeetingClient(session!.code, participantRole, selfName, {
        onPeers: (list) => !disposed && setPeers(list),
        onStream: (connId, stream) => {
          if (disposed) return
          setStreams((prev) => {
            const next = { ...prev }
            if (stream) next[connId] = stream
            else delete next[connId]
            return next
          })
        },
        onChat: (msg) => !disposed && setChat((prev) => [...prev, msg]),
        onStroke: (stroke) => {
          strokesRef.current.push(stroke)
          drawStroke(stroke)
        },
        onBoardClear: () => {
          strokesRef.current = []
          clearCanvas()
        },
        onEnded: (by) => {
          if (disposed) return
          setEndedBy(by)
          setPhase('summary')
        },
        onStatus: (s) => !disposed && setStatus(s),
        onFatal: (message) => !disposed && setFatal(message),
        onIceDegraded: (reason) => !disposed && setIceNotice(reason),
      })
      clientRef.current = client
      await client.start(media)
      if (!disposed && media) client.setState(flags.micOff, flags.camOff, false)
    }

    void boot()
    return () => {
      disposed = true
      clientRef.current?.stop()
      clientRef.current = null
      localStream?.getTracks().forEach((tr) => tr.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.code])

  // ---------------- المؤقّت ----------------
  useEffect(() => {
    if (phase !== 'live' || status !== 'connected') return
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [phase, status])

  // ---------------- لوحة ----------------
  useEffect(() => {
    if (stageMode === 'board') redrawBoard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageMode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (phase === 'confirm') setPhase('live')
        else setPanelOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase])

  // سياسة autoplay: أول تفاعل في الصفحة يفتح صوت كل البلاطات البعيدة لو كان محجوبًا
  useEffect(() => {
    const unlock = () => {
      document.querySelectorAll('video').forEach((v) => {
        if (!v.muted) void v.play().catch(() => undefined)
      })
    }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  function canvasSize(): { w: number; h: number } | null {
    const canvas = boardCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    if (canvas.width !== Math.round(rect.width * devicePixelRatio)) {
      canvas.width = Math.round(rect.width * devicePixelRatio)
      canvas.height = Math.round(rect.height * devicePixelRatio)
    }
    return { w: canvas.width, h: canvas.height }
  }

  function drawStroke(stroke: Stroke) {
    const canvas = boardCanvasRef.current
    const size = stageMode === 'board' ? canvasSize() : null
    if (!canvas || !size) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = 2.5 * devicePixelRatio
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(stroke.x1 * size.w, stroke.y1 * size.h)
    ctx.lineTo(stroke.x2 * size.w, stroke.y2 * size.h)
    ctx.stroke()
  }

  function clearCanvas() {
    const canvas = boardCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
  }

  function redrawBoard() {
    const canvas = boardCanvasRef.current
    if (!canvas) return
    canvasSize()
    clearCanvas()
    for (const s of strokesRef.current) drawStroke(s)
  }

  const pointerToStroke = (e: React.PointerEvent<HTMLCanvasElement>, prev: { x: number; y: number } | null): Stroke | null => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (!prev) return null
    return { x1: prev.x, y1: prev.y, x2: x, y2: y, color: boardColor }
  }

  const drawingPrev = useRef<{ x: number; y: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isObserver) return
    const rect = e.currentTarget.getBoundingClientRect()
    drawingPrev.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingPrev.current || isObserver) return
    const stroke = pointerToStroke(e, drawingPrev.current)
    if (stroke) {
      strokesRef.current.push(stroke)
      drawStroke(stroke)
      clientRef.current?.sendStroke(stroke)
    }
    const rect = e.currentTarget.getBoundingClientRect()
    drawingPrev.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }
  }

  const onPointerUp = () => {
    drawingPrev.current = null
  }

  // ---------------- أزرار التحكم ----------------
  const toggleMic = () => {
    if (isObserver) return
    const next = !micOn
    setMicOn(next)
    localStream?.getAudioTracks().forEach((tr) => (tr.enabled = next))
    clientRef.current?.setState(!next, camOn, handRaised)
  }

  const toggleCam = () => {
    if (isObserver) return
    const next = !camOn
    setCamOn(next)
    localStream?.getVideoTracks().forEach((tr) => (tr.enabled = next))
    clientRef.current?.setState(!micOn, next, handRaised)
  }

  const toggleHand = () => {
    const next = !handRaised
    setHandRaised(next)
    clientRef.current?.setState(!micOn, camOn, next)
  }

  const screenTrackRef = useRef<MediaStreamTrack | null>(null)

  const toggleScreen = async () => {
    if (isObserver) return
    if (screenOn) {
      screenTrackRef.current?.stop()
      screenTrackRef.current = null
      setScreenOn(false)
      await clientRef.current?.publishVideoTrack(localStream?.getVideoTracks()[0] ?? null)
      return
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true })
      const track = display.getVideoTracks()[0]
      if (!track) return
      track.onended = () => {
        setScreenOn(false)
        void clientRef.current?.publishVideoTrack(localStream?.getVideoTracks()[0] ?? null)
      }
      screenTrackRef.current = track
      setScreenOn(true)
      await clientRef.current?.publishVideoTrack(track)
    } catch {
      // ألغى المستخدم المشاركة — لا شيء
    }
  }

  const sendDraft = () => {
    const created = clientRef.current?.sendChat(draft)
    if (created) setDraft('')
  }

  const doLeave = async () => {
    if (participantRole !== 'student') {
      try {
        await clientRef.current?.endRoom(new Date().toISOString())
      } catch {
        // قد تكون الغرفة فارغة أصلًا
      }
      // حفظ الإنهاء في القاعدة: حالة completed + الغياب + ملخص metadata
      try {
        await endSessionAction(session!.id, Math.max(1, Math.round(elapsed / 60)))
      } catch {
        // البلاغ للاجتماع أهم من نجاح النداء — السجل يُصحَّح من صفحة الحصص
      }
    }
    clientRef.current?.stop()
    navigate(ROUTES.sessions)
  }

  const openConfirm = () => setPhase('confirm')

  const saveSummary = () => {
    // تصحيح يدوي من المدرس فوق الحضور التلقائي (يسجّله الخادم عند الانضمام)
    if (session && participantRole === 'teacher') {
      void markAttendanceAction(session.id, session.studentId, attendance).catch(() => undefined)
    }
    setPhase('saved')
  }

  // ---------------- العرض ----------------
  const teacher = session ? teachers.find((tr) => tr.id === session.teacherId) ?? null : null
  const student = session ? students.find((st) => st.id === session.studentId) ?? null : null
  const waitingTeacher = !isObserver && participantRole === 'student' && !peers.some((p) => p.role === 'teacher')
  const sharingPeer = peers.find((p) => p.camera && streams[p.connId]?.getVideoTracks().some((tr) => tr.label.toLowerCase().includes('screen')))

  const tiles = useMemo(() => {
    const list: Array<{ key: string; name: string; roleLabel: string; stream: MediaStream | null; self: boolean; muted: boolean; hand: boolean }> = []
    if (!isObserver) {
      list.push({
        key: 'self',
        name: `${t('classroom:self')} — ${selfName}`,
        roleLabel: t(roleLabelKey(role)),
        stream: localStream,
        self: true,
        muted: !micOn,
        hand: handRaised,
      })
    }
    for (const p of peers) {
      list.push({
        key: p.connId,
        name: p.name,
        roleLabel: t(`classroom:roles.${p.role}`),
        stream: streams[p.connId] ?? null,
        self: false,
        muted: p.muted,
        hand: p.hand,
      })
    }
    return list
  }, [isObserver, localStream, peers, streams, micOn, handRaised, selfName, role, t])

  if (!session) {
    if (loading) {
      return (
        <section className={styles.notFound} role="status" aria-live="polite">
          <h1>{t('common:loading')}</h1>
        </section>
      )
    }
    return (
      <section className={styles.notFound}>
        <h1>{t('classroom:notFound.title')}</h1>
        <Link to={ROUTES.sessions} className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('classroom:notFound.back')}
        </Link>
      </section>
    )
  }

  return (
    <div className={styles.room}>
      <header className={styles.top}>
        <div className={styles.topInfo}>
          <span className={styles.code}>{session.code}</span>
          <span className={styles.subject}>{subjectDisplayName(session, t, 'dashboard:subjects')}</span>
          <span className={`${styles.liveDot} ${status === 'connected' ? styles.liveOn : ''}`} aria-hidden="true" />
          <span className={styles.timer}>{mmss(elapsed)}</span>
          <span className={styles.noRec} title={t('classroom:noRecordingHint')}>
            <ShieldQuestion size={14} aria-hidden="true" />
            {t('classroom:noRecording')}
          </span>
        </div>
        <div className={styles.topActions}>
          <span className={styles.count}>
            <Users size={14} aria-hidden="true" />
            {peers.length + (isObserver ? 0 : 1)}
          </span>
          <span className={styles.status} role="status">
            {t(`classroom:status.${status}`)}
          </span>
          <button type="button" className={styles.leaveTop} onClick={openConfirm}>
            <LogOut size={15} aria-hidden="true" />
            {t('classroom:controls.leave')}
          </button>
        </div>
      </header>

      {fatal && (
        <div className={styles.fatal} role="alert">
          <Ban size={16} aria-hidden="true" />
          <span>{fatal}</span>
          <button type="button" className={styles.backLink} onClick={() => navigate(ROUTES.sessions)}>
            {t('classroom:notFound.back')}
          </button>
        </div>
      )}

      {iceNotice && !fatal && (
        <div className={styles.notice} role="status">
          <ShieldQuestion size={16} aria-hidden="true" />
          <span>{t(iceNotice === 'empty-response' ? 'classroom:notice.iceEmpty' : 'classroom:notice.iceFailed')}</span>
        </div>
      )}

      {screenOn && <div className={styles.shareBanner}>{t('classroom:screen.you')}</div>}
      {sharingPeer && <div className={styles.shareBannerAlt}>{t('classroom:screen.peer', { name: sharingPeer.name })}</div>}

      <div className={styles.body}>
        <main className={styles.stage}>
          {stageMode === 'video' ? (
            <>
              <div className={styles.grid} data-count={Math.max(tiles.length, 1)}>
                {tiles.map(({ key, ...tileProps }) => (
                  <Tile key={key} {...tileProps} />
                ))}
                {tiles.length === 0 && <div className={styles.emptyTile}>{t('classroom:waiting.desc')}</div>}
              </div>
              {waitingTeacher && status === 'connected' && (
                <div className={styles.waiting} role="status">
                  <h2>{t('classroom:waiting.title')}</h2>
                  <p>{t('classroom:waiting.desc')}</p>
                </div>
              )}
            </>
          ) : (
            <div className={styles.boardWrap}>
              <div className={styles.boardTools}>
                <span className={styles.boardTitle}>{t('classroom:board.title')}</span>
                <div className={styles.boardColors} role="group" aria-label={t('classroom:board.color')}>
                  {BOARD_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`${styles.colorDot} ${boardColor === color ? styles.colorActive : ''}`}
                      style={{ background: color }}
                      aria-label={color}
                      aria-pressed={boardColor === color}
                      onClick={() => setBoardColor(color)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className={styles.boardBtn}
                  onClick={() => {
                    strokesRef.current = []
                    clearCanvas()
                    clientRef.current?.clearBoard()
                  }}
                >
                  <Eraser size={15} aria-hidden="true" />
                  {t('classroom:board.clear')}
                </button>
              </div>
              <canvas
                ref={boardCanvasRef}
                className={styles.boardCanvas}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                aria-label={t('classroom:board.title')}
              />
            </div>
          )}
        </main>

        {panelOpen && (
          <aside className={styles.panel} aria-label={panelTab === 'chat' ? t('classroom:tabs.chat') : t('classroom:tabs.people')}>
            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'chat'}
                className={panelTab === 'chat' ? styles.tabActive : styles.tab}
                onClick={() => setPanelTab('chat')}
              >
                {t('classroom:tabs.chat')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panelTab === 'people'}
                className={panelTab === 'people' ? styles.tabActive : styles.tab}
                onClick={() => setPanelTab('people')}
              >
                {t('classroom:tabs.people')} ({tiles.length})
              </button>
              <button type="button" className={styles.panelClose} onClick={() => setPanelOpen(false)} aria-label={t('classroom:controls.panelClose')}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {panelTab === 'chat' ? (
              <div className={styles.chat}>
                <ul className={styles.chatList}>
                  {chat.length === 0 && <li className={styles.chatEmpty}>{t('classroom:chat.empty')}</li>}
                  {chat.map((m) => (
                    <li key={m.id} className={`${styles.bubble} ${m.mine ? styles.bubbleMine : ''}`}>
                      <span className={styles.bubbleName}>{m.name} · {t(`classroom:roles.${m.role === 'self' ? participantRole : m.role}`)}</span>
                      <p>{m.text}</p>
                      <time>{new Date(m.at).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ul>
                <form
                  className={styles.chatForm}
                  onSubmit={(e) => {
                    e.preventDefault()
                    sendDraft()
                  }}
                >
                  <input
                    className={styles.chatInput}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={t('classroom:chat.placeholder')}
                    maxLength={2000}
                  />
                  <button type="submit" className={styles.chatSend} disabled={!draft.trim()}>
                    {t('classroom:chat.send')}
                  </button>
                </form>
              </div>
            ) : (
              <ul className={styles.people}>
                {!isObserver && (
                  <li className={styles.person}>
                    <span className={styles.personName}>{selfName} ({t('classroom:self')})</span>
                    <span className={styles.personRole}>{t(roleLabelKey(role))}</span>
                    <span className={styles.personIcons}>
                      {micOn ? <Mic size={14} aria-hidden="true" /> : <MicOff size={14} aria-hidden="true" />}
                      {handRaised && <Hand size={14} aria-hidden="true" className={styles.handOn} />}
                    </span>
                  </li>
                )}
                {peers.map((p) => (
                  <li key={p.connId} className={styles.person}>
                    <span className={styles.personName}>{p.name}</span>
                    <span className={styles.personRole}>
                      {t(`classroom:roles.${p.role}`)}
                      {p.role === 'observer' && ` · ${t('classroom:observeBadge')}`}
                    </span>
                    <span className={styles.personIcons}>
                      {p.muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
                      {p.hand && <Hand size={14} aria-hidden="true" className={styles.handOn} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>

      <footer className={styles.controls}>
        <button type="button" className={`${styles.ctrl} ${!micOn ? styles.ctrlOff : ''}`} onClick={toggleMic} disabled={isObserver} aria-pressed={!micOn}>
          {micOn ? <Mic size={19} aria-hidden="true" /> : <MicOff size={19} aria-hidden="true" />}
          <span>{t(micOn ? 'classroom:controls.mic' : 'classroom:controls.micOff')}</span>
        </button>
        <button type="button" className={`${styles.ctrl} ${!camOn ? styles.ctrlOff : ''}`} onClick={toggleCam} disabled={isObserver} aria-pressed={!camOn}>
          {camOn ? <VideoIcon size={19} aria-hidden="true" /> : <VideoOffIcon size={19} aria-hidden="true" />}
          <span>{t(camOn ? 'classroom:controls.camera' : 'classroom:controls.cameraOff')}</span>
        </button>
        <button type="button" className={`${styles.ctrl} ${handRaised ? styles.ctrlHand : ''}`} onClick={toggleHand} aria-pressed={handRaised}>
          <Hand size={19} aria-hidden="true" />
          <span>{t('classroom:controls.hand')}</span>
        </button>
        <button type="button" className={`${styles.ctrl} ${screenOn ? styles.ctrlHand : ''}`} onClick={() => void toggleScreen()} disabled={isObserver}>
          {screenOn ? <MonitorOff size={19} aria-hidden="true" /> : <Monitor size={19} aria-hidden="true" />}
          <span>{t('classroom:controls.screen')}</span>
        </button>
        <button type="button" className={`${styles.ctrl} ${stageMode === 'board' ? styles.ctrlHand : ''}`} onClick={() => setStageMode(stageMode === 'board' ? 'video' : 'board')}>
          {stageMode === 'board' ? <LayoutGrid size={19} aria-hidden="true" /> : <Pen size={19} aria-hidden="true" />}
          <span>{t(stageMode === 'board' ? 'classroom:controls.boardClose' : 'classroom:controls.board')}</span>
        </button>
        <button type="button" className={styles.ctrl} onClick={() => setPanelOpen((open) => !open)} aria-pressed={panelOpen}>
          <MessageSquare size={19} aria-hidden="true" />
          <span>{t('classroom:controls.chat')}</span>
        </button>
        <button type="button" className={`${styles.ctrl} ${styles.ctrlLeave}`} onClick={openConfirm}>
          <PhoneOff size={19} aria-hidden="true" />
          <span>{t('classroom:controls.leave')}</span>
        </button>
      </footer>

      {phase === 'confirm' && (
        <div className={styles.overlay} role="presentation">
          <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-label={t('classroom:leave.title')}>
            <h2 className={styles.dialogTitle}>{t('classroom:leave.title')}</h2>
            <p className={styles.dialogDesc}>
              {participantRole === 'student' ? t('classroom:leave.descStudent') : t('classroom:leave.descHost')}
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.ghostButton} onClick={() => setPhase('live')}>
                {t('classroom:leave.stay')}
              </button>
              {participantRole === 'student' ? (
                <button type="button" className={styles.dangerButton} onClick={doLeave}>
                  {t('classroom:leave.exitOnly')}
                </button>
              ) : (
                <>
                  <button type="button" className={styles.ghostButton} onClick={() => { clientRef.current?.stop(); navigate(ROUTES.sessions) }}>
                    {t('classroom:leave.exitOnly')}
                  </button>
                  <button type="button" className={styles.dangerButton} onClick={() => void doLeave()}>
                    {t('classroom:leave.endSession')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {(phase === 'summary' || phase === 'saved') && (
        <div className={styles.overlay}>
          <div className={styles.summaryCard} role="dialog" aria-modal="true" aria-label={t('classroom:summary.title')}>
            <span className={styles.summaryBadge}>
              <Circle size={10} fill="currentColor" aria-hidden="true" />
              {t('classroom:summary.metadataOnly')}
            </span>
            <h2>{t(phase === 'saved' ? 'classroom:summary.savedTitle' : 'classroom:summary.title')}</h2>
            <p className={styles.summaryDesc}>
              {endedBy ? t('classroom:summary.endedBy', { name: endedBy }) : t('classroom:summary.desc')}
            </p>
            <dl className={styles.summaryGrid}>
              <div><dt>{t('classroom:summary.code')}</dt><dd>{session.code}</dd></div>
              <div><dt>{t('classroom:summary.teacher')}</dt><dd>{teacher?.name ?? '—'}</dd></div>
              <div><dt>{t('classroom:summary.student')}</dt><dd>{student?.name ?? '—'}</dd></div>
              <div><dt>{t('classroom:summary.startedAt')}</dt><dd>{new Date(startedAtRef.current).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-GB')}</dd></div>
              <div><dt>{t('classroom:summary.endedAt')}</dt><dd>{new Date().toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-GB')}</dd></div>
              <div><dt>{t('classroom:summary.duration')}</dt><dd>{mmss(elapsed)}</dd></div>
            </dl>
            {participantRole === 'teacher' && phase !== 'saved' && (
              <>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('classroom:summary.attendance')}</span>
                  <div className={styles.segmented} role="group">
                    {(['present', 'late', 'absent'] as const).map((mark) => (
                      <button
                        key={mark}
                        type="button"
                        className={attendance === mark ? styles.segActive : styles.seg}
                        aria-pressed={attendance === mark}
                        onClick={() => setAttendance(mark)}
                      >
                        {t(`classroom:attendance.${mark}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('classroom:summary.note')}</span>
                  <textarea className={styles.noteArea} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('classroom:summary.notePlaceholder')} />
                </div>
              </>
            )}
            <div className={styles.dialogActions}>
              {phase === 'summary' && participantRole === 'teacher' && (
                <button type="button" className={styles.primaryButton} onClick={saveSummary}>
                  <Check size={15} aria-hidden="true" />
                  {t('classroom:summary.save')}
                </button>
              )}
              <button type="button" className={styles.ghostButton} onClick={() => navigate(ROUTES.sessions)}>
                {t('classroom:summary.backToSessions')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** بلاطة فيديو حقيقية — stream حي أو أفاتار مبدئي */
function Tile({
  name,
  roleLabel,
  stream,
  self,
  muted,
  hand,
}: {
  name: string
  roleLabel: string
  stream: MediaStream | null
  self: boolean
  muted: boolean
  hand: boolean
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hasVideo = stream !== null && stream.getVideoTracks().some((tr) => tr.enabled && tr.readyState === 'live')

  useEffect(() => {
    const el = videoRef.current
    if (el) {
      el.srcObject = stream
      // سياسة autoplay: محاولة تشغيل فورية؛ إن مُنع يُفتح الصوت عند أول نقرة (unlock بالأسفل)
      if (!self) void el.play().catch(() => undefined)
    }
  }, [stream, self])

  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p.charAt(0)).join('')

  return (
    <figure className={styles.tile}>
      <video
        ref={videoRef}
        className={`${styles.tileVideo} ${hasVideo ? '' : styles.tileVideoIdle}`}
        autoPlay
        playsInline
        muted={self}
      />
      {!hasVideo && (
        <figcaption className={styles.tileAvatar} aria-hidden="true">
          {initials}
        </figcaption>
      )}
      {hand && (
        <span className={styles.tileHand} aria-hidden="true">
          <Hand size={18} />
        </span>
      )}
      <figcaption className={styles.tileName}>
        <span className={styles.tileMic}>
          {muted ? <MicOff size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
        </span>
        {name}
        <span className={styles.tileRole}>{roleLabel}</span>
      </figcaption>
    </figure>
  )
}
