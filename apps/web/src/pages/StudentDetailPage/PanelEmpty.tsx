import type { ReactNode } from 'react'
import styles from './StudentDetailPage.module.css'

/** حالة فارغة لأحد أقسام صفحة الطالب */
export function PanelEmpty({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyDesc}>{desc}</p>
    </div>
  )
}
