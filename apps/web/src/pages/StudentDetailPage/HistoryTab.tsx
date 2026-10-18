import { History } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionsForStudent, useStoreSnapshot, type AttendanceMark, type SessionStatus } from '../../lib/data/eduStore'
import { PanelEmpty } from './PanelEmpty'
import { useFormatters, useLabels } from './text'
import styles from './StudentDetailPage.module.css'

const STATUS_PILL: Partial<Record<SessionStatus, string>> = {
  completed: styles.pillCompleted,
  cancelled: styles.pillCancelled,
  no_show: styles.pillNoShow,
}

const ATTENDANCE_PILL: Partial<Record<AttendanceMark, string>> = {
  present: styles.pillPresent,
  late: styles.pillLate,
  absent: styles.pillAbsent,
}

/** تبويب «السجل» — كل الحصص المنتهية (مكتملة/ملغاة/غياب) بترتيب الأحدث أولًا */
export function HistoryTab({ studentId }: { studentId: number }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const labels = useLabels()

  useStoreSnapshot()
  const rows = sessionsForStudent(studentId)
    .filter((session) => session.status !== 'scheduled' && session.status !== 'live')
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())

  if (rows.length === 0) {
    return (
      <PanelEmpty
        icon={<History size={26} aria-hidden="true" />}
        title={t('students:history.empty')}
        desc={t('students:history.emptyDesc')}
      />
    )
  }

  return (
    <>
      <p className={styles.listCount}>
        {t('students:history.count', { n: fmt.number.format(rows.length) })}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>{t('students:tabs.history')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('students:history.code')}</th>
              <th scope="col">{t('students:history.date')}</th>
              <th scope="col">{t('students:columns.subject')}</th>
              <th scope="col">{t('students:columns.status')}</th>
              <th scope="col">{t('students:columns.attendance')}</th>
              <th scope="col">{t('students:makeup')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((session) => (
              <tr key={session.id}>
                <td className={styles.mono}>{session.code}</td>
                <td className={styles.nowrap}>{fmt.dateTime.format(session.startsAt)}</td>
                <td>{labels.subject(session.subject)}</td>
                <td>
                  <span className={`${styles.pill} ${STATUS_PILL[session.status] ?? styles.pillNeutral}`}>
                    {labels.sessionStatus(session.status)}
                  </span>
                </td>
                <td>
                  <span
                    className={`${styles.pill} ${
                      session.attendance ? ATTENDANCE_PILL[session.attendance] ?? styles.pillNeutral : styles.pillNeutral
                    }`}
                  >
                    {labels.attendance(session.attendance)}
                  </span>
                </td>
                <td className={styles.nowrap}>
                  {session.makeupOfId === null ? t('students:noData') : t('students:makeup')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
