import { Check, KeyRound, LogOut, ShieldCheck } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/authContext'
import { updateUser } from '../../features/admin/api'
import { ApiError } from '../../features/sessions/api'
import { effectiveRoleFor } from '../../lib/roles'
import { Feedback, SettingSection } from './Fields'
import { STRENGTH_RULES, passedRuleCount } from './settingsData'
import styles from './SettingsPage.module.css'

/**
 * 2) الأمان — تغيير كلمة السر **فعلًا** عبر `PATCH /api/users/{id}`، وخروج هذا الجهاز.
 *
 * الصلاحيات كما يفرضها الخادم: المالك والمدير يعدّلان حسابهما؛ المشرف والمدرس
 * والطالب وولي الأمر تُدار كلمات سرّهم من الإدارة (نفس حارس `/api/users`).
 * لا حقل «كلمة السر الحالية»: الخادم لا يتحقق منها، فعرضه كذبٌ على الشاشة.
 * ولا قائمة أجهزة وهمية: لا نقطة نهاية تُدرِج الجلسات بعد — تُعرض حالة هذا الجهاز فقط.
 */
export function SecurityTab() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const role = effectiveRoleFor(user)
  const mayEditSelf = role === 'owner' || role === 'manager'

  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const strength = useMemo(() => passedRuleCount(next), [next])
  const mismatch = confirm.length > 0 && confirm !== next
  const canSubmit = next.length > 0 && strength === STRENGTH_RULES.length && !mismatch && !busy

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      setSaved(false)
      setError(mismatch ? t('settings:security.mismatch') : t('settings:security.weakPassword'))
      return
    }
    if (user === null) return
    setBusy(true)
    setError(null)
    try {
      await updateUser(user.id, { password: next })
      setSaved(true)
      setNext('')
      setConfirm('')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('settings:security.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingSection title={t('settings:security.passwordTitle')} description={t('settings:security.passwordDesc')}>
        {mayEditSelf ? (
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('settings:security.next')}</span>
              <input
                className={styles.control}
                type="password"
                value={next}
                onChange={(event) => {
                  setNext(event.target.value)
                  setSaved(false)
                  setError(null)
                }}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </label>

            <div className={styles.strengthBar} aria-hidden="true">
              <span className={styles.strengthFill} data-score={strength} />
            </div>

            <ul className={styles.rules}>
              {STRENGTH_RULES.map((rule) => {
                const passed = rule.test(next)
                return (
                  <li key={rule.key} className={`${styles.rule} ${passed ? styles.rulePassed : ''}`}>
                    <Check size={13} aria-hidden="true" />
                    <span>{t(`settings:security.rules.${rule.key}`)}</span>
                  </li>
                )
              })}
            </ul>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('settings:security.confirm')}</span>
              <input
                className={`${styles.control} ${mismatch ? styles.controlInvalid : ''}`}
                type="password"
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value)
                  setSaved(false)
                  setError(null)
                }}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </label>

            {mismatch && <Feedback kind="error">{t('settings:security.mismatch')}</Feedback>}
            {error && !mismatch && <Feedback kind="error">{error}</Feedback>}
            {saved && (
              <Feedback kind="success">
                <KeyRound size={15} aria-hidden="true" />
                <span>{t('settings:security.passwordSaved')}</span>
              </Feedback>
            )}

            <div className={styles.formActions}>
              <button type="submit" className={styles.primaryButton} disabled={!canSubmit}>
                <ShieldCheck size={17} aria-hidden="true" />
                <span>{busy ? t('common:saving') : t('settings:security.passwordSave')}</span>
              </button>
            </div>

            <p className={styles.note}>{t('settings:security.serverNote')}</p>
          </form>
        ) : (
          <p className={styles.note}>{t('settings:security.adminManaged')}</p>
        )}
      </SettingSection>

      <SettingSection title={t('settings:security.sessionTitle')} description={t('settings:security.sessionDesc')}>
        <div className={styles.deviceRow}>
          <div className={styles.deviceText}>
            <span className={styles.deviceName}>
              {t('settings:security.devices.thisDevice')}
              <span className={styles.deviceCurrent}>{t('settings:security.currentDevice')}</span>
            </span>
            <span className={styles.deviceMeta}>{user?.email ?? ''}</span>
          </div>
          <button type="button" className={styles.dangerButton} onClick={() => void signOut()}>
            <LogOut size={15} aria-hidden="true" />
            <span>{t('settings:security.signOutThis')}</span>
          </button>
        </div>
        <p className={styles.note}>{t('settings:security.sessionNoList')}</p>
      </SettingSection>
    </>
  )
}
