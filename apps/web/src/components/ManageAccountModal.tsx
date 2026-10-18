import { useEffect, useId, useState } from 'react'
import type { FormEvent, MouseEvent, ReactNode } from 'react'
import { CircleAlert, UserCog, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './ManageAccountModal.module.css'

export type AccountPatch = {
  name: string
  /** فارغة = إبقاء كلمة المرور الحالية */
  password: string
  active: boolean
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  )
}

/**
 * نافذة إدارة الحساب (طالب أو ولي أمر): الاسم، وتصفير كلمة المرور، والتفعيل.
 * تُستدعى عند الحاجة فقط — البيانات تُكتب عبر PATCH في الخادم.
 */
export function ManageAccountModal({
  open,
  accountName,
  accountEmail,
  active,
  onClose,
  onSave,
}: {
  open: boolean
  accountName: string
  accountEmail: string
  active: boolean
  onClose: () => void
  onSave: (patch: AccountPatch) => Promise<void>
}) {
  const { t } = useTranslation()
  const titleId = useId()

  const [name, setName] = useState(accountName)
  const [password, setPassword] = useState('')
  const [isActive, setIsActive] = useState(active)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!open) return null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (name.trim().length < 3) {
      setError(t('common:manage.errName'))
      return
    }
    if (password && password.trim().length < 8) {
      setError(t('common:manage.errPassword'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), password: password.trim(), active: isActive })
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:manage.failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.modalHeader}>
          <h2 className={styles.modalTitle} id={titleId}>
            <UserCog size={20} aria-hidden="true" />
            <span>{t('common:manage.title')}</span>
          </h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('common:manage.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <p className={styles.modalSub}>
          {accountEmail ? <span dir="ltr">{accountEmail}</span> : accountName}
        </p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <Field label={t('common:manage.name')}>
            <input className={styles.input} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
          </Field>

          <Field label={t('common:manage.email')}>
            <input className={styles.input} value={accountEmail} dir="ltr" readOnly />
          </Field>

          <Field label={t('common:manage.password')}>
            <input
              className={styles.input}
              type="password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            <span className={styles.hint}>
              <CircleAlert size={14} aria-hidden="true" />
              <span>{t('common:manage.passwordHint')}</span>
            </span>
          </Field>

          <div className={styles.switchRow}>
            <label className={styles.switch}>
              <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
              <span className={styles.switchTrack} aria-hidden="true" />
            </label>
            <span className={styles.switchText}>
              <span className={styles.label}>{t('common:manage.activeLabel')}</span>
              <span className={styles.hint}>{t('common:manage.activeHint')}</span>
            </span>
          </div>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <footer className={styles.modalFooter}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>
              {t('common:manage.cancel')}
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              {busy ? t('common:saving') : t('common:manage.save')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
