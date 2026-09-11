import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/authContext'
import { ROUTES } from './paths'
import styles from './AppRouter.module.css'

/**
 * يحمي الصفحات الداخلية: لا يُعرض أي محتوى قبل التأكد من صحة الجلسة،
 * وغير المسجَّل يُحوَّل إلى صفحة الدخول.
 */
export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth()

  if (loading) return <div className={styles.loader} role="status" aria-live="polite" />
  if (!user) return <Navigate to={ROUTES.login} replace />
  return children
}
