import { useTranslation } from 'react-i18next'
import { Ban, CheckCircle2, Clock, TrendingUp, UserX, Users } from 'lucide-react'
import type { HoursStats } from '../../lib/data/eduStore'
import type { ReportFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

type Tint = 'blue' | 'green' | 'purple' | 'pink'

type KpiCard = {
  key: 'completedHours' | 'completed' | 'attendanceRate' | 'commitmentRate' | 'cancelled' | 'noShow'
  value: string
  Icon: typeof Clock
  tint: Tint
}

/** بطاقات المؤشرات الست — كلها ساعات وحضور، لا شيء مالي */
export function KpiGrid({ stats, fmt }: { stats: HoursStats; fmt: ReportFormatters }) {
  const { t } = useTranslation()
  const percent = (rate: number) => t('reports:format.percent', { value: fmt.percent(rate) })

  const cards: KpiCard[] = [
    { key: 'completedHours', value: fmt.hours(stats.completedHours), Icon: Clock, tint: 'blue' },
    { key: 'completed', value: fmt.count(stats.completed), Icon: CheckCircle2, tint: 'green' },
    { key: 'attendanceRate', value: percent(stats.attendanceRate), Icon: Users, tint: 'purple' },
    { key: 'commitmentRate', value: percent(stats.commitmentRate), Icon: TrendingUp, tint: 'pink' },
    { key: 'cancelled', value: fmt.count(stats.cancelled), Icon: Ban, tint: 'purple' },
    { key: 'noShow', value: fmt.count(stats.noShow), Icon: UserX, tint: 'pink' },
  ]

  return (
    <div className={styles.kpiGrid}>
      {cards.map(({ key, value, Icon, tint }) => (
        <div key={key} className={`${styles.kpiCard} ${styles[`tint_${tint}`]}`}>
          <span className={`${styles.kpiIcon} ${styles[`icon_${tint}`]}`} aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className={styles.kpiValue}>{value}</span>
          <span className={styles.kpiLabel}>{t(`reports:kpis.${key}`)}</span>
        </div>
      ))}
    </div>
  )
}
