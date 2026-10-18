import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BarChart3, CalendarClock, Filter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../app/router/paths'
import { AlertsPanel, Bars, MetricsGrid } from '../../components/AdminPanels'
import { useAdminOverview, useTeacherDrill } from '../../features/admin/useAdminOverview'
import { useAppData } from '../../features/sessions/DataProvider'
import { GRADES } from '../../lib/data/eduStore'
import { buildCsv, downloadCsv, plainNumber } from './csvExport'
import { HoursTable } from './HoursTable'
import { RangeToolbar } from './RangeToolbar'
import { SubjectBars } from './SubjectBars'
import { WeeklyHoursChart } from './WeeklyHoursChart'
import {
  DEFAULT_CUSTOM_FROM,
  DEFAULT_CUSTOM_TO,
  resolveRange,
  sortRows,
  toInputDate,
  type RangePreset,
  type ReportRow,
  type SortKey,
  type SortState,
} from './reportsModel'
import { useReportsFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

const DEFAULT_SORT: SortState = { key: 'completedHours', dir: 'desc' }

/** الخادم يُرجع النِسَب من 0 إلى 100، وجدول الساعات يعمل على 0..1 */
const asRate = (percent: number) => percent / 100

function idFromParam(value: string | null): number | null {
  const parsed = Number(value)
  return value && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** شاشة تقارير الإدارة: إحصائيات كل المدرسين قابلة للتخصيص بمدرس/طالب/صف/مادة */
export function AdminReports() {
  const { t } = useTranslation()
  const fmt = useReportsFormatters()
  const { teachers, students } = useAppData()

  const [params, setParams] = useSearchParams()
  const teacherId = idFromParam(params.get('teacher'))
  const studentId = idFromParam(params.get('student'))

  const [preset, setPreset] = useState<RangePreset>('quarter')
  const [customFrom, setCustomFrom] = useState(DEFAULT_CUSTOM_FROM)
  const [customTo, setCustomTo] = useState(DEFAULT_CUSTOM_TO)
  const [gradeKey, setGradeKey] = useState('')
  const [subject, setSubject] = useState('')
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)

  const range = useMemo(() => resolveRange(preset, customFrom, customTo), [preset, customFrom, customTo])

  const numberFmt = (value: number) => fmt.decimal.format(value)
  const intFmt = (value: number) => fmt.int.format(value)
  const percentFmt = (value: number) => `${fmt.decimal.format(value)}٪`

  const filters = useMemo(
    () => ({
      from: range.from.getTime(),
      to: range.to.getTime(),
      teacherId: teacherId ?? undefined,
      studentId: studentId ?? undefined,
      gradeKey: gradeKey || undefined,
      subject: subject || undefined,
    }),
    [range, teacherId, studentId, gradeKey, subject],
  )

  const { data, loading, error } = useAdminOverview(filters)
  const drill = useTeacherDrill(teacherId, { from: filters.from, to: filters.to })

  /** الفلاتر في الرابط (؟teacher= / ؟student=) حتى تعمل روابط كونسول الإدارة */
  const setScopedFilter = (key: 'teacher' | 'student', value: string) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value) {
          next.set(key, value)
          next.delete(key === 'teacher' ? 'student' : 'teacher')
        } else {
          next.delete(key)
        }
        return next
      },
      { replace: true },
    )
  }

  const clearFilters = () => {
    setScopedFilter('teacher', '')
    setScopedFilter('student', '')
    setGradeKey('')
    setSubject('')
  }

  /** جدول المدرس → طلابه، وجدول الطالب → مدرّسوه، وبلا فلتر شخصي → كل المدرسين */
  const studentsTable = teacherId !== null && studentId === null
  const rows = useMemo<ReportRow[]>(() => {
    if (!data) return []
    if (studentsTable) {
      return data.students.map((row) => ({
        id: `s${row.id}`,
        label: row.name,
        subjectKey: row.grade ? t(`students:grades.${row.grade}`, { defaultValue: row.grade }) : t('students:grades.none'),
        sessions: row.rows.total,
        completedHours: row.rows.completedHours,
        attendanceRate: asRate(row.rows.attendanceRate),
        commitmentRate: asRate(row.rows.commitmentRate),
      }))
    }
    return data.teachers.map((row) => ({
      id: `t${row.id}`,
      label: row.name,
      subjectKey: row.email,
      sessions: row.rows.total,
      completedHours: row.rows.completedHours,
      attendanceRate: asRate(row.rows.attendanceRate),
      commitmentRate: asRate(row.rows.commitmentRate),
    }))
  }, [data, studentsTable, t])

  const sortedRows = useMemo(() => sortRows(rows, sort, fmt.locale), [rows, sort, fmt.locale])

  const totals = {
    sessions: data?.totals.total ?? 0,
    completedHours: data?.totals.completedHours ?? 0,
    attendanceRate: asRate(data?.totals.attendanceRate ?? 0),
    commitmentRate: asRate(data?.totals.commitmentRate ?? 0),
  }

  const tableTitleKey = studentsTable
    ? 'reports:table.teacherStudentsTitle'
    : studentId !== null
      ? 'reports:table.studentTeachersTitle'
      : 'reports:table.allTeachersTitle'

  const nameLabel = studentsTable ? t('reports:table.columns.student') : t('reports:table.columns.teacher')

  const weekly = useMemo(
    () => (data ? data.weekly.map((week) => ({ weekStart: new Date(week.weekStart), hours: week.hours })) : []),
    [data],
  )

  const bySubject = useMemo(() => {
    const record: Record<string, number> = {}
    for (const item of data?.subjects ?? []) record[item.subject] = item.sessions
    return record
  }, [data])

  const gradeEntries = useMemo(
    () => (data ? data.grades.map((grade) => ({ key: t(`students:grades.${grade.grade}`, { defaultValue: grade.grade }), value: grade.sessions })) : []),
    [data, t],
  )

  /** أكثر ساعات اليوم نشاطًا — الخادم يجمع بالساعة بتوقيت UTC، فتُحوَّل لساعة المشاهد */
  const peakEntries = useMemo(() => {
    if (!data) return []
    const utcOffsetHours = Math.round(-new Date().getTimezoneOffset() / 60)
    const byHour = new Map<number, number>()
    for (const item of data.weekdayHours) {
      const localHour = (item.hour + utcOffsetHours + 24) % 24
      byHour.set(localHour, (byHour.get(localHour) ?? 0) + item.sessions)
    }
    return [...byHour.entries()]
      .map(([hour, value]) => ({ key: `${String(hour).padStart(2, '0')}:00`, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [data])

  const rangeLabel = `${fmt.longDate.format(range.from)} — ${fmt.longDate.format(range.to)}`
  const sessionsLabel = t('reports:range.sessionsCount', { value: fmt.count(data?.totals.total ?? 0) })
  const hasFilters = teacherId !== null || studentId !== null || gradeKey !== '' || subject !== ''

  const handleSort = (key: SortKey) => {
    setSort((current) => {
      if (current.key !== key) return { key, dir: key === 'label' ? 'asc' : 'desc' }
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
    })
  }

  const handleExport = () => {
    const header = [
      nameLabel,
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
      String(totals.sessions),
      plainNumber(totals.completedHours),
      String(Math.round(totals.attendanceRate * 100)),
      String(Math.round(totals.commitmentRate * 100)),
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
          <p className={styles.pageSub}>{t('reports:admin.subtitle')}</p>
        </div>
        <span className={styles.scopeBadge}>{t('reports:scope.staff')}</span>
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

      <section className={`${styles.card} ${styles.filtersCard}`} aria-label={t('reports:admin.filtersTitle')}>
        <span className={styles.filtersTitle}>
          <Filter size={15} aria-hidden="true" />
          <span>{t('reports:admin.filtersTitle')}</span>
        </span>

        <label className={styles.filterField}>
          <span className={styles.fieldLabel}>{t('reports:table.columns.teacher')}</span>
          <select
            className={styles.filterSelect}
            value={teacherId ?? ''}
            onChange={(event) => setScopedFilter('teacher', event.target.value)}
          >
            <option value="">{t('reports:admin.allTeachers')}</option>
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.fieldLabel}>{t('reports:table.columns.student')}</span>
          <select
            className={styles.filterSelect}
            value={studentId ?? ''}
            onChange={(event) => setScopedFilter('student', event.target.value)}
          >
            <option value="">{t('reports:admin.allStudents')}</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.fieldLabel}>{t('reports:admin.gradeLabel')}</span>
          <select className={styles.filterSelect} value={gradeKey} onChange={(event) => setGradeKey(event.target.value)}>
            <option value="">{t('reports:admin.allGrades')}</option>
            {GRADES.map((grade) => (
              <option key={grade} value={grade}>
                {t(`students:grades.${grade}`)}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.filterField}>
          <span className={styles.fieldLabel}>{t('reports:admin.subjectLabel')}</span>
          <select className={styles.filterSelect} value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="">{t('reports:admin.allSubjects')}</option>
            {(data?.subjects ?? []).map((item) => (
              <option key={item.subject} value={item.subject}>
                {item.subject}
              </option>
            ))}
          </select>
        </label>

        {hasFilters && (
          <button type="button" className={styles.clearFilters} onClick={clearFilters}>
            <X size={14} aria-hidden="true" />
            <span>{t('reports:admin.clear')}</span>
          </button>
        )}
      </section>

      {error && (
        <p className={styles.notice} role="alert">
          {error}
        </p>
      )}

      {loading && !data && (
        <p className={styles.notice} role="status">
          {t('common:loading')}
        </p>
      )}

      {data && (
        <>
          <MetricsGrid current={data.totals} previous={data.previous} numberFmt={numberFmt} percentFmt={percentFmt} />

          {drill.data && (
            <section className={styles.card}>
              <header className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>{drill.data.teacher.name}</h3>
                <p className={styles.cardSub}>
                  <span dir="ltr">{drill.data.teacher.email}</span>
                  {' · '}
                  {drill.data.teacher.states === 1 ? t('reports:admin.active') : t('reports:admin.suspended')}
                </p>
              </header>

              <div className={styles.toolbarBottom}>
                <span className={styles.rangeLabel}>
                  <CalendarClock size={16} aria-hidden="true" />
                  <span>{t('reports:admin.upcomingTitle')}</span>
                </span>
                <Link className={styles.linkButton} to={ROUTES.schedule}>
                  <span>{t('reports:admin.openSchedule')}</span>
                </Link>
              </div>

              {drill.data.upcoming.length === 0 ? (
                <p className={styles.emptyHint}>{t('reports:admin.noUpcoming')}</p>
              ) : (
                <ul className={styles.upcomingList}>
                  {drill.data.upcoming.slice(0, 6).map((session) => (
                    <li key={session.id} className={styles.upcomingRow}>
                      <span className={styles.upcomingSubject}>{session.subject}</span>
                      <span className={styles.upcomingWhen}>{fmt.shortDate.format(new Date(session.startsAt))}</span>
                      <span className={styles.upcomingStudent}>
                        {t('reports:admin.withStudent', { name: session.student ?? `#${session.id}` })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div className={styles.chartsGrid}>
            <WeeklyHoursChart weekly={weekly} fmt={fmt} />
            <SubjectBars bySubject={bySubject} fmt={fmt} />
            <Bars
              title={t('reports:admin.gradesTitle')}
              entries={gradeEntries}
              fmt={intFmt}
            />
            <Bars
              title={t('reports:admin.peakHoursTitle')}
              entries={peakEntries}
              fmt={intFmt}
            />
            <AlertsPanel alerts={data.alerts} numberFmt={numberFmt} />
          </div>

          <HoursTable
            rows={sortedRows}
            totals={totals}
            sort={sort}
            titleKey={tableTitleKey}
            nameLabel={nameLabel}
            fmt={fmt}
            onSort={handleSort}
          />
        </>
      )}
    </div>
  )
}
