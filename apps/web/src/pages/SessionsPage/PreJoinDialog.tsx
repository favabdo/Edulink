import { ArrowLeft, ArrowRight, Check, Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/authContext'
import { useLanguage } from '../../i18n/useLanguage'
import { writeDevicePrefs } from '../../features/meeting/meetingClient'
import { subjectDisplayName, type ClassSession } from '../../lib/data/eduStore'
import { effectiveRoleFor, participantRoleFor } from '../../lib/roles'
import type { SessionLookup } from './SessionsPage'
import styles from './PreJoinDialog.module.css'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part.charAt(0)).join('') || '؟'
}

/**
 * شاشة ما قبل الانضمام — معاينة **حقيقية** للكاميرا والميكروفون:
 * تطلب getUserMedia فعليًا، وتعرض قائمة الأجهزة من enumerateDevices،
 * وتحفظ الاختيارات في localStorage لتلتقطها غرفة الحصة عند الدخول.
 */
export function PreJoinDialog({
  session,
  lookup,
  dateFmt,
  timeFmt,
  onClose,
  onJoin,
}: {
  session: ClassSession
  lookup: SessionLookup
  dateFmt: Intl.DateTimeFormat
  timeFmt: Intl.DateTimeFormat
  onClose: () => void
  onJoin: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const role = effectiveRoleFor(user)
  const participantRole = participantRoleFor(role)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOn] = useState(participantRole !== 'observer')
  const [camOn, setCamOn] = useState(participantRole !== 'observer')
  const [cams, setCams] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState('')
  const [micId, setMicId] = useState('')
  const [permissionDenied, setPermissionDenied] = useState(false)

  const name = user?.name ?? user?.email ?? ''
  const BackIcon = language === 'ar' ? ArrowRight : ArrowLeft

  async function openDevices(nextCameraId?: string, nextMicId?: string) {
    if (participantRole === 'observer') return
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: nextMicId ? { deviceId: { exact: nextMicId } } : true,
        video: nextCameraId ? { deviceId: { exact: nextCameraId } } : true,
      })
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = s
      setStream(s)
      setPermissionDenied(false)
      const list = await navigator.mediaDevices.enumerateDevices()
      setCams(list.filter((d) => d.kind === 'videoinput'))
      setMics(list.filter((d) => d.kind === 'audioinput'))
      if (!nextCameraId) setCameraId(s.getVideoTracks()[0]?.getSettings().deviceId ?? '')
      if (!nextMicId) setMicId(s.getAudioTracks()[0]?.getSettings().deviceId ?? '')
    } catch {
      setPermissionDenied(true)
    }
  }

  useEffect(() => {
    void openDevices()
    return () => streamRef.current?.getTracks().forEach((tr) => tr.stop())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantRole])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  useEffect(() => {
    stream?.getAudioTracks().forEach((tr) => (tr.enabled = micOn))
  }, [stream, micOn])

  useEffect(() => {
    stream?.getVideoTracks().forEach((tr) => (tr.enabled = camOn))
  }, [stream, camOn])

  const confirmJoin = () => {
    writeDevicePrefs({ audioId: micId || undefined, videoId: cameraId || undefined })
    window.localStorage.setItem('edulink.joinFlags', JSON.stringify({ micOff: !micOn, camOff: !camOn }))
    // مسارات المعاينة تُسلَّم للغرفة مباشرة (بدون إعادة طلب الإذن) عبر takePreJoinStream
    ;(window as unknown as Record<string, MediaStream | null>).__edulinkPreJoinStream = streamRef.current
    onJoin()
  }

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('sessions:prejoin.title')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t('sessions:prejoin.title')}</h2>
          <p className={styles.subtitle}>{t('sessions:prejoin.subtitle')}</p>
        </header>

        <div className={styles.preview}>
          {participantRole === 'observer' ? (
            <span className={styles.initials} aria-hidden="true">
              {initialsOf(name)}
            </span>
          ) : camOn && stream ? (
            <video ref={videoRef} autoPlay playsInline muted className={styles.previewVideo} />
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted className={styles.previewVideo} hidden={!stream} />
              {!camOn && <VideoOff size={34} aria-hidden="true" className={styles.previewIcon} />}
            </>
          )}
          <span className={styles.previewName}>{name}</span>
          <span className={styles.previewHint}>
            {permissionDenied
              ? t('sessions:prejoin.permissionDenied')
              : participantRole === 'observer'
                ? t('sessions:prejoin.observerNote')
                : t('sessions:prejoin.previewNote')}
          </span>
        </div>

        {participantRole !== 'observer' && (
          <div className={styles.toggles}>
            <button
              type="button"
              className={`${styles.toggle} ${micOn ? '' : styles.toggleOff}`}
              aria-pressed={micOn}
              onClick={() => setMicOn((on) => !on)}
            >
              {micOn ? <Mic size={18} aria-hidden="true" /> : <MicOff size={18} aria-hidden="true" />}
              <span>{t(micOn ? 'sessions:prejoin.micOn' : 'sessions:prejoin.micOff')}</span>
            </button>
            <button
              type="button"
              className={`${styles.toggle} ${camOn ? '' : styles.toggleOff}`}
              aria-pressed={camOn}
              onClick={() => setCamOn((on) => !on)}
            >
              {camOn ? <Video size={18} aria-hidden="true" /> : <VideoOff size={18} aria-hidden="true" />}
              <span>{t(camOn ? 'sessions:prejoin.cameraOn' : 'sessions:prejoin.cameraOff')}</span>
            </button>
          </div>
        )}

        {participantRole !== 'observer' && (cams.length > 1 || mics.length > 1) && (
          <div className={styles.devices}>
            {cams.length > 1 && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('sessions:prejoin.cameraLabel')}</span>
                <select
                  className={styles.select}
                  value={cameraId}
                  onChange={(event) => {
                    setCameraId(event.target.value)
                    void openDevices(event.target.value, micId || undefined)
                  }}
                >
                  {cams.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `${t('sessions:prejoin.cameraLabel')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mics.length > 1 && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{t('sessions:prejoin.micLabel')}</span>
                <select
                  className={styles.select}
                  value={micId}
                  onChange={(event) => {
                    setMicId(event.target.value)
                    void openDevices(cameraId || undefined, event.target.value)
                  }}
                >
                  {mics.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `${t('sessions:prejoin.micLabel')} ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        <dl className={styles.summary}>
          <div className={styles.summaryItem}>
            <dt>{t('sessions:fields.code')}</dt>
            <dd>{session.code}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>{t('sessions:fields.subject')}</dt>
            <dd>{subjectDisplayName(session, t, 'sessions:subjects')}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>{t('sessions:fields.teacher')}</dt>
            <dd>{lookup.teacherById(session.teacherId)?.name ?? '—'}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>{t('sessions:fields.student')}</dt>
            <dd>{lookup.studentById(session.studentId)?.name ?? '—'}</dd>
          </div>
          <div className={styles.summaryItem}>
            <dt>{t('sessions:fields.when')}</dt>
            <dd>
              {dateFmt.format(session.startsAt)} · {timeFmt.format(session.startsAt)}
            </dd>
          </div>
        </dl>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            <BackIcon size={16} aria-hidden="true" />
            <span>{t('sessions:prejoin.cancel')}</span>
          </button>
          <button type="button" className={styles.joinButton} onClick={confirmJoin}>
            <Check size={16} aria-hidden="true" />
            <span>{t('sessions:prejoin.join')}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}
