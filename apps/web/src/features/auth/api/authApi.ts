import type { AuthUser, LoginResponse } from '@eduspace/shared-types'
import { ApiError, apiFetch } from '../../../lib/apiClient'

/** نداءات المصادقة — عقد الـ API الخاص بهذه الوحدة في مكان واحد */

/** نموذج دخول واحد للجميع: موظف ← طالب ← ولي أمر (كلٌّ في جدول حسابه) */
export async function login(email: string, password: string): Promise<LoginResponse> {
  try {
    return await apiFetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e
    try {
      return await apiFetch<LoginResponse>('/api/auth/students/login', {
        method: 'POST',
        body: { email, password },
      })
    } catch (e2) {
      if (!(e2 instanceof ApiError) || e2.status !== 401) throw e2
      return apiFetch<LoginResponse>('/api/auth/parents/login', {
        method: 'POST',
        body: { email, password },
      })
    }
  }
}

export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/me')
}

export function logout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' })
}
