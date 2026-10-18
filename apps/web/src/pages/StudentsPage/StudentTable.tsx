import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { studentDetailPath } from '../../app/router/paths'
import { initialsOf, useFormatters, useLabels } from './text'
import { DirectionalArrow } from './DirectionalArrow'
import { StatusPill } from './StatusPill'
import type { StudentRow } from './studentRows'
import type { Student } from '../../lib/data/eduStore'
import styles from './StudentsPage.module.css'

function rateClass(rate: number): string {
  if (rate >= 0.8) return styles.rateHigh
  if (rate >= 0.6) return styles.rateMid
  return styles.rateLow
}

/** جدول الطلاب — يتمرر أفقيًا على الشاشات الضيقة بدل أن ينكسر */
export function StudentTable({
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
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.visuallyHidden}>{t('students:tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('students:columns.student')}</th>
            <th scope="col">{t('students:columns.grade')}</th>
            <th scope="col">{t('students:columns.subject')}</th>
            <th scope="col">{t('students:columns.teacher')}</th>
            <th scope="col">{t('students:columns.parent')}</th>
            <th scope="col" className={styles.cellNum}>
              {t('students:columns.hours')}
            </th>
            <th scope="col" className={styles.cellNum}>
              {t('students:columns.attendance')}
            </th>
            <th scope="col">{t('students:columns.status')}</th>
            <th scope="col">
              <span className={styles.visuallyHidden}>{t('students:columns.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.student.id}>
              <td>
                <Link to={studentDetailPath(row.student.id)} className={styles.studentCell}>
                  <span className={styles.avatar} aria-hidden="true">
                    {initialsOf(row.student.name, t('students:detail.avatarFallback'))}
                  </span>
                  <span className={styles.studentText}>
                    <span className={styles.studentName}>{row.student.name}</span>
                    <span className={styles.studentEmail}>{row.student.email}</span>
                  </span>
                </Link>
              </td>
              <td>{labels.grade(row.student.grade)}</td>
              <td>{labels.subjectOf(row.student)}</td>
              <td>{row.teacherName}</td>
              <td>{row.parentName}</td>
              <td className={styles.cellNum}>{fmt.number.format(row.completedHours)}</td>
              <td className={styles.cellNum}>
                <span className={rateClass(row.attendanceRate)}>{fmt.percent.format(row.attendanceRate)}</span>
              </td>
              <td>
                <StatusPill active={row.student.active} />
              </td>
              <td className={styles.cellAction}>
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
                <Link to={studentDetailPath(row.student.id)} className={styles.detailsLink}>
                  <span>{t('students:actions.details')}</span>
                  <DirectionalArrow size={15} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
