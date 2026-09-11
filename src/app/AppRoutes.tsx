import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../auth/authContext'
import { DashboardLayout } from '../layouts/DashboardLayout'
import { DashboardPage } from '../pages/Dashboard/DashboardPage'
import { LoginPage } from '../pages/Login/LoginPage'
import styles from './AppRoutes.module.css'

function FullPageLoader() {
  return <div className={styles.loader} role="status" aria-live="polite" />
}

/** يحمي الصفحات الداخلية: لا يظهر شيء قبل التأكد من صحة الجلسة. */
function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth()

  if (loading) return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace />
  return children
}

export function AppRoutes() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={loading ? <FullPageLoader /> : user ? <Navigate to="/" replace /> : <LoginPage />}
      />

      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
