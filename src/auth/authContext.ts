import { createContext, useContext } from 'react'
import type { AuthUser } from '../api/authApi'

export type AuthContextValue = {
  user: AuthUser | null
  /** true أثناء التحقق من التوكن عند فتح التطبيق */
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthUser>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an AuthProvider')
  return context
}
