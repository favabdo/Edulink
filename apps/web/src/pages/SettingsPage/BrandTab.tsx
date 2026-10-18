import { Check, Eye, Upload } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Feedback, SettingSection, TextField } from './Fields'
import {
  ACCENT_SWATCHES,
  accentHex,
  isEmail,
  readBrandPrefs,
  writeBrandPrefs,
  type BrandPrefs,
} from './settingsData'
import styles from './SettingsPage.module.css'

/**
 * 4) هوية المؤسسة (white-label) — تظهر للمالك والمدير فقط (canManageStaff).
 * الحفظ في localStorage 'edulink.brand' للعرض التجريبي فقط، ولا يمسّ نظام الثيم.
 */
export function BrandTab() {
  const { t } = useTranslation()

  const [brand, setBrand] = useState<BrandPrefs>(() => readBrandPrefs())
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const hex = accentHex(brand.accent)

  function patch(change: Partial<BrandPrefs>) {
    setBrand((current) => ({ ...current, ...change }))
    setSaved(false)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!brand.institutionName.trim()) {
      setSaved(false)
      setError(t('settings:brand.nameRequired'))
      return
    }
    if (!isEmail(brand.supportEmail)) {
      setSaved(false)
      setError(t('settings:brand.emailInvalid'))
      return
    }

    const clean: BrandPrefs = {
      ...brand,
      institutionName: brand.institutionName.trim(),
      supportEmail: brand.supportEmail.trim(),
    }
    setBrand(clean)
    setError(null)
    writeBrandPrefs(clean)
    setSaved(true)
  }

  return (
    <>
      <SettingSection title={t('settings:brand.title')} description={t('settings:brand.desc')}>
        <form className={styles.form} onSubmit={submit}>
          <TextField
            id="brand-name"
            label={t('settings:brand.institutionName')}
            value={brand.institutionName}
            onChange={(value) => patch({ institutionName: value })}
            placeholder={t('settings:brand.institutionNamePlaceholder')}
            maxLength={60}
          />

          <TextField
            id="brand-email"
            type="email"
            label={t('settings:brand.supportEmail')}
            value={brand.supportEmail}
            onChange={(value) => patch({ supportEmail: value })}
            hint={t('settings:brand.supportEmailHint')}
            maxLength={120}
          />

          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('settings:brand.accent')}</span>
            <div className={styles.swatches} role="radiogroup" aria-label={t('settings:brand.accent')}>
              {ACCENT_SWATCHES.map((swatch) => (
                <label
                  key={swatch.key}
                  className={`${styles.swatch} ${brand.accent === swatch.key ? styles.swatchActive : ''}`}
                  title={swatch.hex}
                >
                  <input
                    className={styles.radioInput}
                    type="radio"
                    name="brand-accent"
                    value={swatch.key}
                    checked={brand.accent === swatch.key}
                    onChange={() => patch({ accent: swatch.key })}
                  />
                  <span className={styles.swatchColor} style={{ backgroundColor: swatch.hex }} aria-hidden="true" />
                  <span className={styles.swatchLabel}>{t(`settings:brand.accents.${swatch.key}`)}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>{t('settings:brand.logo')}</span>
            <div className={styles.uploadRow}>
              <button type="button" className={styles.ghostButton} disabled title={t('settings:brand.logoSoon')}>
                <Upload size={16} aria-hidden="true" />
                <span>{t('settings:brand.logoUpload')}</span>
              </button>
              <span className={styles.uploadHint}>{brand.logoName || t('settings:brand.logoPlaceholder')}</span>
            </div>
          </div>

          {error && <Feedback kind="error">{error}</Feedback>}
          {saved && (
            <Feedback kind="success">
              <Check size={15} aria-hidden="true" />
              <span>{t('settings:brand.saved')}</span>
            </Feedback>
          )}

          <div className={styles.formActions}>
            <button type="submit" className={styles.primaryButton}>
              {t('settings:brand.save')}
            </button>
          </div>
        </form>
      </SettingSection>

      <SettingSection title={t('settings:brand.previewTitle')} description={t('settings:brand.previewDesc')}>
        <div className={styles.previewCard} style={{ borderColor: hex }}>
          <span className={styles.previewMark} style={{ backgroundColor: hex }} aria-hidden="true">
            {brand.institutionName.trim().slice(0, 2) || 'EL'}
          </span>
          <div className={styles.previewText}>
            <span className={styles.previewName}>{brand.institutionName.trim() || t('settings:brand.fallbackName')}</span>
            <span className={styles.previewEmail}>{brand.supportEmail}</span>
            <span className={styles.previewTagline}>{t('settings:brand.tagline')}</span>
          </div>
        </div>
        <p className={styles.note}>
          <Eye size={14} aria-hidden="true" />
          <span>{t('settings:brand.previewNote')}</span>
        </p>
      </SettingSection>
    </>
  )
}
