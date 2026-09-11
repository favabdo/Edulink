import { useTranslation } from 'react-i18next'
import logoMark from '../assets/logo-mark.png'
import styles from './BrandLogo.module.css'

type BrandLogoProps = {
  variant?: 'panel' | 'card'
  className?: string
}

/**
 * شعار EduLink الرسمي: العلامة (قبعة التخرج + حرف e) فوق الاسم.
 *
 * الاسم يُرسم كخلفية CSS لا كـ <img> — لأن الصور تُحمَّل دائمًا حتى لو كانت
 * مخفية، فكانت نسخة المظهر الغامق تُنزَّل عبثًا في الوضع الفاتح والعكس.
 * بخلفية CSS لا يُطلب الملف إلا للثيم الفعّال فقط.
 */
export function BrandLogo({ variant = 'card', className }: BrandLogoProps) {
  const { t } = useTranslation()
  const classes = [styles.logo, styles[variant], className].filter(Boolean).join(' ')

  return (
    <div className={classes} role="img" aria-label={t('common.brand')}>
      <img className={styles.mark} src={logoMark} alt="" aria-hidden="true" decoding="async" />
      <span className={styles.wordmark} aria-hidden="true" />
      {variant === 'panel' && <span className={styles.tagline}>{t('common.tagline')}</span>}
    </div>
  )
}
