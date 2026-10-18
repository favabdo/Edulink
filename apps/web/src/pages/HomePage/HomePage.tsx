import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  FlaskConical,
  Languages,
  MessageSquare,
  Play,
  Sigma,
  Users,
  Video,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../../features/auth/authContext'
import { useAppData } from '../../features/sessions/DataProvider'
import { useLanguage } from '../../i18n/useLanguage'
import { ROUTES, sessionLivePath, studentDetailPath } from '../../app/router/paths'
import { effectiveRoleFor, seesAllSchedule, type EffectiveRole } from '../../lib/roles'
import { studentById, subjectDisplayName, teacherById, upcoming, type ClassSession, type SubjectKey } from '../../lib/data/eduStore'
import { AdminConsole } from './AdminConsole'
import styles from './HomePage.module.css'

type Tint = 'blue' | 'green' | 'purple' | 'pink'

const SUBJECT_STYLE: Record<SubjectKey, { Icon: typeof Sigma; tint: Tint }> = {
  math: { Icon: Sigma, tint: 'purple' },
  english: { Icon: Languages, tint: 'blue' },
  physics: { Icon: Atom, tint: 'green' },
  chemistry: { Icon: FlaskConical, tint: 'pink' },
  biology: { Icon: FlaskConical, tint: 'green' },
  other: { Icon: BookOpen, tint: 'blue' },
}

/** مدة الحصة المنقضية حتى بداية الحصة — تُحدِّد نص حالة البطاقة */
function awayStatus(ms: number): 'live' | 'inHour' | 'inHours' {
  if (ms <= 0) return 'live'
  if (ms <= 60 * 60_000) return 'inHour'
  return 'inHours'
}

const CHIP_CLASS: Record<'completed' | 'live' | 'inHour' | 'inHours', string> = {
  completed: 'chipCompleted',
  live: 'chipLive',
  inHour: 'chipSoon',
  inHours: 'chipSoon',
}

function timeFmt(locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' })
}

/** عقرب الوقت للصفحة — يتحدث كل نصف دقيقة فتتحدث حالات البطاقات بلا تدخل */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function dayStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function sameDay(a: Date, b: Date) {
  return dayStart(a) === dayStart(b)
}

/** سهم يتجه ناحية نهاية السطر حسب اتجاه اللغة */
function ArrowIcon() {
  const { language } = useLanguage()
  return language === 'ar' ? (
    <ArrowLeft size={16} aria-hidden="true" />
  ) : (
    <ArrowRight size={16} aria-hidden="true" />
  )
}

function SectionHeader({
  title,
  icon,
  viewAllTo,
}: {
  title: string
  icon: React.ReactNode
  viewAllTo?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>
        {icon}
        <span>{title}</span>
      </h2>
      {viewAllTo && (
        <Link to={viewAllTo} className={styles.viewAll}>
          <span>{t('dashboard:viewAll')}</span>
          <ArrowIcon />
        </Link>
      )}
    </div>
  )
}

function SubjectIcon({ subjectKey, size = 22 }: { subjectKey: SubjectKey; size?: number }) {
  const { Icon, tint } = SUBJECT_STYLE[subjectKey] ?? SUBJECT_STYLE.math
  return (
    <span className={`${styles.subjectIcon} ${styles[`tint_${tint}`]}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  )
}

/** الاسم الظاهر في السطر: الطالب يرى المدرّس، والموظف يرى الطالب */
function counterpartName(session: ClassSession, role: EffectiveRole): string {
  if (role === 'student' || role === 'parent') return teacherById(session.teacherId)?.name ?? '—'
  return studentById(session.studentId)?.name ?? '—'
}

function HeroBanner({
  name,
  liveSession,
  role,
}: {
  name: string
  liveSession: ClassSession | null
  role: EffectiveRole
}) {
  const { t } = useTranslation()
  return (
    <section className={styles.hero}>
      <div className={styles.heroText}>
        <h1 className={styles.heroTitle}>{t('dashboard:greeting', { name })}</h1>
        <p className={styles.heroSub}>{t('dashboard:greetingSub')}</p>
        {liveSession && (
          <Link to={sessionLivePath(liveSession.id)} className={styles.heroButton}>
            <Play size={18} aria-hidden="true" />
            <span>
              {role === 'student' || role === 'parent'
                ? t('dashboard:actions.join')
                : t('dashboard:startSession')}
            </span>
          </Link>
        )}
      </div>
      <div className={styles.heroArt} aria-hidden="true">
        <span className={styles.heroArtCircle} />
        <Video size={64} />
      </div>
    </section>
  )
}

function SessionRow({
  session,
  role,
  now,
  locale,
}: {
  session: ClassSession
  role: EffectiveRole
  now: number
  locale: string
}) {
  const { t } = useTranslation()
  const fmt = timeFmt(locale)
  const endsAt = session.startsAt.getTime() + session.durationMin * 60_000
  const isCompleted = session.status === 'completed'
  const status = isCompleted ? 'completed' : awayStatus(session.startsAt.getTime() - now)
  const isLive = session.status === 'live' || (status === 'live' && session.status === 'scheduled')

  return (
    <li className={styles.sessionRow}>
      <span className={styles.sessionTime}>
        {fmt.format(session.startsAt)} - {fmt.format(new Date(endsAt))}
      </span>

      <SubjectIcon subjectKey={session.subject} />

      <span className={styles.sessionSubject}>{subjectDisplayName(session, t, 'dashboard:subjects')}</span>

      <span className={styles.sessionStudent}>
        <Users size={16} aria-hidden="true" />
        <span>{counterpartName(session, role)}</span>
      </span>

      <span className={`${styles.chip} ${styles[CHIP_CLASS[status]]}`}>
        {status === 'completed' && <CheckCircle2 size={14} aria-hidden="true" />}
        {isLive && <Video size={14} aria-hidden="true" />}
        {!isLive && status !== 'completed' && <Clock size={14} aria-hidden="true" />}
        <span>
          {status === 'inHours'
            ? t('dashboard:status.inHours', {
                count: Math.max(1, Math.round((session.startsAt.getTime() - now) / 3_600_000)),
              })
            : t(`dashboard:status.${status}`)}
        </span>
      </span>

      <span className={styles.sessionAction}>
        {isLive ? (
          <Link to={sessionLivePath(session.id)} className={styles.joinButton}>
            <Video size={16} aria-hidden="true" />
            <span>{t('dashboard:actions.join')}</span>
          </Link>
        ) : (
          <Link
            to={
              role === 'student' || role === 'parent'
                ? ROUTES.sessions
                : studentDetailPath(session.studentId)
            }
            className={styles.detailsButton}
          >
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>{t('dashboard:actions.details')}</span>
          </Link>
        )}
      </span>
    </li>
  )
}

function EmptyRows({ label }: { label: string }) {
  return <li className={styles.emptyRows}>{label}</li>
}

function DailySchedule({
  sessions,
  role,
  now,
  locale,
}: {
  sessions: ClassSession[]
  role: EffectiveRole
  now: number
  locale: string
}) {
  const { t } = useTranslation()
  const today = useMemo(() => {
    const day = new Date(now)
    return sessions
      .filter((s) => s.status !== 'cancelled' && s.status !== 'no_show' && sameDay(s.startsAt, day))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  }, [sessions, now])

  return (
    <section className={styles.card}>
      <SectionHeader
        title={t('dashboard:dailySchedule')}
        icon={<CalendarDays size={20} aria-hidden="true" />}
        viewAllTo={role === 'student' || role === 'parent' ? ROUTES.sessions : ROUTES.schedule}
      />

      <ul className={styles.sessionList}>
        {today.length === 0 && (
          <EmptyRows label={t('dashboard:emptyToday')} />
        )}
        {today.map((session) => (
          <SessionRow key={session.id} session={session} role={role} now={now} locale={locale} />
        ))}
      </ul>
    </section>
  )
}

function QuickTools({ role }: { role: EffectiveRole }) {
  const { t } = useTranslation()
  const family = role === 'student' || role === 'parent'
  const all = [
    { key: 'schedule', Icon: CalendarDays, tint: 'purple' as Tint, to: ROUTES.schedule, roles: ['owner', 'admin', 'supervisor', 'teacher', 'student'] },
    { key: 'sessions', Icon: Play, tint: 'blue' as Tint, to: ROUTES.sessions, roles: ['owner', 'admin', 'supervisor', 'teacher', 'student', 'parent'] },
    { key: 'students', Icon: Users, tint: 'green' as Tint, to: ROUTES.students, roles: ['owner', 'admin', 'supervisor', 'teacher'] },
    { key: 'reports', Icon: BarChart3, tint: 'blue' as Tint, to: ROUTES.reports, roles: ['owner', 'admin', 'supervisor', 'teacher'] },
    { key: 'messages', Icon: MessageSquare, tint: 'pink' as Tint, to: ROUTES.messages, roles: ['owner', 'admin', 'supervisor', 'teacher', 'student', 'parent'] },
  ]
  const tools = all.filter((tool) => tool.roles.includes(role))

  return (
    <section className={styles.card}>
      <SectionHeader title={t('dashboard:quickTools')} icon={<BarChart3 size={20} aria-hidden="true" />} />
      <div className={styles.toolsGrid}>
        {tools.map(({ key, Icon, tint, to }) => (
          <Link key={key} to={to} className={styles.toolCard}>
            <span className={`${styles.toolIcon} ${styles[`tint_${tint}`]}`} aria-hidden="true">
              <Icon size={24} />
            </span>
            <span className={styles.toolText}>
              <span className={styles.toolTitle}>{t(`dashboard:tools.${key}.title`)}</span>
              <span className={styles.toolDesc}>
                {key === 'messages' && family
                  ? t('dashboard:tools.messagesFamily.desc')
                  : t(`dashboard:tools.${key}.desc`)}
              </span>
            </span>
            <span className={styles.toolArrow}>
              <ArrowIcon />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}

function TodaySummary({ sessions, now }: { sessions: ClassSession[]; now: number }) {
  const { t } = useTranslation()
  const stats = useMemo(() => {
    const day = new Date(now)
    const weekAhead = new Date(now + 7 * 24 * 3_600_000)
    const active = sessions.filter((s) => s.status !== 'cancelled' && s.status !== 'no_show')
    const today = active.filter((s) => sameDay(s.startsAt, day))
    return {
      total: today.length,
      completed: today.filter((s) => s.status === 'completed').length,
      remaining: active.filter((s) => s.startsAt.getTime() > now).length,
      nextWeek: active.filter((s) => s.startsAt.getTime() > now && s.startsAt.getTime() <= weekAhead.getTime())
        .length,
    }
  }, [sessions, now])

  const cards = [
    { key: 'todaySessions', value: stats.total, Icon: Play, tint: 'blue' as Tint },
    { key: 'completed', value: stats.completed, Icon: CheckCircle2, tint: 'green' as Tint },
    { key: 'remaining', value: stats.remaining, Icon: Clock, tint: 'purple' as Tint },
    { key: 'nextWeek', value: stats.nextWeek, Icon: CalendarDays, tint: 'pink' as Tint },
  ]

  return (
    <section className={styles.card}>
      <SectionHeader title={t('dashboard:todaySummary')} icon={<CalendarDays size={20} aria-hidden="true" />} />
      <div className={styles.statsGrid}>
        {cards.map(({ key, value, Icon, tint }) => (
          <div key={key} className={`${styles.statCard} ${styles[`tint_${tint}`]}`}>
            <span className={`${styles.statIcon} ${styles[`icon_${tint}`]}`} aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{t(`dashboard:stats.${key}`)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function UpcomingSessions({
  sessions,
  role,
  now,
  locale,
}: {
  sessions: ClassSession[]
  role: EffectiveRole
  now: number
  locale: string
}) {
  const { t } = useTranslation()
  const fmt = timeFmt(locale)
  const list = useMemo(() => upcoming(sessions, new Date(now)).slice(0, 5), [sessions, now])

  return (
    <section className={styles.card}>
      <SectionHeader
        title={t('dashboard:upcomingSessions')}
        icon={<Clock size={20} aria-hidden="true" />}
        viewAllTo={role === 'student' || role === 'parent' ? ROUTES.sessions : ROUTES.schedule}
      />
      <ul className={styles.upcomingList}>
        {list.length === 0 && <li className={styles.emptyRows}>{t('dashboard:emptyUpcoming')}</li>}
        {list.map((session) => (
          <li key={session.id} className={styles.upcomingRow}>
            <SubjectIcon subjectKey={session.subject} />
            <span className={styles.upcomingText}>
              <span className={styles.upcomingSubject}>{subjectDisplayName(session, t, 'dashboard:subjects')}</span>
              <span className={styles.upcomingStudent}>{counterpartName(session, role)}</span>
            </span>
            <span className={styles.upcomingTime}>
              {new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(session.startsAt)}{' '}
              {fmt.format(session.startsAt)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** آخر ما جرى فعليًا: حصص مُنهاة أو جارية، مرتّبة بالأحدث */
function RecentActivity({
  sessions,
  role,
  locale,
}: {
  sessions: ClassSession[]
  role: EffectiveRole
  locale: string
}) {
  const { t } = useTranslation()
  const fmt = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  const list = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'completed' || s.status === 'live')
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
        .slice(0, 5),
    [sessions],
  )

  return (
    <section className={styles.card}>
      <SectionHeader title={t('dashboard:recentActivity')} icon={<BarChart3 size={20} aria-hidden="true" />} />
      <ul className={styles.activityList}>
        {list.length === 0 && <li className={styles.emptyRows}>{t('dashboard:emptyActivity')}</li>}
        {list.map((session) => (
          <li key={session.id} className={styles.activityRow}>
            <span className={styles.activityIcon} aria-hidden="true">
              {session.status === 'live' ? <Video size={16} /> : <CheckCircle2 size={16} />}
            </span>
            <span className={styles.activityText}>
              {t(session.status === 'live' ? 'dashboard:actLive' : 'dashboard:actCompleted', {
                subject: subjectDisplayName(session, t, 'dashboard:subjects'),
                name: counterpartName(session, role),
              })}
            </span>
            <span className={styles.activityTime}>{fmt.format(session.startsAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** الصفحة الرئيسية الداخلية — المسار: /home */
export function HomePage() {
  const { user } = useAuth()
  const { i18n, t } = useTranslation()
  const { sessions, loading, error } = useAppData()
  const role = effectiveRoleFor(user)
  const now = useNow()
  const locale = i18n.language

  const liveSession = useMemo(
    () =>
      sessions
        .filter((s) => s.status === 'live')
        .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null,
    [sessions],
  )

  // الإدارة (مشرف/مدير/أونر) ترى كونسولًا تشغيليًا لا صفحة المدرس التقليدية
  if (seesAllSchedule(role)) return <AdminConsole name={user?.name ?? ''} />

  if (error) {
    return (
      <div className={styles.grid}>
        <p className={styles.emptyRows} role="alert">
          {t('dashboard:loadError')}
        </p>
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      <div className={styles.mainColumn}>
        <HeroBanner name={user?.name ?? ''} liveSession={liveSession} role={role} />
        <DailySchedule sessions={sessions} role={role} now={now} locale={locale} />
        <QuickTools role={role} />
      </div>
      <div className={styles.sideColumn}>
        {loading ? (
          <p className={styles.emptyRows}>{t('common:loading')}</p>
        ) : (
          <>
            <TodaySummary sessions={sessions} now={now} />
            <UpcomingSessions sessions={sessions} role={role} now={now} locale={locale} />
            <RecentActivity sessions={sessions} role={role} locale={locale} />
          </>
        )}
      </div>
    </div>
  )
}
