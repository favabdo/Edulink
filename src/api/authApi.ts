import { apiFetch } from './client'

export type UserRole = 0 | 1 | 2 | 3

export type AuthUser = {
  id: number
  name: string | null
  email: string
  role: UserRole
  roleName: string
  states: number
  access: number
  imgUrl: string | null
  createdAt: string
}

type LoginResponse = {
  token: string
  user: AuthUser
}

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
