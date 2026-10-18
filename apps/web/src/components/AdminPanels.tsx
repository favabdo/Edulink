import { Activity, AlertTriangle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Metrics, Overview } from '../features/admin/api'
import styles from './AdminPanels.module.css'

/** فرق بين الفترتين الحالية والسابقة — سهم صعود/هبوط/ثبات */
export function Delta({ current, previous, suffix = '' }: { current: number; previous: number; suffix?: string }) {
  const { t } = useTranslation()
  const diff = current - previous
  const flat = Math.abs(diff) < 0.05
  const Icon = flat ? Activity : diff > 0 ? TrendingUp : TrendingDown
  const tone = flat ? 'flat' : diff > 0 ? 'up' : 'down'
  return (
    <span className={`${styles.delta} ${styles[`delta_${tone}`]}`} title={t('dashboard:console.vsPrevious')}>
      <Icon size={13} aria-hidden="true" />
      <span>
        {diff > 0 ? '+' : ''}
        {Math.round(diff * 10) / 10}
        {suffix}
      </span>
    </span>
  )
}

export function StatCard({
  icon,
  label,
  value,
  hint,
  tint,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  hint?: React.ReactNode
  tint: 'blue' | 'green' | 'purple' | 'pink' | 'red'
}) {
  return (
    <div className={`${styles.stat} ${styles[`stat_${tint}`]}`}>
      <span className={styles.statIcon} aria-hidden="true">
        {icon}
      </span>
      <span className={styles.statBody}>
        <span className={styles.statValue}>{value}</span>
        <span className={styles.statLabel}>{label}</span>
        {hint && <span className={styles.statHint}>{hint}</span>}
      </span>
    </div>
  )
}

/** بطاقات مؤشرات الفترتين (الحالية + مقارنة بالسابقة) */
export function MetricsGrid({
  current,
  previous,
  numberFmt,
  percentFmt,
}: {
  current: Metrics
  previous: Metrics
  numberFmt: (n: number) => string
  percentFmt: (n: number) => string
}) {
  const { t } = useTranslation()
  return (
    <section className={styles.stats} aria-label={t('dashboard:console.kpis')}>
      <StatCard
        icon={<CheckCircle2 size={20} />}
        tint="blue"
        label={t('dashboard:console.kpiHours')}
        value={numberFmt(current.completedHours)}
        hint={<Delta current={current.completedHours} previous={previous.completedHours} />}
      />
      <StatCard
        icon={<Activity size={20} />}
        tint="purple"
        label={t('dashboard:console.kpiSessions')}
        value={numberFmt(current.total)}
        hint={<Delta current={current.total} previous={previous.total} />}
      />
      <StatCard
        icon={<CheckCircle2 size={20} />}
        tint="green"
        label={t('dashboard:console.kpiAttendance')}
        value={percentFmt(current.attendanceRate)}
        hint={<Delta current={current.attendanceRate} previous={previous.attendanceRate} suffix="٪" />}
      />
      <StatCard
        icon={<Activity size={20} />}
        tint="pink"
        label={t('dashboard:console.kpiCommitment')}
        value={percentFmt(current.commitmentRate)}
        hint={<Delta current={current.commitmentRate} previous={previous.commitmentRate} suffix="٪" />}
      />
      <StatCard
        icon={<TrendingDown size={20} />}
        tint="red"
        label={t('dashboard:console.kpiCancelled')}
        value={numberFmt(current.cancelled + current.noShow)}
      />
      <StatCard
        icon={<TrendingUp size={20} />}
        tint="green"
        label={t('dashboard:console.kpiOnTime')}
        value={percentFmt(current.onTimeStartRate)}
        hint={<Delta current={current.onTimeStartRate} previous={previous.onTimeStartRate} suffix="٪" />}
      />
      <StatCard
        icon={<Activity size={20} />}
        tint="blue"
        label={t('dashboard:console.kpiLate')}
        value={percentFmt(current.lateRate)}
      />
      <StatCard
        icon={<CheckCircle2 size={20} />}
        tint="purple"
        label={t('dashboard:console.kpiUpcoming')}
        value={numberFmt(current.upcoming)}
      />
    </section>
  )
}

/** شريط أشرطة أفقي بسيط — بلا مكتبة رسوم */
export function Bars({
  title,
  entries,
  fmt,
}: {
  title: string
  entries: Array<{ key: string; value: number }>
  fmt: (n: number) => string
}) {
  const { t } = useTranslation()
  const max = Math.max(...entries.map((e) => e.value), 1)
  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>{title}</h2>
      {entries.length === 0 ? (
        <p className={styles.empty}>{t('dashboard:console.noData')}</p>
      ) : (
        <ul className={styles.bars}>
          {entries.map((entry) => (
            <li key={entry.key} className={styles.barRow}>
              <span className={styles.barName}>{entry.key}</span>
              <span className={styles.barTrack}>
                <span className={styles.barFill} style={{ width: `${Math.round((entry.value / max) * 100)}%` }} />
              </span>
              <span className={styles.barValue}>{fmt(entry.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** لوحة التنبيهات التشغيلية */
export function AlertsPanel({
  alerts,
  numberFmt,
}: {
  alerts: Overview['alerts']
  numberFmt: (n: number) => string
}) {
  const { t } = useTranslation()

  const groups = [
    {
      key: 'unmarked',
      show: alerts.sessionsTodayUnmarked > 0,
      text: t('dashboard:console.alertUnmarked', { count: alerts.sessionsTodayUnmarked }),
      names: [] as string[],
    },
    {
      key: 'idle',
      show: alerts.idleTeachers.length > 0,
      text: t('dashboard:console.alertIdle', { count: alerts.idleTeachers.length }),
      names: alerts.idleTeachers.map((x) => x.name),
    },
    {
      key: 'noUpcoming',
      show: alerts.studentsWithoutUpcoming.length > 0,
      text: t('dashboard:console.alertStudentsIdle', { count: alerts.studentsWithoutUpcoming.length }),
      names: alerts.studentsWithoutUpcoming.map((x) => x.name),
    },
    {
      key: 'lowAtt',
      show: alerts.lowAttendanceTeachers.length > 0,
      text: t('dashboard:console.alertLowAttendance'),
      names: alerts.lowAttendanceTeachers.map((x) => `${x.name} — ${numberFmt(x.rate)}٪`),
    },
    {
      key: 'cancel',
      show: alerts.heavyCancellers.length > 0,
      text: t('dashboard:console.alertCancellers'),
      names: alerts.heavyCancellers.map((x) => `${x.name} — ${numberFmt(x.cancelled)}`),
    },
  ].filter((g) => g.show)

  const latency = t('dashboard:console.avgLatency', {
    minutes: numberFmt(Math.round(alerts.avgLatencyMinutes * 10) / 10),
  })

  if (groups.length === 0) {
    return (
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>{t('dashboard:console.alerts')}</span>
        </h2>
        <p className={styles.empty}>{t('dashboard:console.alertsClean')}</p>
        <p className={styles.latency}>{latency}</p>
      </section>
    )
  }

  return (
    <section className={styles.card}>
      <h2 className={styles.cardTitle}>
        <AlertTriangle size={18} aria-hidden="true" />
        <span>{t('dashboard:console.alerts')}</span>
      </h2>
      <ul className={styles.alertList}>
        {groups.map((group) => (
          <li key={group.key} className={styles.alertGroup}>
            <span className={styles.alertHead}>{group.text}</span>
            {group.names.length > 0 && <span className={styles.alertNames}>{group.names.slice(0, 6).join('، ')}</span>}
          </li>
        ))}
      </ul>
      <p className={styles.latency}>{latency}</p>
    </section>
  )
}
