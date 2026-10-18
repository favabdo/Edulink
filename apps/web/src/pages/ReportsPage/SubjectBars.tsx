import { useTranslation } from 'react-i18next'
import type { HoursStats } from '../../lib/data/eduStore'
import type { ReportFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

type Tint = 'blue' | 'green' | 'purple' | 'pink'

const TINTS: readonly Tint[] = ['blue', 'green', 'purple', 'pink']

/** أشرطة أفقية لعدد الحصص المكتملة لكل مادة */
export function SubjectBars({
  bySubject,
  fmt,
}: {
  bySubject: HoursStats['bySubject']
  fmt: ReportFormatters
}) {
  const { t } = useTranslation()

  const entries = Object.entries(bySubject)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)

  const max = Math.max(...entries.map((entry) => entry.value), 1)

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t('reports:chart.subjectsTitle')}</h3>
        <p className={styles.cardSub}>{t('reports:chart.subjectsSub')}</p>
      </header>

      {entries.length === 0 ? (
        <p className={styles.emptyHint}>{t('reports:chart.noSubjects')}</p>
      ) : (
        <ul className={styles.subjectList}>
          {entries.map((entry, index) => (
            <li key={entry.key} className={styles.subjectRow}>
              <span className={styles.subjectName}>{t(`reports:subjects.${entry.key}`, { defaultValue: entry.key })}</span>
              <span className={styles.subjectTrack}>
                <span
                  className={`${styles.subjectFill} ${styles[`tint_${TINTS[index % TINTS.length]}`]}`}
                  style={{ width: `${Math.round((entry.value / max) * 100)}%` }}
                  title={t('reports:chart.subjectTooltip', {
                    subject: t(`reports:subjects.${entry.key}`, { defaultValue: entry.key }),
                    value: fmt.count(entry.value),
                  })}
                />
              </span>
              <span className={styles.subjectValue}>{fmt.count(entry.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
