import { Languages, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../i18n/useLanguage'
import { useTheme } from '../theme/themeContext'
import styles from './PreferenceToggles.module.css'

/** أزرار تبديل اللغة والمظهر — ثابتة في ركن الصفحة ولا تتأثر بتصميم الكارت. */
export function PreferenceToggles() {
  const { t } = useTranslation()
  const { language, toggleLanguage } = useLanguage()
  const { theme, toggleTheme } = useTheme()

  const languageLabel = language === 'ar' ? t('common.switchToEnglish') : t('common.switchToArabic')
  const themeLabel = theme === 'dark' ? t('common.theme.switchToLight') : t('common.theme.switchToDark')

  return (
    <div className={styles.bar}>
      <button
        type="button"
        className={styles.button}
        onClick={toggleLanguage}
        aria-label={languageLabel}
        title={languageLabel}
      >
        <Languages size={18} aria-hidden="true" />
        <span className={styles.label}>{languageLabel}</span>
      </button>

      <button
        type="button"
        className={`${styles.button} ${styles.iconOnly}`}
        onClick={toggleTheme}
        aria-label={themeLabel}
        title={themeLabel}
      >
        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>
    </div>
  )
}
