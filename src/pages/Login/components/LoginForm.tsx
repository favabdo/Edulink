import { useId, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BrandLogo } from '../../../components/BrandLogo'
import { PreferenceToggles } from '../../../components/PreferenceToggles'
import { GoogleIcon } from '../../../components/icons/GoogleIcon'
import { signIn, signInWithGoogle } from '../../../services/auth'
import { validateIdentifier, validatePassword, type ValidationCode } from '../validation'
import styles from './LoginForm.module.css'

const IDENTIFIER_ERROR_KEY: Record<ValidationCode, string> = {
  required: 'login.form.errors.identifierRequired',
  invalid: 'login.form.errors.identifierInvalid',
  tooShort: 'login.form.errors.identifierInvalid',
}

const PASSWORD_ERROR_KEY: Record<ValidationCode, string> = {
  required: 'login.form.errors.passwordRequired',
  tooShort: 'login.form.errors.passwordTooShort',
  invalid: 'login.form.errors.passwordRequired',
}

type FieldErrors = {
  identifier?: string
  password?: string
}

/**
 * كارت تسجيل الدخول.
 * أزرار "نسيت كلمة المرور" و"تواصل مع مؤسستك" بلا وظيفة بعد — تنتظر مساراتها في خطوة قادمة.
 */
export function LoginForm() {
  const { t } = useTranslation()
  const identifierId = useId()
  const passwordId = useId()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function runAuth(action: () => Promise<never>) {
    setFormError(null)
    setSubmitting(true)
    try {
      await action()
    } catch {
      setFormError(t('login.form.errors.notConnected'))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const identifierCode = validateIdentifier(identifier)
    const passwordCode = validatePassword(password)

    const nextErrors: FieldErrors = {}
    if (identifierCode) nextErrors.identifier = t(IDENTIFIER_ERROR_KEY[identifierCode])
    if (passwordCode) nextErrors.password = t(PASSWORD_ERROR_KEY[passwordCode])

    setErrors(nextErrors)
    if (nextErrors.identifier || nextErrors.password) return

    await runAuth(() => signIn({ identifier: identifier.trim(), password, remember }))
  }

  const passwordToggleLabel = passwordVisible
    ? t('login.form.hidePassword')
    : t('login.form.showPassword')

  return (
    <div className={styles.card}>
      <div className={styles.topRow}>
        <PreferenceToggles />
      </div>

      <header className={styles.header}>
        <BrandLogo variant="card" />
        <h1 className={styles.title}>{t('login.form.welcome')}</h1>
        <p className={styles.subtitle}>{t('login.form.subtitle')}</p>
      </header>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {formError && (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={identifierId}>
            {t('login.form.identifierLabel')}
          </label>
          <div className={styles.inputWrap}>
            <Mail className={styles.inputIcon} size={18} aria-hidden="true" />
            <input
              id={identifierId}
              className={styles.input}
              type="text"
              name="identifier"
              autoComplete="username"
              placeholder={t('login.form.identifierPlaceholder')}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              aria-invalid={Boolean(errors.identifier)}
              aria-describedby={errors.identifier ? `${identifierId}-error` : undefined}
            />
          </div>
          {errors.identifier && (
            <p id={`${identifierId}-error`} className={styles.error}>
              {errors.identifier}
            </p>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={passwordId}>
            {t('login.form.passwordLabel')}
          </label>
          <div className={styles.inputWrap}>
            <Lock className={styles.inputIcon} size={18} aria-hidden="true" />
            <input
              id={passwordId}
              className={`${styles.input} ${styles.inputWithAction}`}
              type={passwordVisible ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              placeholder={t('login.form.passwordPlaceholder')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? `${passwordId}-error` : undefined}
            />
            <button
              type="button"
              className={styles.inputAction}
              onClick={() => setPasswordVisible((visible) => !visible)}
              aria-label={passwordToggleLabel}
              title={passwordToggleLabel}
            >
              {passwordVisible ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.password && (
            <p id={`${passwordId}-error`} className={styles.error}>
              {errors.password}
            </p>
          )}
        </div>

        <div className={styles.optionsRow}>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>{t('login.form.rememberMe')}</span>
          </label>
          <button type="button" className={styles.link}>
            {t('login.form.forgotPassword')}
          </button>
        </div>

        <button className={styles.submit} type="submit" disabled={submitting}>
          <span>{submitting ? t('login.form.submitting') : t('login.form.submit')}</span>
          <ArrowRight className={styles.submitArrow} size={20} aria-hidden="true" />
        </button>
      </form>

      <p className={styles.divider}>{t('login.form.orContinueWith')}</p>

      <button
        type="button"
        className={styles.google}
        onClick={() => void runAuth(signInWithGoogle)}
        disabled={submitting}
      >
        <GoogleIcon size={20} />
        <span>{t('login.form.continueWithGoogle')}</span>
      </button>

      <p className={styles.footer}>
        {t('login.form.noAccount')}{' '}
        <button type="button" className={styles.link}>
          {t('login.form.contactInstitution')}
        </button>
      </p>

      <p className={styles.copyright}>{t('login.form.copyright')}</p>
    </div>
  )
}
