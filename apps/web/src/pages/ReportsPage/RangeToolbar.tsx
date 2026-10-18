import { useTranslation } from 'react-i18next'
import { CalendarRange, Download } from 'lucide-react'
import type { RangePreset } from './reportsModel'
import styles from './ReportsPage.module.css'

const PRESETS: readonly RangePreset[] = ['week', 'month', 'quarter', 'custom']

type RangeToolbarProps = {
  preset: RangePreset
  customFrom: string
  customTo: string
  rangeLabel: string
  sessionsLabel: string
  onPresetChange: (preset: RangePreset) => void
  onCustomFromChange: (value: string) => void
  onCustomToChange: (value: string) => void
  onExport: () => void
}

/** شريط الفترة: اختصارات + حقلي تاريخ للوضع المخصص + زر التصدير */
export function RangeToolbar({
  preset,
  customFrom,
  customTo,
  rangeLabel,
  sessionsLabel,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
  onExport,
}: RangeToolbarProps) {
  const { t } = useTranslation()

  return (
    <section className={`${styles.card} ${styles.toolbar}`} aria-label={t('reports:range.label')}>
      <div className={styles.toolbarTop}>
        <div className={styles.presetGroup} role="group" aria-label={t('reports:range.presetsLabel')}>
          {PRESETS.map((item) => (
            <button
              key={item}
              type="button"
              className={item === preset ? styles.presetActive : styles.preset}
              aria-pressed={item === preset}
              onClick={() => onPresetChange(item)}
            >
              {t(`reports:range.presets.${item}`)}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className={styles.dateFields}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('reports:range.from')}</span>
              <input
                className={styles.dateInput}
                type="date"
                value={customFrom}
                onChange={(event) => onCustomFromChange(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('reports:range.to')}</span>
              <input
                className={styles.dateInput}
                type="date"
                value={customTo}
                onChange={(event) => onCustomToChange(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div className={styles.toolbarBottom}>
        <span className={styles.rangeLabel}>
          <CalendarRange size={16} aria-hidden="true" />
          <span>{rangeLabel}</span>
        </span>
        <span className={styles.sessionsLabel}>{sessionsLabel}</span>
        <button type="button" className={styles.exportButton} onClick={onExport}>
          <Download size={16} aria-hidden="true" />
          <span>{t('reports:export.button')}</span>
        </button>
      </div>
    </section>
  )
}
