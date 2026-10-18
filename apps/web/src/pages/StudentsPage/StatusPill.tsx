import { useTranslation } from 'react-i18next'
import styles from './StudentsPage.module.css'

/** شريط حالة الطالب: نشط / غير نشط */
export function StatusPill({ active }: { active: boolean }) {
  const { t } = useTranslation()

  return (
    <span className={styles.pillGroup}>
      <span className={`${styles.pill} ${active ? styles.pillActive : styles.pillInactive}`}>
        {t(active ? 'students:status.active' : 'students:status.inactive')}
      </span>
    </span>
  )
}
