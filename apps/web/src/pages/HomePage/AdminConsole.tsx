import {
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  Clock,
  GraduationCap,
  Plus,
  UserPlus,
  Users,
  Activity,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ROUTES } from '../../app/router/paths'
import { AlertsPanel, Bars, MetricsGrid } from '../../components/AdminPanels'
import { useAdminOverview } from '../../features/admin/useAdminOverview'
import { upcoming, useStoreSnapshot } from '../../lib/data/eduStore'
import { useLanguage } from '../../i18n/useLanguage'
import styles from './AdminConsole.module.css'

type PeriodKey = 'week' | 'month' | 'quarter'

const DAY_MS = 86_400_000

function periodRange(period: PeriodKey): { from: number; to: number } {
  const to = Date.now()
  const days = period === 'week' ? 7 : period === 'month' ? 30 : 90
  return { from: to - days * DAY_MS, to }
}

/** كونسول الإدارة — يظهر بدل الصفحة التقليدية للمشرف والمدير والأونر */
export function AdminConsole({ name }: { name: string }) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [period, setPeriod] = useState<PeriodKey>('month')
  const range = useMemo(() => periodRange(period), [period])
  const { data, loading, error } = useAdminOverview(range)

  /**
   * «حصص قادمة» و«ساعات مجدولة» لا تُقاس من نافذة الفترة: النافذة رجعية
   * (آخر ٧/٣٠/٩٠ يومًا) فلا يمكن أن تحتوي حصة لم تبدأ بعد — تُحسب من حصص
   * الحساب الحقيقية التي رجعت من الخادم بلا فلتر زمن.
   */
  const store = useStoreSnapshot()
  const forward = useMemo(() => {
    const next = upcoming(store.sessions)
    return { count: next.length, hours: next.reduce((acc, s) => acc + s.durationMin, 0) / 60 }
  }, [store])

  const numberFmt = useMemo(() => new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 1 }), [language])
  const fmt = (n: number) => numberFmt.format(n)
  const percentFmt = (n: number) => `${fmt(n)}٪`
  const weekFmt = useMemo(
    () => new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', day: 'numeric' }),
    [language],
  )

  const periods: Array<{ key: PeriodKey; label: string }> = [
    { key: 'week', label: t('dashboard:console.periodWeek') },
    { key: 'month', label: t('dashboard:console.periodMonth') },
    { key: 'quarter', label: t('dashboard:console.periodQuarter') },
  ]

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('dashboard:console.title', { name })}</h1>
          <p className={styles.sub}>{t('dashboard:console.sub')}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.periods} role="group" aria-label={t('dashboard:console.periodLabel')}>
            {periods.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`${styles.period} ${period === p.key ? styles.periodActive : ''}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Link to={ROUTES.schedule} className={styles.primaryButton}>
            <Plus size={16} aria-hidden="true" />
            <span>{t('dashboard:console.bookSession')}</span>
          </Link>
        </div>
      </header>

      {error && (
        <p className={styles.errorNotice} role="alert">
          {error}
        </p>
      )}

      {loading && !data && <p className={styles.loading}>{t('common:loading')}</p>}

      {data && (
        <>
          <MetricsGrid
            current={{ ...data.totals, upcoming: forward.count, scheduledHours: forward.hours }}
            previous={data.previous}
            numberFmt={fmt}
            percentFmt={percentFmt}
          />

          <div className={styles.columns}>
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>{t('dashboard:console.leaderboard')}</h2>
              {data.teachers.length === 0 ? (
                <p className={styles.empty}>{t('dashboard:console.noData')}</p>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('dashboard:console.colTeacher')}</th>
                      <th>{t('dashboard:console.colHours')}</th>
                      <th>{t('dashboard:console.colSessions')}</th>
                      <th>{t('dashboard:console.colStudents')}</th>
                      <th>{t('dashboard:console.colAttendance')}</th>
                      <th>{t('dashboard:console.colCommitment')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teachers.slice(0, 8).map((row) => (
                      <tr key={row.id}>
                        <th scope="row">
                          <Link to={`${ROUTES.reports}?teacher=${row.id}`} className={styles.teacherLink}>
                            {row.name}
                          </Link>
                        </th>
                        <td>{fmt(row.rows.completedHours)}</td>
                        <td>{fmt(row.rows.total)}</td>
                        <td>{fmt(row.rows.uniqueStudents)}</td>
                        <td>{percentFmt(row.rows.attendanceRate)}</td>
                        <td>{percentFmt(row.rows.commitmentRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <AlertsPanel alerts={data.alerts} numberFmt={fmt} />
          </div>

          <div className={styles.columns}>
            <Bars
              title={t('dashboard:console.weekly')}
              entries={data.weekly.map((w) => ({ key: weekFmt.format(new Date(w.weekStart)), value: w.hours }))}
              fmt={fmt}
            />
            <Bars
              title={t('dashboard:console.subjects')}
              entries={data.subjects.map((s) => ({ key: s.subject, value: s.sessions }))}
              fmt={fmt}
            />
          </div>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{t('dashboard:console.studentsBoard')}</h2>
            {data.students.length === 0 ? (
              <p className={styles.empty}>{t('dashboard:console.noData')}</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('dashboard:console.colStudent')}</th>
                    <th>{t('dashboard:console.colGrade')}</th>
                    <th>{t('dashboard:console.colSessions')}</th>
                    <th>{t('dashboard:console.colHours')}</th>
                    <th>{t('dashboard:console.colAttendance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.slice(0, 10).map((row) => (
                    <tr key={row.id}>
                      <th scope="row">
                        <Link to={`${ROUTES.reports}?student=${row.id}`} className={styles.teacherLink}>
                          {row.name}
                        </Link>
                      </th>
                      <td>{row.grade ? t(`students:grades.${row.grade}`, { defaultValue: row.grade }) : t('students:grades.none')}</td>
                      <td>{fmt(row.rows.total)}</td>
                      <td>{fmt(row.rows.completedHours)}</td>
                      <td>{percentFmt(row.rows.attendanceRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <div className={styles.columns}>
            <Bars
              title={t('dashboard:console.grades')}
              entries={data.grades.map((g) => ({ key: t(`students:grades.${g.grade}`, { defaultValue: g.grade }), value: g.sessions }))}
              fmt={fmt}
            />
            <section className={styles.card}>
              <h2 className={styles.cardTitle}>{t('dashboard:console.quick')}</h2>
              <div className={styles.quickRow}>
                <Link to={ROUTES.students} className={styles.quickCard}>
                  <UserPlus size={20} aria-hidden="true" />
                  <span>{t('dashboard:console.addStudent')}</span>
                </Link>
                <Link to={ROUTES.teachers} className={styles.quickCard}>
                  <UserPlus size={20} aria-hidden="true" />
                  <span>{t('dashboard:console.addTeacher')}</span>
                </Link>
                <Link to={ROUTES.parents} className={styles.quickCard}>
                  <UserPlus size={20} aria-hidden="true" />
                  <span>{t('dashboard:console.addParent')}</span>
                </Link>
                <Link to={ROUTES.schedule} className={styles.quickCard}>
                  <ArrowRight size={20} aria-hidden="true" />
                  <span>{t('dashboard:console.openSchedule')}</span>
                </Link>
              </div>
              <ul className={styles.extraStats}>
                <li>
                  <Clock size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.kpiUpcoming')}: {fmt(forward.count)}</span>
                </li>
                <li>
                  <CalendarDays size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.scheduledHours')}: {fmt(forward.hours)}</span>
                </li>
                <li>
                  <Users size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.kpiStudents')}: {fmt(data.totals.uniqueStudents)}</span>
                </li>
                <li>
                  <GraduationCap size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.kpiActiveTeachers')}: {fmt(data.teachers.length)}</span>
                </li>
                <li>
                  <Ban size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.kpiCancelled')}: {fmt(data.totals.cancelled + data.totals.noShow)}</span>
                </li>
                <li>
                  <Activity size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.kpiLate')}: {percentFmt(data.totals.lateRate)}</span>
                </li>
                <li>
                  <CheckCircle2 size={15} aria-hidden="true" />
                  <span>{t('dashboard:console.kpiCompleted')}: {fmt(data.totals.completed)}</span>
                </li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
