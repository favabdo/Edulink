/**
 * طبقة بيانات كونسول الإدارة — إحصائيات شاملة قابلة للتخصيص + تعديل الحسابات.
 *كل النداءات هنا للموظفين (مشرف فأعلى) فقط، والخادم يرفض غيره.
 */

import { apiFetch } from '../../lib/apiClient'

// ─────────────── أنواع الردود ───────────────

export type Metrics = {
  total: number
  completed: number
  cancelled: number
  noShow: number
  upcoming: number
  completedHours: number
  scheduledHours: number
  attendanceRate: number
  lateRate: number
  commitmentRate: number
  onTimeStartRate: number
  uniqueStudents: number
}

export type PersonRow = { id: number; name: string; rows: Metrics }
export type StudentRow = PersonRow & { grade: string }
export type TeacherRow = PersonRow & { email: string }

export type OverviewFilters = {
  from?: number
  to?: number
  teacherId?: number
  studentId?: number
  gradeKey?: string
  subject?: string
}

export type Overview = {
  range: { from: string; to: string }
  filters: Record<string, unknown>
  totals: Metrics
  previous: Metrics
  teachers: TeacherRow[]
  students: StudentRow[]
  subjects: Array<{ subject: string; sessions: number; hours: number }>
  grades: Array<{ grade: string; sessions: number; hours: number }>
  weekly: Array<{ weekStart: string; sessions: number; hours: number }>
  weekdayHours: Array<{ day: string; hour: number; sessions: number }>
  alerts: {
    idleTeachers: Array<{ id: number; name: string; lastSession: string }>
    studentsWithoutUpcoming: Array<{ id: number; name: string }>
    lowAttendanceTeachers: Array<{ id: number; name: string; rate: number; sessions: number }>
    heavyCancellers: Array<{ id: number; name: string; cancelled: number; total: number }>
    sessionsTodayUnmarked: number
    avgLatencyMinutes: number
  }
}

export type TeacherDetail = {
  teacher: { id: number; name: string; email: string; states: number; access: number }
  totals: Metrics
  weekly: Overview['weekly']
  subjects: Overview['subjects']
  students: Array<{ id: number; name: string; rows: Metrics }>
  upcoming: Array<{ id: number; code: string; subject: string; startsAt: string; durationMin: number; student: string | null }>
}

// ─────────────── النداءات ───────────────

function queryOf(filters: OverviewFilters): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function fetchOverview(filters: OverviewFilters = {}): Promise<Overview> {
  return apiFetch<Overview>(`/api/reports/overview${queryOf(filters)}`)
}

export function fetchTeacherDetail(id: number, filters: { from?: number; to?: number } = {}): Promise<TeacherDetail> {
  return apiFetch<TeacherDetail>(`/api/reports/teachers/${id}${queryOf(filters)}`)
}

// ─────────────── إدارة الحسابات ───────────────

/** حساب موظف كما يرجع من /api/users — role: 0 مدرس · 1 مشرف · 2 مدير · 3 أونر */
export type StaffAccount = {
  id: number
  name: string | null
  email: string
  role: number
  states: number
  access: number
  /** رقم مطبَّع من الخادم (PhoneNormalizer) أو null إن لم يُسجَّل بعد */
  phone: string | null
}

export function fetchStaff(): Promise<StaffAccount[]> {
  return apiFetch<StaffAccount[]>('/api/users')
}

export type AccountPatch = {
  name?: string
  role?: number
  states?: number
  access?: number
  password?: string
  phone?: string
}

export function updateUser(id: number, patch: AccountPatch): Promise<unknown> {
  return apiFetch<unknown>(`/api/users/${id}`, { method: 'PATCH', body: patch })
}

export function createStaffUser(body: {
  name: string
  email: string
  password: string
  role: number
  phone?: string
}): Promise<unknown> {
  return apiFetch<unknown>('/api/users', { method: 'POST', body })
}

export function updateStudent(id: number, patch: AccountPatch): Promise<unknown> {
  return apiFetch<unknown>(`/api/students/${id}`, { method: 'PATCH', body: patch })
}

export function updateParent(id: number, patch: AccountPatch): Promise<unknown> {
  return apiFetch<unknown>(`/api/parents/${id}`, { method: 'PATCH', body: patch })
}
