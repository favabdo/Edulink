import { AuthLayout } from '../../layouts/AuthLayout'
import { LoginForm } from '../../features/auth/components/LoginForm'

/** صفحة تسجيل الدخول — المسار: /login */
export function LoginPage() {
  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  )
}
