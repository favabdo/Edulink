import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../../features/auth/authContext'
import { DashboardLayout } from '../../layouts/DashboardLayout'
import { HomePage } from '../../pages/HomePage/HomePage'
import { LoginPage } from '../../pages/LoginPage/LoginPage'
import { MessagesPage } from '../../pages/MessagesPage/MessagesPage'
import { ReportsPage } from '../../pages/ReportsPage/ReportsPage'
import { SchedulePage } from '../../pages/SchedulePage/SchedulePage'
import { SessionsPage } from '../../pages/SessionsPage/SessionsPage'
import { SettingsPage } from '../../pages/SettingsPage/SettingsPage'
import { StudentsPage } from '../../pages/StudentsPage/StudentsPage'
import { ProtectedRoute } from './ProtectedRoute'
import { ROUTES } from './paths'
import styles from './AppRouter.module.css'

/**
 * كل مسارات التطبيق.
 *
 * صفحة داخلية جديدة = مجلد جديد في `pages/<PageName>/` + سطر هنا + المسار في `paths.ts`.
 */
export function AppRouter() {
  const { user, loading } = useAuth()

  return (
    <Routes>
      <Route
        path={ROUTES.login}
        element={
          loading ? (
            <div className={styles.loader} role="status" aria-live="polite" />
          ) : user ? (
            <Navigate to={ROUTES.home} replace />
          ) : (
            <LoginPage />
          )
        }
      />

      {/* كل المسارات داخل هذا الجزء محمية وتُعرض داخل هيكل اللوحة */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path={ROUTES.home} element={<HomePage />} />
        <Route path={ROUTES.schedule} element={<SchedulePage />} />
        <Route path={ROUTES.sessions} element={<SessionsPage />} />
        <Route path={ROUTES.students} element={<StudentsPage />} />
        <Route path={ROUTES.reports} element={<ReportsPage />} />
        <Route path={ROUTES.messages} element={<MessagesPage />} />
        <Route path={ROUTES.settings} element={<SettingsPage />} />
      </Route>

      <Route path="/" element={<Navigate to={ROUTES.home} replace />} />
      <Route path="*" element={<Navigate to={ROUTES.home} replace />} />
    </Routes>
  )
}
