import type { ReactNode } from 'react'
import { ShowcasePanel } from '../features/auth/components/ShowcasePanel'
import styles from './AuthLayout.module.css'

/**
 * هيكل صفحات الدخول (التسجيل/النسيان لاحقًا):
 * لوحة عرض على الجانب + منطقة المحتوى (الكارت) في الوسط.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <ShowcasePanel />
        <section className={styles.formPane}>{children}</section>
      </div>
    </main>
  )
}
