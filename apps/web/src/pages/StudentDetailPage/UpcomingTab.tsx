import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionsForStudent, useStoreSnapshot, teacherById, upcoming } from '../../lib/data/eduStore'
import { PanelEmpty } from './PanelEmpty'
import { useFormatters, useLabels } from './text'
import styles from './StudentDetailPage.module.css'

/** تبويب «الجدول القادم» — الحصص التي لم تنتهِ بعد مرتبةً تصاعدًا */
export function UpcomingTab({ studentId }: { studentId: number }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const labels = useLabels()

  useStoreSnapshot()
  const rows = upcoming(sessionsForStudent(studentId))

  if (rows.length === 0) {
    return (
      <PanelEmpty
        icon={<CalendarClock size={26} aria-hidden="true" />}
        title={t('students:upcoming.empty')}
        desc={t('students:upcoming.emptyDesc')}
      />
    )
  }

  return (
    <>
      <p className={styles.listCount}>
        {t('students:upcoming.count', { n: fmt.number.format(rows.length) })}
      </p>
      <ul className={styles.sessionList}>
        {rows.map((session) => (
          <li key={session.id} className={styles.sessionRow}>
            <span className={styles.sessionWhen}>
              <span className={styles.sessionDay}>{fmt.day.format(session.startsAt)}</span>
              <span className={styles.sessionTime}>
                {fmt.time.format(session.startsAt)}
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
                {t('students:upcoming.duration', { minutes: fmt.number.format(session.durationMin) })}
              </span>
            </span>

            <span className={styles.sessionSubject}>{labels.subject(session.subject)}</span>

            <span className={styles.sessionTeacher}>{teacherById(session.teacherId)?.name ?? ''}</span>

            <span className={styles.sessionBadges}>
              {session.makeupOfId !== null && (
                <span className={styles.pillMakeup}>{t('students:makeup')}</span>
              )}
              <span
                className={`${styles.pill} ${session.status === 'live' ? styles.pillLive : styles.pillScheduled}`}
              >
                {labels.sessionStatus(session.status)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
