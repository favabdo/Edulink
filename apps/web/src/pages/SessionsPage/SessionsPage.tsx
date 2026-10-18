import {
  Atom,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FlaskConical,
  Languages,
  Leaf,
  Sigma,
  Users,
  Video,
  XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { sessionLivePath } from '../../app/router/paths'
import { useAuth } from '../../features/auth/authContext'
import { useAppData } from '../../features/sessions/DataProvider'
import { useLanguage } from '../../i18n/useLanguage'
import {
  sessionsOn,
  statsForSessions,
  subjectDisplayName,
  type AttendanceMark,
  type ClassSession,
  type SessionStatus,
  type Student,
  type SubjectKey,
  type Teacher,
} from '../../lib/data/eduStore'
import { canObserveSessions, effectiveRoleFor } from '../../lib/roles'
import { PreJoinDialog } from './PreJoinDialog'
import styles from './SessionsPage.module.css'

/** دوال البحث في بيانات الحصة — كلها من ردود الخادم المُرطَّبة في المخزن */
export type SessionLookup = {
  teacherById: (id: number) => Teacher | null
  studentById: (id: number) => Student | null
  sessionById: (id: number) => ClassSession | null
}

type Tab = 'upcoming' | 'live' | 'past' | 'cancelled'
type Tint = 'blue' | 'green' | 'purple' | 'pink'

const TABS: readonly Tab[] = ['upcoming', 'live', 'past', 'cancelled']

const TAB_STATUSES: Record<Tab, readonly SessionStatus[]> = {
  upcoming: ['scheduled'],
  live: ['live'],
  past: ['completed', 'no_show'],
  cancelled: ['cancelled'],
}

const SUBJECT_STYLE: Record<SubjectKey, { Icon: typeof Sigma; tint: Tint }> = {
  math: { Icon: Sigma, tint: 'purple' },
  english: { Icon: Languages, tint: 'blue' },
  physics: { Icon: Atom, tint: 'green' },
  chemistry: { Icon: FlaskConical, tint: 'pink' },
  biology: { Icon: Leaf, tint: 'green' },
  other: { Icon: BookOpen, tint: 'blue' },
}

const STATUS_CLASS: Record<SessionStatus, string> = {
  completed: 'chipCompleted',
  live: 'chipLive',
  scheduled: 'chipScheduled',
  cancelled: 'chipCancelled',
  no_show: 'chipNoShow',
}

const ATTENDANCE_CLASS: Record<AttendanceMark, string> = {
  present: 'attPresent',
  late: 'attLate',
  absent: 'attAbsent',
}

/** قاعدة الانضمام: الغرفة مفتوحة طول مدة الحصة (المدرس/الطالب يدخل مبكرًا زي Zoom)؛ المنتهية والملغاة لا */
function canJoin(session: ClassSession, _now: number): boolean {
  return session.status === 'live' || session.status === 'scheduled'
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`${styles.chip} ${styles[STATUS_CLASS[status]]}`}>
      {status === 'completed' && <CheckCircle2 size={14} aria-hidden="true" />}
      {status === 'live' && <Video size={14} aria-hidden="true" />}
      {status === 'scheduled' && <Clock size={14} aria-hidden="true" />}
      {(status === 'cancelled' || status === 'no_show') && <XCircle size={14} aria-hidden="true" />}
      <span>{t(`sessions:status.${status}`)}</span>
    </span>
  )
}

function AttendanceBadge({ mark }: { mark: AttendanceMark }) {
  const { t } = useTranslation()
  const Icon = mark === 'present' ? CheckCircle2 : mark === 'late' ? Clock : XCircle
  return (
    <span className={`${styles.chip} ${styles[ATTENDANCE_CLASS[mark]]}`}>
      <Icon size={14} aria-hidden="true" />
      <span>{t(`sessions:attendance.${mark}`)}</span>
    </span>
  )
}

function SessionRow({
  session,
  lookup,
  dateFmt,
  timeFmt,
  now,
  isStaff,
  expanded,
  onToggleDetails,
  onJoin,
  onObserve,
}: {
  session: ClassSession
  lookup: SessionLookup
  dateFmt: Intl.DateTimeFormat
  timeFmt: Intl.DateTimeFormat
  now: number
  isStaff: boolean
  expanded: boolean
  onToggleDetails: (id: number) => void
  onJoin: (session: ClassSession) => void
  onObserve: (session: ClassSession) => void
}) {
  const { t } = useTranslation()
  const teacher = lookup.teacherById(session.teacherId)
  const student = lookup.studentById(session.studentId)
  const subjectStyle = SUBJECT_STYLE[session.subject]
  const SubjectIcon = subjectStyle.Icon
  const joinable = canJoin(session, now)
  const minutesToStart = Math.max(0, Math.round((session.startsAt.getTime() - now) / 60_000))
  const makeupOf = session.makeupOfId ? lookup.sessionById(session.makeupOfId) : null
  const isPast = session.status === 'completed' || session.status === 'cancelled' || session.status === 'no_show'
  const observeAllowed = isStaff && (session.status === 'live' || session.status === 'scheduled')

  return (
    <li className={styles.row}>
      <div className={styles.rowMain}>
        <span className={styles.code}>{session.code}</span>

        <span className={`${styles.subjectIcon} ${styles[`tint_${subjectStyle.tint}`]}`} aria-hidden="true">
          <SubjectIcon size={20} />
        </span>

        <span className={styles.people}>
          <span className={styles.personName}>
            <Users size={15} aria-hidden="true" />
            <span>{student?.name ?? '—'}</span>
          </span>
          <span className={styles.personSub}>
            {teacher?.name ?? '—'} · {subjectDisplayName(session, t, 'sessions:subjects')}
          </span>
        </span>

        <span className={styles.when}>
          <span className={styles.whenDate}>
            <CalendarDays size={15} aria-hidden="true" />
            <span>{dateFmt.format(session.startsAt)}</span>
          </span>
          <span className={styles.whenTime}>
            <Clock size={15} aria-hidden="true" />
            <span>
              {timeFmt.format(session.startsAt)} · {t('sessions:duration', { minutes: session.durationMin })}
            </span>
          </span>
        </span>

        <span className={styles.badges}>
          <StatusBadge status={session.status} />
          {session.attendance !== null && <AttendanceBadge mark={session.attendance} />}
        </span>

        <span className={styles.actions}>
          <button
            type="button"
            className={styles.joinButton}
            disabled={!joinable}
            title={joinable ? t('sessions:actions.joinHint') : t('sessions:actions.joinLocked')}
            onClick={() => onJoin(session)}
          >
            <Video size={16} aria-hidden="true" />
            <span>{t('sessions:actions.join')}</span>
          </button>

          {observeAllowed && (
            <button
              type="button"
              className={styles.observeButton}
              onClick={() => onObserve(session)}
              title={t('sessions:actions.observeHint')}
            >
              <Eye size={16} aria-hidden="true" />
              <span>{t('sessions:actions.observe')}</span>
            </button>
          )}

          <button
            type="button"
            className={styles.detailsButton}
            aria-expanded={expanded}
            onClick={() => onToggleDetails(session.id)}
          >
            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            <span>{t(expanded ? 'sessions:actions.hideDetails' : 'sessions:actions.details')}</span>
          </button>
        </span>
      </div>

      {expanded && (
        <dl className={styles.details}>
          <div className={styles.detailItem}>
            <dt>{t('sessions:fields.code')}</dt>
            <dd>{session.code}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>{t('sessions:fields.student')}</dt>
            <dd>{student?.name ?? '—'}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>{t('sessions:fields.grade')}</dt>
            <dd>{student?.grade ? t(`sessions:grades.${student.grade}`) : '—'}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>{t('sessions:fields.teacher')}</dt>
            <dd>{teacher?.name ?? '—'}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>{t('sessions:fields.subject')}</dt>
            <dd>{subjectDisplayName(session, t, 'sessions:subjects')}</dd>
          </div>
          <div className={styles.detailItem}>
            <dt>{t('sessions:fields.endsAt')}</dt>
            <dd>
              {timeFmt.format(new Date(session.startsAt.getTime() + session.durationMin * 60_000))}
            </dd>
          </div>
          {isPast && (
            <div className={styles.detailItem}>
              <dt>{t('sessions:fields.attendance')}</dt>
              <dd>{session.attendance ? t(`sessions:attendance.${session.attendance}`) : t('sessions:notRecorded')}</dd>
            </div>
          )}
          {!isPast && (
            <div className={styles.detailItem}>
              <dt>{t('sessions:fields.countdown')}</dt>
              <dd>{t('sessions:minutesToStart', { count: minutesToStart })}</dd>
            </div>
          )}
          {makeupOf && (
            <div className={styles.detailItem}>
              <dt>{t('sessions:fields.makeupOf')}</dt>
              <dd>{makeupOf.code}</dd>
            </div>
          )}
          <p className={styles.metadataNote}>{t('sessions:metadataNote')}</p>
        </dl>
      )}
    </li>
  )
}

/** صفحة الحصص — المسار: /sessions */
export function SessionsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { sessions, students, teachers, loading, error } = useAppData()

  const role = effectiveRoleFor(user)
  const staff = canObserveSessions(role)

  const [tab, setTab] = useState<Tab>('upcoming')
  const [teacherFilter, setTeacherFilter] = useState('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [preJoin, setPreJoin] = useState<ClassSession | null>(null)

  /**
   * نطاق الرؤية: الخادم يرجّع لهذا الحساب حصصه فقط (طالب: حصصه، ولي أمر: أبناءه،
   * مدرس: حصصه، إدارة: حسب الصلاحية) — فلا تصفية وهمية ولا بيانات نموذجية هنا.
   */
  const scoped = useMemo(() => {
    if (role === 'teacher') return sessions.filter((s) => s.teacherId === (user?.id ?? -1))
    return sessions
  }, [role, sessions, user?.id])

  /** البحث في الأسماء — كل ما يُعرض مصدره ردّ الخادم */
  const lookup = useMemo<SessionLookup>(() => {
    return {
      teacherById: (id) => teachers.find((x) => x.id === id) ?? null,
      studentById: (id) => students.find((x) => x.id === id) ?? null,
      sessionById: (id) => sessions.find((s) => s.id === id) ?? null,
    }
  }, [teachers, students, sessions])

  const base = useMemo(
    () => (teacherFilter === 'all' ? scoped : scoped.filter((s) => s.teacherId === Number(teacherFilter))),
    [scoped, teacherFilter],
  )

  const [now] = useState(() => Date.now())

  const rows = useMemo(() => {
    const wanted = TAB_STATUSES[tab]
    const list = base.filter((s) => wanted.includes(s.status))
    return [...list].sort((a, b) => {
      const diff = a.startsAt.getTime() - b.startsAt.getTime()
      return tab === 'upcoming' ? diff : -diff
    })
  }, [base, tab])

  const stats = useMemo(() => {
    const today = sessionsOn(base, new Date())
    const full = statsForSessions(base)
    const week = full.weekly[full.weekly.length - 1]
    const month = new Date()
    const monthList = base.filter(
      (s) => s.startsAt.getFullYear() === month.getFullYear() && s.startsAt.getMonth() === month.getMonth(),
    )
    const completedThisWeek = week
      ? base.filter((s) => s.status === 'completed' && s.startsAt >= week.weekStart).length
      : 0
    return {
      today: today.length,
      completedThisWeek,
      monthHours: Math.round(statsForSessions(monthList).completedHours),
    }
  }, [base])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(language, { weekday: 'long', day: 'numeric', month: 'long' }),
    [language],
  )
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }),
    [language],
  )

  const enterClassroom = (session: ClassSession) => {
    setPreJoin(null)
    navigate(sessionLivePath(session.id))
  }

  const statCards: ReadonlyArray<{ key: string; value: string; Icon: typeof CalendarDays; tint: Tint }> = [
    { key: 'today', value: String(stats.today), Icon: CalendarDays, tint: 'blue' },
    { key: 'weekCompleted', value: String(stats.completedThisWeek), Icon: CheckCircle2, tint: 'green' },
    { key: 'monthHours', value: t('sessions:hoursValue', { hours: stats.monthHours }), Icon: Clock, tint: 'purple' },
  ]

  return (
    <div className={styles.page}>
      {error && (
        <p className={styles.demoNote} role="alert">
          {error}
        </p>
      )}
      {loading && <p className={styles.demoNote}>{t('common:loading')}</p>}
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.title}>{t('sessions:title')}</h1>
          <p className={styles.subtitle}>{t(`sessions:scope.${role}`)}</p>
        </div>

        {staff && (
          <label className={styles.teacherFilter}>
            <span className={styles.filterLabel}>{t('sessions:filters.teacher')}</span>
            <select
              className={styles.select}
              value={teacherFilter}
              onChange={(event) => setTeacherFilter(event.target.value)}
            >
              <option value="all">{t('sessions:filters.allTeachers')}</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <section className={styles.statsGrid} aria-label={t('sessions:statsAria')}>
        {statCards.map(({ key, value, Icon, tint }) => (
          <div key={key} className={`${styles.statCard} ${styles[`tint_${tint}`]}`}>
            <span className={`${styles.statIcon} ${styles[`icon_${tint}`]}`} aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{t(`sessions:stats.${key}`)}</span>
          </div>
        ))}
      </section>

      <div className={styles.tabs} role="tablist" aria-label={t('sessions:tabsAria')}>
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            className={`${styles.tab} ${tab === item ? styles.tabActive : ''}`}
            onClick={() => setTab(item)}
          >
            {t(`sessions:tabs.${item}`)}
          </button>
        ))}
      </div>

      <section className={styles.card}>
        {rows.length === 0 ? (
          <p className={styles.empty}>{t('sessions:empty')}</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                lookup={lookup}
                dateFmt={dateFmt}
                timeFmt={timeFmt}
                now={now}
                isStaff={staff}
                expanded={expandedId === session.id}
                onToggleDetails={(id) => setExpandedId((current) => (current === id ? null : id))}
                onJoin={setPreJoin}
                onObserve={(session) => enterClassroom(session)}
              />
            ))}
          </ul>
        )}
      </section>

      {preJoin && (
        <PreJoinDialog
          session={preJoin}
          lookup={lookup}
          timeFmt={timeFmt}
          dateFmt={dateFmt}
          onClose={() => setPreJoin(null)}
          onJoin={() => enterClassroom(preJoin)}
        />
      )}
    </div>
  )
}
