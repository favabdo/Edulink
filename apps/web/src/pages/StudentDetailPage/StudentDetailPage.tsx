import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  GraduationCap,
  Pencil,
  Percent,
  Phone,
  Target,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ROUTES } from '../../app/router/paths'
import { useLanguage } from '../../i18n/useLanguage'
import { parentById, studentById, studentStats, teacherById, useStoreSnapshot } from '../../lib/data/eduStore'
import { DirectionalArrow } from './DirectionalArrow'
import { FollowUpTab } from './FollowUpTab'
import { HistoryTab } from './HistoryTab'
import { UpcomingTab } from './UpcomingTab'
import { initialsOf, useFormatters, useLabels } from './text'
import styles from './StudentDetailPage.module.css'

const TABS = ['upcoming', 'history', 'followUp'] as const
type TabKey = (typeof TABS)[number]

type Tint = 'blue' | 'green' | 'purple' | 'pink'

const TINT_BG: Record<Tint, string> = {
  blue: styles.tintBlue,
  green: styles.tintGreen,
  purple: styles.tintPurple,
  pink: styles.tintPink,
}

const TINT_FG: Record<Tint, string> = {
  blue: styles.fgBlue,
  green: styles.fgGreen,
  purple: styles.fgPurple,
  pink: styles.fgPink,
}

function BackLink() {
  const { t } = useTranslation()
  const { language } = useLanguage()

  return (
    <Link to={ROUTES.students} className={styles.backLink}>
      {language === 'ar' ? (
        <ArrowRight size={15} aria-hidden="true" />
      ) : (
        <ArrowLeft size={15} aria-hidden="true" />
      )}
      <span>{t('students:actions.back')}</span>
    </Link>
  )
}

function Chip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipValue}>{value}</span>
    </span>
  )
}

function NotFound() {
  const { t } = useTranslation()

  return (
    <section className={styles.card}>
      <div className={styles.empty}>
        <span className={styles.emptyIcon} aria-hidden="true">
          <UsersRound size={26} />
        </span>
        <p className={styles.emptyTitle}>{t('students:detail.notFoundTitle')}</p>
        <p className={styles.emptyDesc}>{t('students:detail.notFoundDesc')}</p>
        <Link to={ROUTES.students} className={styles.primaryButton}>
          <span>{t('students:detail.notFoundAction')}</span>
          <DirectionalArrow size={16} />
        </Link>
      </div>
    </section>
  )
}

/** صفحة تفاصيل طالب — المسار: /students/:studentId */
export function StudentDetailPage() {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const labels = useLabels()
  const { studentId } = useParams<{ studentId: string }>()
  const [tab, setTab] = useState<TabKey>('upcoming')

  const parsedId = Number(studentId)
  /** الاشتراك في لقطة المخزن: تُعاد الرسمة عندما تصل بيانات الطالب من الخادم */
  useStoreSnapshot()
  const student = Number.isInteger(parsedId) && parsedId > 0 ? studentById(parsedId) : null
  const stats = student ? studentStats(student.id) : null

  if (!student || !stats) {
    return (
      <div className={styles.page}>
        <BackLink />
        <NotFound />
      </div>
    )
  }

  const teacher = teacherById(student.teacherId)
  const parent = parentById(student.parentId)

  const statCards: Array<{ key: string; value: string; Icon: typeof Clock; tint: Tint }> = [
    { key: 'totalHours', value: fmt.number.format(stats.total), Icon: Clock, tint: 'blue' },
    { key: 'completedSessions', value: fmt.number.format(stats.completed), Icon: CheckCircle2, tint: 'green' },
    { key: 'attendance', value: fmt.percent.format(stats.attendanceRate), Icon: Percent, tint: 'purple' },
    { key: 'commitment', value: fmt.percent.format(stats.commitmentRate), Icon: Target, tint: 'pink' },
  ]

  return (
    <div className={styles.page}>
      <BackLink />

      <section className={styles.card}>
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(student.name, t('students:detail.avatarFallback'))}
          </span>

          <div className={styles.identityText}>
            <div className={styles.nameRow}>
              <h1 className={styles.name}>{student.name}</h1>
              <span className={`${styles.pill} ${student.active ? styles.pillActive : styles.pillInactive}`}>
                {t(student.active ? 'students:status.active' : 'students:status.inactive')}
              </span>
            </div>
            <p className={styles.email}>{student.email}</p>

            <div className={styles.chips}>
              <Chip
                icon={<GraduationCap size={14} />}
                label={t('students:columns.grade')}
                value={labels.grade(student.grade)}
              />
              <Chip
                icon={<BookOpen size={14} />}
                label={t('students:columns.subject')}
                value={labels.subject(student.subject)}
              />
              <Chip
                icon={<UserRound size={14} />}
                label={t('students:columns.teacher')}
                value={teacher?.name ?? t('students:noData')}
              />
              <Chip
                icon={<UsersRound size={14} />}
                label={t('students:columns.parent')}
                value={parent?.name ?? t('students:noData')}
              />
              <Chip
                icon={<CalendarDays size={14} />}
                label={t('students:detail.joinedShort')}
                value={fmt.date.format(student.joinedAt)}
              />
            </div>
          </div>

          <div className={styles.quickActions}>
            <button type="button" className={styles.secondaryButton}>
              <Phone size={16} aria-hidden="true" />
              <span>{t('students:detail.contact')}</span>
            </button>
            <button type="button" className={styles.primaryButton}>
              <Pencil size={16} aria-hidden="true" />
              <span>{t('students:detail.edit')}</span>
            </button>
          </div>
        </div>
      </section>

      <section className={styles.statsGrid}>
        {statCards.map(({ key, value, Icon, tint }) => (
          <div key={key} className={`${styles.statCard} ${TINT_BG[tint]}`}>
            <span className={`${styles.statIcon} ${TINT_FG[tint]}`} aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className={styles.statValue}>{value}</span>
            <span className={styles.statLabel}>{t(`students:stats.${key}`)}</span>
          </div>
        ))}
      </section>

      <section className={styles.card}>
        <div className={styles.tabs} role="tablist" aria-label={t('students:tabs.label')}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`student-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`student-panel-${key}`}
              className={`${styles.tab} ${tab === key ? styles.tabActive : ''}`}
              onClick={() => setTab(key)}
            >
              {t(`students:tabs.${key}`)}
            </button>
          ))}
        </div>

        <div className={styles.panelBody} id={`student-panel-${tab}`} role="tabpanel" aria-labelledby={`student-tab-${tab}`}>
          {tab === 'upcoming' && <UpcomingTab studentId={student.id} />}
          {tab === 'history' && <HistoryTab studentId={student.id} />}
          {tab === 'followUp' && <FollowUpTab studentId={student.id} />}
        </div>

      </section>
    </div>
  )
}
