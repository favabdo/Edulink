import { Construction } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './ComingSoonPage.module.css'

/** صفحة مؤقتة تُعرض للمسارات التي لم تُبنَ بعد */
export function ComingSoonPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation()

  return (
    <section className={styles.wrap}>
      <span className={styles.icon} aria-hidden="true">
        <Construction size={34} />
      </span>
      <h1 className={styles.title}>{t(titleKey)}</h1>
      <p className={styles.desc}>{t('common:comingSoon.desc')}</p>
    </section>
  )
}
