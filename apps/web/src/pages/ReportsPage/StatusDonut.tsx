import { useTranslation } from 'react-i18next'
import type { HoursStats, SessionStatus } from '../../lib/data/eduStore'
import type { ReportFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

const SIZE = 168
const RADIUS = 62
const STROKE = 20
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

type Segment = {
  status: SessionStatus
  value: number
  className: string
}

/** حلقة التوزيع بالحالات — تُرسم بـ stroke-dasharray على دائرة واحدة لكل حالة */
export function StatusDonut({ stats, fmt }: { stats: HoursStats; fmt: ReportFormatters }) {
  const { t } = useTranslation()

  const segments: Segment[] = [
    { status: 'completed', value: stats.completed, className: 'seg_completed' },
    { status: 'cancelled', value: stats.cancelled, className: 'seg_cancelled' },
    { status: 'no_show', value: stats.noShow, className: 'seg_no_show' },
    { status: 'scheduled', value: stats.scheduled, className: 'seg_scheduled' },
  ]
  const total = segments.reduce((acc, segment) => acc + segment.value, 0)

  let swept = 0

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t('reports:chart.donutTitle')}</h3>
        <p className={styles.cardSub}>{t('reports:chart.donutSub', { total: fmt.count(total) })}</p>
      </header>

      <div className={styles.donutBody}>
        <div className={styles.donutWrap}>
          <svg
            className={styles.donutSvg}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={t('reports:chart.donutAria')}
          >
            <circle className={styles.donutTrack} cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} />

            {total > 0 &&
              segments.map((segment) => {
                if (segment.value === 0) return null
                const length = (segment.value / total) * CIRCUMFERENCE
                const offset = -swept
                swept += length

                return (
                  <circle
                    key={segment.status}
                    className={`${styles.donutSegment} ${styles[segment.className]}`}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    strokeWidth={STROKE}
                    strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  >
                    <title>
                      {t('reports:chart.segmentTooltip', {
                        status: t(`reports:status.${segment.status}`),
                        value: fmt.count(segment.value),
                        percent: t('reports:format.percent', {
                          value: fmt.percent(segment.value / total),
                        }),
                      })}
                    </title>
                  </circle>
                )
              })}
          </svg>

          <div className={styles.donutCenter}>
            <span className={styles.donutValue}>{fmt.count(total)}</span>
            <span className={styles.donutCaption}>{t('reports:chart.centerTotal')}</span>
          </div>
        </div>

        <ul className={styles.legend}>
          {segments.map((segment) => (
            <li key={segment.status} className={styles.legendRow}>
              <span className={`${styles.legendDot} ${styles[segment.className]}`} aria-hidden="true" />
              <span className={styles.legendLabel}>{t(`reports:status.${segment.status}`)}</span>
              <span className={styles.legendValue}>{fmt.count(segment.value)}</span>
              <span className={styles.legendPercent}>
                {t('reports:format.percent', { value: fmt.percent(total ? segment.value / total : 0) })}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
