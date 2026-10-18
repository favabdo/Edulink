import { useTranslation } from 'react-i18next'
import type { HoursStats } from '../../lib/data/eduStore'
import { useLanguage } from '../../i18n/useLanguage'
import type { ReportFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

/** لوحة الرسم داخل viewBox ثابت — العرض يتمدد عبر CSS والنسب تحسب على هذه الأبعاد */
const VIEW_W = 720
const VIEW_H = 210
const SIDE_PAD = 18
const TOP_PAD = 24
const AXIS_H = 34

const GRID_FRACTIONS: readonly number[] = [0, 0.25, 0.5, 0.75, 1]

type WeeklyHoursChartProps = {
  weekly: HoursStats['weekly']
  fmt: ReportFormatters
}

/** أعمدة الساعات المكتملة لآخر 8 أسابيع — SVG خالص بلا مكتبة رسم */
export function WeeklyHoursChart({ weekly, fmt }: WeeklyHoursChartProps) {
  const { t } = useTranslation()
  const { language } = useLanguage()

  const slot = (VIEW_W - SIDE_PAD * 2) / weekly.length
  const barW = Math.min(slot * 0.58, 62)
  const plotH = VIEW_H - AXIS_H - TOP_PAD
  const max = Math.max(...weekly.map((week) => week.hours), 1)
  /** في العربية الزمن يجري من اليمين لليسار (الأقدم يمينًا)، وفي الإنجليزية العكس */
  const weeksFlowRightToLeft = language === 'ar'

  return (
    <section className={`${styles.card} ${styles.wide}`}>
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t('reports:chart.weeklyTitle')}</h3>
        <p className={styles.cardSub}>{t('reports:chart.weeklySub')}</p>
      </header>

      <svg
        className={styles.weeklySvg}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={t('reports:chart.weeklyAria')}
        preserveAspectRatio="xMidYMid meet"
      >
        {GRID_FRACTIONS.map((fraction) => {
          const y = TOP_PAD + plotH - fraction * plotH
          return (
            <line
              key={fraction}
              className={fraction === 0 ? styles.baseline : styles.gridLine}
              x1={SIDE_PAD}
              x2={VIEW_W - SIDE_PAD}
              y1={y}
              y2={y}
            />
          )
        })}

        {weekly.map((week, index) => {
          const visualIndex = weeksFlowRightToLeft ? weekly.length - 1 - index : index
          const x = SIDE_PAD + visualIndex * slot + (slot - barW) / 2
          const center = x + barW / 2
          const height = (week.hours / max) * plotH
          const y = TOP_PAD + plotH - height
          const label = fmt.shortDate.format(week.weekStart)

          return (
            <g key={week.weekStart.getTime()}>
              <rect
                className={styles.weekBar}
                x={x}
                y={height > 0 ? y : TOP_PAD + plotH - 3}
                width={barW}
                height={Math.max(height, 3)}
                rx={7}
              >
                <title>
                  {t('reports:chart.weekTooltip', { week: label, hours: fmt.hours(week.hours) })}
                </title>
              </rect>
              {week.hours > 0 && (
                <text className={styles.barValue} x={center} y={Math.max(y - 9, TOP_PAD - 10)} textAnchor="middle">
                  {fmt.hours(week.hours)}
                </text>
              )}
              <text className={styles.axisText} x={center} y={VIEW_H - 12} textAnchor="middle">
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </section>
  )
}
