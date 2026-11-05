import {
  ArrowLeft,
  Ban,
  Check,
  Circle,
  Hand,
  LayoutGrid,
  LogOut,
  Maximize2,
  MessageSquare,
  Minimize2,
  Monitor,
  Pen,
  PhoneOff,
  RotateCcw,
  ShieldQuestion,
  Smartphone,
  Users,
  Video as VideoIcon,
  VideoOff as VideoOffIcon,
  Mic,
  MicOff,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type PeerLink,
  type StageKind,
  type Stroke,
} from '../../features/meeting/meetingClient'
import { acquireVisualShare, screenCaptureSupported, type ShareMode } from '../../features/meeting/mediaShare'
import type { SharedDoc } from '../../features/meeting/documents'
import { useLanguage } from '../../i18n/useLanguage'
import { canHostRoom, effectiveRoleFor, participantRoleFor, roleLabelKey } from '../../lib/roles'
import { subjectDisplayName } from '../../lib/data/eduStore'
import { useAppData } from '../../features/sessions/DataProvider'
import { canJoin, joinHint } from '../../features/sessions/joinAccess'
import { BoardTile, type BoardHandle } from './BoardTile'
import { BOARD_COLORS } from '../../features/meeting/whiteboard'
import { FilePickerDialog } from './FilePickerDialog'
import styles from './ClassroomPage.module.css'

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
  const isHost = canHostRoom(role)
  const selfName = user?.name ?? user?.email ?? ''

  const clientRef = useRef<MeetingClient | null>(null)
  const boardRef = useRef<BoardHandle | null>(null)
  const startedAtRef = useRef<number>(Date.now())
  const shareTrackRef = useRef<MediaStreamTrack | null>(null)

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [streams, setStreams] = useState<Record<string, MediaStream>>({})
  const [links, setLinks] = useState<Record<string, PeerLink>>({})
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<MeetingStatus>('connecting')
  const [fatal, setFatal] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [iceNotice, setIceNotice] = useState<IceDegradation | null>(null)
  const [phase, setPhase] = useState<Phase>('live')
  const [endedBy, setEndedBy] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [handRaised, setHandRaised] = useState(false)
  const [shareMode, setShareMode] = useState<ShareMode | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelTab, setPanelTab] = useState<PanelTab>('chat')
  const [draft, setDraft] = useState('')
  const [boardColor, setBoardColor] = useState<string>(BOARD_COLORS[0])
  const [attendance, setAttendance] = useState<'present' | 'late' | 'absent'>('present')
  const [note, setNote] = useState('')
  // قرار المدرس على المسرح (يُبثّ للجميع) + تكبير محلي لا يغيّر شاشة أحد غيره
  const [stage, setStage] = useState<StageKind>('video')
  const [pin, setPin] = useState<'auto' | 'board' | string>('auto')
  const [doc, setDoc] = useState<SharedDoc | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const showNotice = useCallback((message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice((current) => (current === message ? null : current)), 7000)
  }, [])

  // ---------------- تهيئة الجلسة ----------------
  useEffect(() => {
    if (!session || !canJoin(session)) return
    const code = session.code
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
      } else if (!isObserver) {
        // بلا كاميرا ولا ميكروفون = مستقبِل فقط — يجب أن يُقال، لا أن يُترك سرًا
        showNotice(t('classroom:notice.noMedia'))
      }
      startedAtRef.current = Date.now()

      client = new MeetingClient(code, participantRole, selfName, {
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
        onLink: (connId, link) => !disposed && setLinks((prev) => ({ ...prev, [connId]: link })),
        onChat: (msg) => !disposed && setChat((prev) => [...prev, msg]),
        // المخزن والرسم داخل BoardTile عبر ref ثابت — لا لقطة إغلاق قديمة
        onStroke: (stroke: Stroke) => boardRef.current?.addStroke(stroke),
        onBoardClear: () => boardRef.current?.clear(),
        onBoardInit: (init) => {
          if (disposed) return
          boardRef.current?.applySnapshot(init.segments)
          setDoc(init.doc)
          setStage(init.doc ? 'doc' : init.stage)
        },
        onStage: (kind, _boardOn, from) => {
          if (disposed) return
          if (clientRef.current && from === clientRef.current.selfConnId) return
          setStage(kind)
          // قرار المدرس الجديد يلغي التكبير المحلي، وإلا بقي الطالب على مشهد قديم
          setPin((current) => (current === 'board' ? 'auto' : current))
        },
        onDoc: (next, from) => {
          if (disposed) return
          if (clientRef.current && from === clientRef.current.selfConnId) return
          setDoc(next)
          if (next) setStage('doc')
        },
        onEnded: (by) => {
          if (disposed) return
          setEndedBy(by)
          setPhase('summary')
        },
        onStatus: (s) => !disposed && setStatus(s),
        onFatal: (message) => !disposed && setFatal(message),
        onNotice: (message) => !disposed && showNotice(message),
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (pickerOpen) setPickerOpen(false)
      else if (phase === 'confirm') setPhase('live')
      else if (pin !== 'auto') setPin('auto')
      else setPanelOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, pin, pickerOpen])

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

  // ---------------- التحكم ----------------
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

  const stopShare = () => {
    shareTrackRef.current?.stop()
    shareTrackRef.current = null
    setShareMode(null)
    void clientRef.current?.publishVideoTrack(null)
  }

  /**
   * مشاركة بصرية حسب ما يدعمه الجهاز فعلًا: شاشة على الحاسوب، وكاميرا خلفية على
   * الموبايل (لا متصفح جوال يلتقط الشاشة — كان الزر يضغط ولا يحدث شيء بلا رسالة).
   */
  const startShare = async (mode: ShareMode) => {
    if (isObserver) return
    if (shareMode === mode) {
      stopShare()
      return
    }
    const result = await acquireVisualShare(mode)
    if ('failure' in result) {
      const { reason, detail } = result.failure
      showNotice(reason === 'error' && detail ? `${t('classroom:share.error')} — ${detail}` : t(`classroom:share.${reason}`))
      return
    }
    shareTrackRef.current?.stop()
    shareTrackRef.current = result.track
    setShareMode(result.mode)
    await clientRef.current?.publishVideoTrack(result.track)
    result.track.onended = () => stopShare()
  }

  const pushStage = (next: StageKind) => {
    setStage(next)
    setPin('auto')
    void clientRef.current?.setStage(next, next !== 'video').catch(() => showNotice(t('classroom:notice.stageRejected')))
  }

  const pushDoc = (next: SharedDoc | null) => {
    const previous = doc
    setDoc(next)
    void clientRef.current
      ?.shareDoc(next)
      .then(() => {
        if (next) setStage('doc')
        setPin('auto')
      })
      .catch(() => {
        setDoc(previous)
        showNotice(t('classroom:notice.docRejected'))
      })
  }

  const sendDraft = () => {
    const created = clientRef.current?.sendChat(draft)
    if (created) setChat((prev) => [...prev, created])
    if (draft.trim()) setDraft('')
  }

  const doLeave = async () => {
    if (isHost) {
      try {
        await clientRef.current?.endRoom(new Date().toISOString())
      } catch (err) {
        showNotice(err instanceof Error ? err.message : t('classroom:notice.endFailed'))
      }
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
    if (session && participantRole === 'teacher') {
      void markAttendanceAction(session.id, session.studentId, attendance).catch(() => undefined)
    }
    setPhase('saved')
  }

  // ---------------- العرض ----------------
  const teacher = session ? teachers.find((tr) => tr.id === session.teacherId) ?? null : null
  const student = session ? students.find((st) => st.id === session.studentId) ?? null : null
  const waitingTeacher = !isObserver && participantRole === 'student' && !peers.some((p) => p.role === 'teacher')

  const tiles = useMemo(() => {
    const list: Array<{ key: string; name: string; roleLabel: string; stream: MediaStream | null; self: boolean; muted: boolean; hand: boolean; link?: PeerLink }> = []
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
        link: links[p.connId],
      })
    }
    return list
  }, [isObserver, localStream, peers, streams, links, micOn, handRaised, selfName, role, t])

  /** التكبير المحلي أولًا، ثم قرار المدرس على المسرح */
  const pinnedPeer = pin !== 'auto' && pin !== 'board' ? pin : null
  const boardLarge = pin === 'board' || (pin === 'auto' && stage !== 'video')
  const mainTiles = pinnedPeer ? tiles.filter((tile) => tile.key === pinnedPeer) : boardLarge ? [] : tiles
  const sideTiles = pinnedPeer ? tiles.filter((tile) => tile.key !== pinnedPeer) : boardLarge ? tiles : []

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

  if (!canJoin(session)) {
    const opensLocal = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
      session.joinOpensAt,
    )
    return (
      <section className={styles.notFound} role="status" aria-live="polite">
        <h1>{joinHint(t, session)}</h1>
        {session.joinState === 'tooEarly' && (
          <p className={styles.backLink}>{t('classroom:locked.opensAt', { time: opensLocal })}</p>
        )}
        <Link to={ROUTES.sessions} className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('classroom:locked.back')}
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
          <span>
            {t(iceNotice === 'empty-response' ? 'classroom:notice.iceEmpty' : 'classroom:notice.iceFailed')}
          </span>
        </div>
      )}

      {notice && (
        <div className={styles.notice} role="alert">
          <Ban size={16} aria-hidden="true" />
          <span>{notice}</span>
          <button type="button" className={styles.noticeClose} onClick={() => setNotice(null)} aria-label={t('classroom:notice.dismiss')}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {shareMode && (
        <div className={styles.shareBanner}>
          {t(shareMode === 'screen' ? 'classroom:screen.you' : 'classroom:camera.you')}
        </div>
      )}

      <div className={styles.body}>
        <main className={styles.stage}>
          <div className={styles.stageGrid} data-layout={boardLarge ? 'board' : pinnedPeer ? 'peer' : 'grid'}>
            {mainTiles.map(({ key, ...tileProps }) => (
              <Tile
                key={key}
                {...tileProps}
                enlarged={pinnedPeer === key}
                onEnlarge={() => setPin(pinnedPeer === key ? 'auto' : key)}
                onRetry={() => clientRef.current?.retryPeer(key)}
              />
            ))}
            <div className={styles.boardCell}>
              <BoardTile
                ref={boardRef}
                sessionCode={session.code}
                doc={doc}
                canDraw={role !== 'parent'}
                canHost={isHost}
                enlarged={boardLarge}
                color={boardColor}
                onColor={setBoardColor}
                onStroke={(stroke) => clientRef.current?.sendStroke(stroke)}
                onClear={() => clientRef.current?.clearBoard()}
                onPickFile={() => setPickerOpen(true)}
                onDocPage={(page) => doc && pushDoc({ ...doc, page })}
                onCloseDoc={() => pushDoc(null)}
                onToggleEnlarge={() => setPin(boardLarge ? 'auto' : 'board')}
              />
            </div>
            {sideTiles.map(({ key, ...tileProps }) => (
              <Tile
                key={key}
                {...tileProps}
                compact
                enlarged={false}
                onEnlarge={() => setPin(key)}
                onRetry={() => clientRef.current?.retryPeer(key)}
              />
            ))}
          </div>

          {waitingTeacher && status === 'connected' && (
            <div className={styles.waiting} role="status">
              <h2>{t('classroom:waiting.title')}</h2>
              <p>{t('classroom:waiting.desc')}</p>
            </div>
          )}

          {pin !== 'auto' && (
            <button type="button" className={styles.unpin} onClick={() => setPin('auto')}>
              <Minimize2 size={14} aria-hidden="true" />
              {t('classroom:controls.backToStage')}
            </button>
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
                      {links[p.connId] && (
                        <span className={styles.linkTag} title={t(`classroom:link.${links[p.connId].transport}`)}>
                          {t(`classroom:link.${links[p.connId].transport}`)}
                        </span>
                      )}
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
        {screenCaptureSupported() ? (
          <button type="button" className={`${styles.ctrl} ${shareMode === 'screen' ? styles.ctrlHand : ''}`} onClick={() => void startShare('screen')} disabled={isObserver} aria-pressed={shareMode === 'screen'}>
            <Monitor size={19} aria-hidden="true" />
            <span>{t('classroom:controls.screen')}</span>
          </button>
        ) : (
          <button type="button" className={`${styles.ctrl} ${shareMode === 'camera' ? styles.ctrlHand : ''}`} onClick={() => void startShare('camera')} disabled={isObserver} aria-pressed={shareMode === 'camera'}>
            <Smartphone size={19} aria-hidden="true" />
            <span>{t('classroom:controls.cameraShare')}</span>
          </button>
        )}
        {isHost && (
          <button type="button" className={`${styles.ctrl} ${stage !== 'video' ? styles.ctrlHand : ''}`} onClick={() => pushStage(stage === 'video' ? 'board' : 'video')} aria-pressed={stage !== 'video'}>
            {stage === 'video' ? <Pen size={19} aria-hidden="true" /> : <LayoutGrid size={19} aria-hidden="true" />}
            <span>{t(stage === 'video' ? 'classroom:controls.board' : 'classroom:controls.boardClose')}</span>
          </button>
        )}
        <button type="button" className={styles.ctrl} onClick={() => setPanelOpen((open) => !open)} aria-pressed={panelOpen}>
          <MessageSquare size={19} aria-hidden="true" />
          <span>{t('classroom:controls.chat')}</span>
        </button>
        <button type="button" className={`${styles.ctrl} ${styles.ctrlLeave}`} onClick={openConfirm}>
          <PhoneOff size={19} aria-hidden="true" />
          <span>{t('classroom:controls.leave')}</span>
        </button>
      </footer>

      {pickerOpen && (
        <FilePickerDialog
          onPick={(picked) => {
            setPickerOpen(false)
            pushDoc(picked)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

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
              {isHost ? (
                <>
                  <button type="button" className={styles.ghostButton} onClick={() => { clientRef.current?.stop(); navigate(ROUTES.sessions) }}>
                    {t('classroom:leave.exitOnly')}
                  </button>
                  <button type="button" className={styles.dangerButton} onClick={() => void doLeave()}>
                    {t('classroom:leave.endSession')}
                  </button>
                </>
              ) : (
                <button type="button" className={styles.dangerButton} onClick={() => { clientRef.current?.stop(); navigate(ROUTES.sessions) }}>
                  {t('classroom:leave.exitOnly')}
                </button>
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

/** بلاطة فيديو حقيقية — stream حي أو أفاتار مبدئي، مع ما يقوله المسار عن اتصاله */
function Tile({
  name,
  roleLabel,
  stream,
  self,
  muted,
  hand,
  link,
  compact = false,
  enlarged = false,
  onEnlarge,
  onRetry,
}: {
  name: string
  roleLabel: string
  stream: MediaStream | null
  self: boolean
  muted: boolean
  hand: boolean
  link?: PeerLink
  compact?: boolean
  enlarged?: boolean
  onEnlarge: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const hasVideo = stream !== null && stream.getVideoTracks().some((tr) => tr.enabled && tr.readyState === 'live')
  // «اتصل» لا تكفي: الصامت (صفر بايت بعد أن يستقر المسار) أو الفاشل هو ما يراه المدرس أسود.
  // أما ما زال في new/connecting فهو في الطريق، لا مكسورًا — فلا وسم أحمر كاذب.
  const settled = link !== undefined && ['connected', 'failed', 'disconnected'].includes(link.state)
  const silent = !self && settled && (link!.state === 'failed' || link!.inboundBytes === 0)
  const waitingMedia = !self && settled === false

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
    <figure className={`${styles.tile} ${compact ? styles.tileCompact : ''} ${enlarged ? styles.tileLarge : ''}`}>
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
      <button type="button" className={styles.tileEnlarge} onClick={onEnlarge} aria-label={enlarged ? t('classroom:board.shrink') : t('classroom:board.enlarge')} aria-pressed={enlarged}>
        <Maximize2 size={14} aria-hidden="true" />
      </button>
      {waitingMedia && (
        <span className={styles.tileWaiting} role="status">
          {t('classroom:link.waiting')}
        </span>
      )}
      {silent && (
        <div className={styles.tileProblem} role="status">
          <span>{t('classroom:link.noMedia')}</span>
          <button type="button" onClick={onRetry} aria-label={t('classroom:link.retry')}>
            <RotateCcw size={13} aria-hidden="true" />
            {t('classroom:link.retry')}
          </button>
        </div>
      )}
      <figcaption className={styles.tileName}>
        <span className={styles.tileMic}>
          {muted ? <MicOff size={13} aria-hidden="true" /> : <Mic size={13} aria-hidden="true" />}
        </span>
        <span className={styles.tileLabel}>{name}</span>
        <span className={styles.tileRole}>{roleLabel}</span>
        {link && !self && (settled || link.transport !== 'unknown') && (
          <span className={styles.linkTag}>{t(`classroom:link.${link.transport}`)}</span>
        )}
      </figcaption>
    </figure>
  )
}
