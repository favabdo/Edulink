import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthUser } from '@eduspace/shared-types'
import { clearToken, readToken, saveToken } from '../../lib/apiClient'
import { fetchMe, login as loginRequest, logout as logoutRequest } from './api/authApi'
import { AuthContext } from './authContext'

/**
 * يحفظ جلسة المستخدم: التوكن في localStorage، وبيانات المستخدم في الحالة.
 * عند فتح التطبيق يتحقق من التوكن عبر /api/auth/me — فإن كان منتهيًا أو ملغيًا
 * يُمسح ويُعاد المستخدم لصفحة الدخول.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!readToken()) {
        setLoading(false)
        return
      }
      try {
        const me = await fetchMe()
        if (!cancelled) setUser(me)
      } catch {
        clearToken()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password)
    saveToken(result.token)
    setUser(result.user)
    return result.user
  }, [])

  const signOut = useCallback(async () => {
    try {
      await logoutRequest()
    } catch {
      // حتى لو فشل نداء الخروج على الخادم، نُنهي الجلسة محليًا
    }
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
