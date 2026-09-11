import type { AuthUser, LoginResponse } from '@eduspace/shared-types'
import { apiFetch } from '../../../lib/apiClient'

/** نداءات المصادقة — عقد الـ API الخاص بهذه الوحدة في مكان واحد */

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>('/api/auth/me')
}

export function logout(): Promise<void> {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' })
}
