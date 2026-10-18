import { useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/authContext'
import { statsForSessions, useStoreSnapshot } from '../../lib/data/eduStore'
import { effectiveRoleFor } from '../../lib/roles'
import { buildCsv, downloadCsv, plainNumber } from './csvExport'
import { HoursTable } from './HoursTable'
import { KpiGrid } from './KpiGrid'
import { RangeToolbar } from './RangeToolbar'
import { StatusDonut } from './StatusDonut'
import { SubjectBars } from './SubjectBars'
import { WeeklyHoursChart } from './WeeklyHoursChart'
import {
  DEFAULT_CUSTOM_FROM,
  DEFAULT_CUSTOM_TO,
  resolveRange,
  rowsForScope,
  scopeForRole,
  sessionsForScope,
  sortRows,
  toInputDate,
} from './reportsModel'
import type { RangePreset, ReportScope, SortKey, SortState } from './reportsModel'
import { AdminReports } from './AdminReports'
import { useReportsFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

/** عنوان الجدول واسم عمود «الصف» حسب النطاق — لا نصوص داخل JSX */
const TABLE_TITLE_KEY: Record<ReportScope, string> = {
  staff: 'reports:table.teacherTitle',
  teacher: 'reports:table.selfTitle',
  student: 'reports:table.familyTitle',
  parent: 'reports:table.familyTitle',
}

const NAME_COLUMN_KEY: Record<ReportScope, string> = {
  staff: 'reports:table.columns.teacher',
  teacher: 'reports:table.columns.teacher',
  student: 'reports:table.columns.student',
  parent: 'reports:table.columns.student',
}

const SCOPE_BADGE_KEY: Record<ReportScope, string> = {
  staff: 'reports:scope.staff',
  teacher: 'reports:scope.teacher',
  student: 'reports:scope.student',
  parent: 'reports:scope.parent',
}

const DEFAULT_SORT: SortState = { key: 'completedHours', dir: 'desc' }

/** تقارير المدرس/الطالب/ولي الأمر — نطاقهم الشخصي فقط */
function PersonalReports() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const fmt = useReportsFormatters()

  const scope = scopeForRole(effectiveRoleFor(user))

  const [preset, setPreset] = useState<RangePreset>('quarter')
  const [customFrom, setCustomFrom] = useState(DEFAULT_CUSTOM_FROM)
  const [customTo, setCustomTo] = useState(DEFAULT_CUSTOM_TO)
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)

  const range = useMemo(() => resolveRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  /** الاشتراك في لقطة المخزن: إعادة الرسم عند وصول بيانات الخادم (القراءة من seed مباشرة) */
  useStoreSnapshot()
  const scopedSessions = sessionsForScope(scope, range)
  const stats = statsForSessions(scopedSessions)
  const sortedRows = sortRows(rowsForScope(scope, range), sort, fmt.locale)

  const hasData = scopedSessions.length > 0
  const rangeLabel = `${fmt.longDate.format(range.from)} — ${fmt.longDate.format(range.to)}`
  const sessionsLabel = t('reports:range.sessionsCount', { value: fmt.count(scopedSessions.length) })

  const handleSort = (key: SortKey) => {
    setSort((current) => {
      if (current.key !== key) return { key, dir: key === 'label' ? 'asc' : 'desc' }
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  /** تصدير الجدول الظاهر كما هو (بنفس ترتيب الضغط على الأعمدة) */
  const handleExport = () => {
    const header = [
      t(NAME_COLUMN_KEY[scope]),
      t('reports:table.columns.sessions'),
      t('reports:table.columns.completedHours'),
      t('reports:table.columns.attendanceRate'),
      t('reports:table.columns.commitmentRate'),
    ]

    const body = sortedRows.map((row) => [
      row.label,
      String(row.sessions),
      plainNumber(row.completedHours),
      String(Math.round(row.attendanceRate * 100)),
      String(Math.round(row.commitmentRate * 100)),
    ])

    body.push([
      t('reports:table.totals'),
      String(stats.total),
      plainNumber(stats.completedHours),
      String(Math.round(stats.attendanceRate * 100)),
      String(Math.round(stats.commitmentRate * 100)),
    ])

    downloadCsv(
      `${t('reports:export.fileName')}_${toInputDate(range.from)}_${toInputDate(range.to)}.csv`,
      buildCsv(header, body),
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>
            <BarChart3 size={22} aria-hidden="true" />
            <span>{t('reports:title')}</span>
          </h1>
          <p className={styles.pageSub}>{t('reports:subtitle')}</p>
        </div>
        <span className={styles.scopeBadge}>{t(SCOPE_BADGE_KEY[scope])}</span>
      </header>

      <RangeToolbar
        preset={preset}
        customFrom={customFrom}
        customTo={customTo}
        rangeLabel={rangeLabel}
        sessionsLabel={sessionsLabel}
        onPresetChange={setPreset}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onExport={handleExport}
      />

      <KpiGrid stats={stats} fmt={fmt} />

      {hasData ? (
        <>
          <div className={styles.chartsGrid}>
            <WeeklyHoursChart weekly={stats.weekly} fmt={fmt} />
            <StatusDonut stats={stats} fmt={fmt} />
            <SubjectBars bySubject={stats.bySubject} fmt={fmt} />
          </div>

          <HoursTable
            rows={sortedRows}
            totals={{
              sessions: stats.total,
              completedHours: stats.completedHours,
              attendanceRate: stats.attendanceRate,
              commitmentRate: stats.commitmentRate,
            }}
            sort={sort}
            titleKey={TABLE_TITLE_KEY[scope]}
            nameLabel={t(NAME_COLUMN_KEY[scope])}
            fmt={fmt}
            onSort={handleSort}
          />
        </>
      ) : (
        <section className={`${styles.card} ${styles.emptyCard}`}>
          <p className={styles.emptyText}>{t('reports:empty')}</p>
        </section>
      )}
    </div>
  )
}

/** صفحة التقارير والإحصائيات — المسار: /reports */
export function ReportsPage() {
  const { user } = useAuth()

  if (scopeForRole(effectiveRoleFor(user)) === 'staff') return <AdminReports />
  return <PersonalReports />
}
