import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BarChart3,
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
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '../../features/auth/authContext'
import { useLanguage } from '../../i18n/useLanguage'
import {
  recentActivity,
  todaySessions,
  todayStats,
  upcomingSessions,
  type SessionRow,
  type SessionStatus,
} from '../../features/dashboard/data/dashboardContent'
import styles from './HomePage.module.css'

type Tint = 'blue' | 'green' | 'purple' | 'pink'

const SUBJECT_STYLE: Record<SessionRow['subjectKey'], { Icon: typeof Sigma; tint: Tint }> = {
  math: { Icon: Sigma, tint: 'purple' },
  english: { Icon: Languages, tint: 'blue' },
  physics: { Icon: Atom, tint: 'green' },
  chemistry: { Icon: FlaskConical, tint: 'pink' },
}

const STATUS_STYLE: Record<SessionStatus, string> = {
  completed: 'chipCompleted',
  live: 'chipLive',
  inHour: 'chipSoon',
  inHours: 'chipSoon',
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

function SubjectIcon({ subjectKey, size = 22 }: { subjectKey: SessionRow['subjectKey']; size?: number }) {
  const { Icon, tint } = SUBJECT_STYLE[subjectKey]
  return (
    <span className={`${styles.subjectIcon} ${styles[`tint_${tint}`]}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  )
}

function HeroBanner({ name }: { name: string }) {
  const { t } = useTranslation()
  return (
    <section className={styles.hero}>
      <div className={styles.heroText}>
        <h1 className={styles.heroTitle}>{t('dashboard:greeting', { name })}</h1>
        <p className={styles.heroSub}>{t('dashboard:greetingSub')}</p>
        <button type="button" className={styles.heroButton}>
          <Play size={18} aria-hidden="true" />
          <span>{t('dashboard:startSession')}</span>
        </button>
      </div>
      <div className={styles.heroArt} aria-hidden="true">
        <span className={styles.heroArtCircle} />
        <Video size={64} />
      </div>
    </section>
  )
}

function DailySchedule() {
  const { t } = useTranslation()
  return (
    <section className={styles.card}>
      <SectionHeader
        title={t('dashboard:dailySchedule')}
        icon={<CalendarDays size={20} aria-hidden="true" />}
        viewAllTo="/schedule"
      />

      <ul className={styles.sessionList}>
        {todaySessions.map((session) => {
          const isLive = session.status === 'live'
          return (
            <li key={session.id} className={styles.sessionRow}>
              {/* ترتيب DOM = ترتيب القراءة: الوقت ثم الأيقونة ثم المادة ثم الطالب ثم الحالة ثم الإجراء */}
              <span className={styles.sessionTime}>
                {session.from} - {session.to}
              </span>

              <SubjectIcon subjectKey={session.subjectKey} />

              <span className={styles.sessionSubject}>{t(`dashboard:subjects.${session.subjectKey}`)}</span>

              <span className={styles.sessionStudent}>
                <Users size={16} aria-hidden="true" />
                <span>{session.student}</span>
              </span>

              <span className={`${styles.chip} ${styles[STATUS_STYLE[session.status]]}`}>
                {session.status === 'completed' && <CheckCircle2 size={14} aria-hidden="true" />}
                {isLive && <Video size={14} aria-hidden="true" />}
                {!isLive && session.status !== 'completed' && <Clock size={14} aria-hidden="true" />}
                <span>
                  {session.status === 'inHours'
                    ? t('dashboard:status.inHours', { count: session.hours })
                    : t(`dashboard:status.${session.status}`)}
                </span>
              </span>

              <span className={styles.sessionAction}>
                {isLive ? (
                  <button type="button" className={styles.joinButton}>
                    <Video size={16} aria-hidden="true" />
                    <span>{t('dashboard:actions.join')}</span>
                  </button>
                ) : (
                  <button type="button" className={styles.detailsButton}>
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>{t('dashboard:actions.details')}</span>
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <p className={styles.demoNote}>{t('dashboard:demoNote')}</p>
    </section>
  )
}

function QuickTools() {
  const { t } = useTranslation()
  const tools = [
    { key: 'schedule', Icon: CalendarDays, tint: 'purple' as Tint, to: '/schedule' },
    { key: 'students', Icon: Users, tint: 'green' as Tint, to: '/students' },
    { key: 'reports', Icon: BarChart3, tint: 'blue' as Tint, to: '/reports' },
    { key: 'messages', Icon: MessageSquare, tint: 'pink' as Tint, to: '/messages' },
  ]

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
              <span className={styles.toolDesc}>{t(`dashboard:tools.${key}.desc`)}</span>
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

function TodaySummary() {
  const { t } = useTranslation()
  const cards = [
    { key: 'todaySessions', value: todayStats.total, Icon: Play, tint: 'blue' as Tint },
    { key: 'completed', value: todayStats.completed, Icon: CheckCircle2, tint: 'green' as Tint },
    { key: 'remaining', value: todayStats.remaining, Icon: Clock, tint: 'purple' as Tint },
    { key: 'nextWeek', value: todayStats.nextWeek, Icon: CalendarDays, tint: 'pink' as Tint },
  ]

  return (
    <section className={styles.card}>
      <SectionHeader
        title={t('dashboard:todaySummary')}
        icon={<CalendarDays size={20} aria-hidden="true" />}
      />
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

function UpcomingSessions() {
  const { t } = useTranslation()
  return (
    <section className={styles.card}>
      <SectionHeader
        title={t('dashboard:upcomingSessions')}
        icon={<Clock size={20} aria-hidden="true" />}
        viewAllTo="/schedule"
      />
      <ul className={styles.upcomingList}>
        {upcomingSessions.map((item) => (
          <li key={item.id} className={styles.upcomingRow}>
            <SubjectIcon subjectKey={item.subjectKey} />
            <span className={styles.upcomingText}>
              <span className={styles.upcomingSubject}>{t(`dashboard:subjects.${item.subjectKey}`)}</span>
              <span className={styles.upcomingStudent}>{item.student}</span>
            </span>
            <span className={styles.upcomingTime}>
              {item.from} – {item.to}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RecentActivity() {
  const { t } = useTranslation()
  const icons = [CheckCircle2, Video, Users, CalendarDays]

  return (
    <section className={styles.card}>
      <SectionHeader
        title={t('dashboard:recentActivity')}
        icon={<BarChart3 size={20} aria-hidden="true" />}
      />
      <ul className={styles.activityList}>
        {recentActivity.map((item, index) => {
          const Icon = icons[index % icons.length]
          return (
            <li key={item.id} className={styles.activityRow}>
              <span className={styles.activityIcon} aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className={styles.activityText}>{t(`dashboard:activity.${item.textKey}`)}</span>
              <span className={styles.activityTime}>{t(`dashboard:ago.${item.atKey}`)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** الصفحة الرئيسية الداخلية — المسار: /home */
export function HomePage() {
  const { user } = useAuth()

  return (
    <div className={styles.grid}>
      <div className={styles.mainColumn}>
        <HeroBanner name={user?.name ?? ''} />
        <DailySchedule />
        <QuickTools />
      </div>
      <div className={styles.sideColumn}>
        <TodaySummary />
        <UpcomingSessions />
        <RecentActivity />
      </div>
    </div>
  )
}
