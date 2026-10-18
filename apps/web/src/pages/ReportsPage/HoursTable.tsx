import { useTranslation } from 'react-i18next'
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react'
import type { ReportRow, SortKey, SortState } from './reportsModel'
import type { ReportFormatters } from './useFormatters'
import styles from './ReportsPage.module.css'

export type TableTotals = {
  sessions: number
  completedHours: number
  attendanceRate: number
  commitmentRate: number
}

const NUMERIC_COLUMNS: ReadonlyArray<{ key: SortKey; labelKey: string }> = [
  { key: 'sessions', labelKey: 'reports:table.columns.sessions' },
  { key: 'completedHours', labelKey: 'reports:table.columns.completedHours' },
  { key: 'attendanceRate', labelKey: 'reports:table.columns.attendanceRate' },
  { key: 'commitmentRate', labelKey: 'reports:table.columns.commitmentRate' },
]

function rateTone(rate: number): string {
  if (rate >= 0.9) return styles.rateGood
  if (rate >= 0.75) return styles.rateMid
  return styles.rateLow
}

type HoursTableProps = {
  rows: readonly ReportRow[]
  totals: TableTotals
  sort: SortState
  titleKey: string
  nameLabel: string
  fmt: ReportFormatters
  onSort: (key: SortKey) => void
}

/** جدول الساعات — رأس الأعمود قابل للضغط للترتيب، وصف الإجمالي في الـ tfoot */
export function HoursTable({ rows, totals, sort, titleKey, nameLabel, fmt, onSort }: HoursTableProps) {
  const { t } = useTranslation()
  const percent = (rate: number) => t('reports:format.percent', { value: fmt.percent(rate) })

  const sortIcon = (key: SortKey) => {
    if (sort.key !== key) return <ArrowUpDown size={14} aria-hidden="true" />
    return sort.dir === 'asc' ? (
      <ChevronUp size={14} aria-hidden="true" />
    ) : (
      <ChevronDown size={14} aria-hidden="true" />
    )
  }

  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sort.key !== key) return 'none'
    return sort.dir === 'asc' ? 'ascending' : 'descending'
  }

  return (
    <section className={`${styles.card} ${styles.tableCard}`}>
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t(titleKey)}</h3>
        <p className={styles.cardSub}>{t('reports:table.hint')}</p>
      </header>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>{t('reports:table.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.thName} aria-sort={ariaSort('label')}>
                <button type="button" className={styles.sortButton} onClick={() => onSort('label')}>
                  <span>{nameLabel}</span>
                  {sortIcon('label')}
                </button>
              </th>

              {NUMERIC_COLUMNS.map((column) => (
                <th key={column.key} scope="col" className={styles.thNum} aria-sort={ariaSort(column.key)}>
                  <button type="button" className={styles.sortButton} onClick={() => onSort(column.key)}>
                    <span>{t(column.labelKey)}</span>
                    {sortIcon(column.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={styles.tableRow}>
                <th scope="row" className={styles.nameCell}>
                  <span className={styles.nameText}>{row.label}</span>
                  <span className={styles.nameSub}>{t(`reports:subjects.${row.subjectKey}`, { defaultValue: row.subjectKey })}</span>
                </th>

                <td className={styles.cellNum}>{fmt.count(row.sessions)}</td>
                <td className={styles.cellNum}>{fmt.hours(row.completedHours)}</td>
                <td className={styles.cellNum}>
                  <span className={styles.rateCell}>
                    <span className={styles.rateValue}>{percent(row.attendanceRate)}</span>
                    <span className={styles.rateTrack} aria-hidden="true">
                      <span
                        className={`${styles.rateFill} ${rateTone(row.attendanceRate)}`}
                        style={{ width: `${Math.round(row.attendanceRate * 100)}%` }}
                      />
                    </span>
                  </span>
                </td>
                <td className={styles.cellNum}>
                  <span className={styles.rateCell}>
                    <span className={styles.rateValue}>{percent(row.commitmentRate)}</span>
                    <span className={styles.rateTrack} aria-hidden="true">
                      <span
                        className={`${styles.rateFill} ${rateTone(row.commitmentRate)}`}
                        style={{ width: `${Math.round(row.commitmentRate * 100)}%` }}
                      />
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className={styles.totalsRow}>
              <th scope="row">{t('reports:table.totals')}</th>
              <td className={styles.cellNum}>{fmt.count(totals.sessions)}</td>
              <td className={styles.cellNum}>{fmt.hours(totals.completedHours)}</td>
              <td className={styles.cellNum}>{percent(totals.attendanceRate)}</td>
              <td className={styles.cellNum}>{percent(totals.commitmentRate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}
