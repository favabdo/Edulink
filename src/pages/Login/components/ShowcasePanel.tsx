import { ShieldCheck, Users, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BrandLogo } from '../../../components/BrandLogo'
import styles from './ShowcasePanel.module.css'

const FEATURES = [
  { key: 'liveClasses', Icon: Video },
  { key: 'expertTeachers', Icon: Users },
  { key: 'secure', Icon: ShieldCheck },
] as const

/**
 * اللوحة اليسرى: صورة الحصة المباشرة + العنوان والمميزات.
 *
 * الصورة خلفية CSS لا <img>: لأن <img> يُنزَّل دائمًا حتى لو كانت اللوحة
 * مخفية (شاشات الجوال)، أما خلفية CSS فلا تُطلب إلا عند عرض اللوحة فعلًا.
 * ويُطلَب تحميلها مسبقًا من index.html على الشاشات الكبيرة لتحسين LCP.
 */
export function ShowcasePanel() {
  const { t } = useTranslation()

  return (
    <aside className={styles.panel}>
      <div className={styles.photo} aria-hidden="true" />
      <div className={styles.scrim} aria-hidden="true" />

      <div className={styles.content}>
        <BrandLogo variant="panel" />

        <div className={styles.copy}>
          <h2 className={styles.heading}>{t('login.showcase.heading')}</h2>
          <p className={styles.subheading}>{t('login.showcase.subheading')}</p>

          <ul className={styles.features}>
            {FEATURES.map(({ key, Icon }) => (
              <li key={key} className={styles.feature}>
                <span className={styles.featureIcon}>
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className={styles.featureText}>{t(`login.showcase.features.${key}`)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.socialProof}>
          <span className={styles.avatars} aria-hidden="true">
            <span className={styles.avatar} />
            <span className={styles.avatar} />
            <span className={styles.avatar} />
            <span className={styles.avatar} />
          </span>
          <p className={styles.socialProofText}>{t('login.showcase.socialProof')}</p>
        </div>
      </div>
    </aside>
  )
}
