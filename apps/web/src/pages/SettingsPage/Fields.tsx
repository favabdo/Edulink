import type { ChangeEvent, ReactNode } from 'react'
import styles from './SettingsPage.module.css'

/** عنوان قسم داخل لوحة الإعدادات */
export function SettingSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {description && <p className={styles.sectionDesc}>{description}</p>}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

export function TextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  disabled = false,
  maxLength,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'password'
  placeholder?: string
  hint?: string
  disabled?: boolean
  maxLength?: number
}) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value)
  }

  return (
    <label className={styles.field} htmlFor={id}>
      <span className={styles.fieldLabel}>{label}</span>
      <input
        id={id}
        className={styles.control}
        type={type}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
      />
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  )
}

export type Option = {
  readonly value: string
  readonly label: string
  readonly icon?: ReactNode
  readonly disabled?: boolean
}

/** مجموعة خيارات على شكل أزرار بيضاوية (لغة / مظهر / أدوار) */
export function OptionGroup({
  name,
  label,
  value,
  options,
  onChange,
}: {
  name: string
  label: string
  value: string
  options: readonly Option[]
  onChange: (value: string) => void
}) {
  return (
    <div className={styles.optionGrid} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <label
            key={option.value}
            className={`${styles.optionCard} ${isActive ? styles.optionCardActive : ''} ${option.disabled ? styles.optionCardDisabled : ''}`}
          >
            <input
              className={styles.radioInput}
              type="radio"
              name={name}
              value={option.value}
              checked={isActive}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            {option.icon}
            <span className={styles.optionLabel}>{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}

/** رسالة نجاح/خطأ داخل اللوحة (لا نوافذ منبثقة) */
export function Feedback({ kind, children }: { kind: 'success' | 'error'; children: ReactNode }) {
  return (
    <p className={`${styles.feedback} ${kind === 'success' ? styles.feedbackSuccess : styles.feedbackError}`} role="status">
      {children}
    </p>
  )
}

/** مفتاح تفعيل/إيقاف (switch) */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <div className={styles.toggleRow}>
      <div className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {hint && <span className={styles.toggleHint}>{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`${styles.switch} ${checked ? styles.switchOn : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.switchThumb} aria-hidden="true" />
      </button>
    </div>
  )
}
