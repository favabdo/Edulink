import { BookOpen, CalendarDays, GraduationCap, Percent, Timer, UserRound, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { studentDetailPath } from '../../app/router/paths'
import { initialsOf, useFormatters, useLabels } from './text'
import { DirectionalArrow } from './DirectionalArrow'
import { StatusPill } from './StatusPill'
import type { StudentRow } from './studentRows'
import type { Student } from '../../lib/data/eduStore'
import styles from './StudentsPage.module.css'

function MetaRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  )
}

/** عرض الطلاب كبطاقات مستديرة بأسلوب بطاقات اللوحة */
export function StudentCards({
  rows,
  onManage,
}: {
  rows: StudentRow[]
  onManage?: (student: Student) => void
}) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const labels = useLabels()

  return (
    <ul className={styles.cardsGrid} aria-label={t('students:cardsCaption')}>
      {rows.map((row) => (
        <li key={row.student.id} className={styles.studentCard}>
          <div className={styles.cardTop}>
            <span className={`${styles.avatar} ${styles.avatarLg}`} aria-hidden="true">
              {initialsOf(row.student.name, t('students:detail.avatarFallback'))}
            </span>
            <span className={styles.cardIdentity}>
              <span className={styles.studentName}>{row.student.name}</span>
              <span className={styles.studentEmail}>{row.student.email}</span>
            </span>
            <StatusPill active={row.student.active} />
          </div>

          <div className={styles.cardMeta}>
            <MetaRow
              icon={<GraduationCap size={15} />}
              label={t('students:columns.grade')}
              value={labels.grade(row.student.grade)}
            />
            <MetaRow
              icon={<BookOpen size={15} />}
              label={t('students:columns.subject')}
              value={labels.subjectOf(row.student)}
            />
            <MetaRow
              icon={<UserRound size={15} />}
              label={t('students:columns.teacher')}
              value={row.teacherName}
            />
            <MetaRow
              icon={<UsersRound size={15} />}
              label={t('students:columns.parent')}
              value={row.parentName}
            />
          </div>

          <div className={styles.cardStats}>
            <span className={styles.cardStat}>
              <Timer size={16} aria-hidden="true" />
              <span className={styles.cardStatValue}>{fmt.number.format(row.completedHours)}</span>
              <span className={styles.cardStatLabel}>{t('students:columns.hours')}</span>
            </span>
            <span className={styles.cardStat}>
              <Percent size={16} aria-hidden="true" />
              <span className={styles.cardStatValue}>{fmt.percent.format(row.attendanceRate)}</span>
              <span className={styles.cardStatLabel}>{t('students:columns.attendance')}</span>
            </span>
            <span className={styles.cardStat}>
              <CalendarDays size={16} aria-hidden="true" />
              <span className={styles.cardStatValue}>{fmt.date.format(row.student.joinedAt)}</span>
              <span className={styles.cardStatLabel}>{t('students:detail.joinedShort')}</span>
            </span>
          </div>

          <div className={styles.cardActions}>
            {onManage && (
              <button
                type="button"
                className={styles.manageButton}
                onClick={() => onManage(row.student)}
                aria-label={t('common:manage.title')}
              >
                <span>{t('common:manage.open')}</span>
              </button>
            )}
            <Link to={studentDetailPath(row.student.id)} className={styles.cardAction}>
              <span>{t('students:actions.openProfile')}</span>
              <DirectionalArrow size={15} />
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}
