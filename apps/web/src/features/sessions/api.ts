/**
 * طبقة النداءات الحقيقية للحصص والطلاب — المصدر الحقيقي بدل المولّد التجريبي.
 *
 * الـ backend يُرجّع DTOs (SessionDto/StudentDto في apps/api/Contracts)،
 * وهنا تُحوَّل إلى أنواع الواجهة (ClassSession/Student في lib/data/eduStore.ts)
 * حتى تعمل كل دوال العرض والإحصاء الموجودة بلا تغيير.
 */

import { ApiError, apiFetch } from '../../lib/apiClient'
import type {
  AttendanceMark,
  ClassSession,
  SessionStatus,
  Student,
  SubjectKey,
} from '../../lib/data/eduStore'

export { ApiError }

// ─────────────────────────────── أنواع الردود ───────────────────────────────

/** SessionDto كما يُرجّعها الخادم — الأوقات ISO 8601 بتوقيت UTC */
export type ApiSession = {
  id: number
  code: string
  subject: string
  teacherId: number
  studentId: number
  gradeKey: string
  durationMin: number
  status: string
  attendance: string | null
  roomCode: string | null
  startsAt: string
  endsAt: string | null
  joinedAt: string | null
  makeupOfId: number | null
  metadata: string
  createdAt: string
  teacherName: string | null
  studentName: string | null
}

export type ApiStudent = {
  id: number
  name: string | null
  email: string
  states: number
  access: number
  imgUrl: string | null
  phone: string | null
  createdAt: string
}

export type ApiUser = {
  id: number
  name: string | null
  email: string
  role: number
  roleName: string
  states: number
  access: number
  imgUrl: string | null
  phone: string | null
  createdAt: string
}

export type ApiRelation = { id: number; studentId: number; relation: number; isPrimary: boolean }

export type ApiParent = {
  id: number
  name: string | null
  email: string
  states: number
  access: number
  phone: string | null
  children: ApiRelation[]
}

export type ApiChildBundle = { student: ApiStudent; sessions: ApiSession[] }

export type ApiStats = {
  totalSessions: number
  completed: number
  present: number
  late: number
  noShow: number
  hours: number
  commitmentPercent: number
}

// ─────────────────────────────── النداءات ───────────────────────────────

export function fetchSessions(filters: { status?: string; from?: number; to?: number } = {}): Promise<ApiSession[]> {
  const qs = new URLSearchParams()
  if (filters.status) qs.set('status', filters.status)
  if (filters.from !== undefined) qs.set('from', String(filters.from))
  if (filters.to !== undefined) qs.set('to', String(filters.to))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiFetch<ApiSession[]>(`/api/sessions${suffix}`)
}

export function fetchSession(id: number): Promise<{ session: ApiSession }> {
  return apiFetch<{ session: ApiSession }>(`/api/sessions/${id}`)
}

export function createSession(body: {
  subject: string
  teacherId: number
  studentId: number
  gradeKey: string
  durationMin: number
  startsAt: string
}): Promise<ApiSession> {
  return apiFetch<ApiSession>('/api/sessions', { method: 'POST', body })
}

export function cancelSession(id: number, by: string, reason: string): Promise<ApiSession> {
  return apiFetch<ApiSession>(`/api/sessions/${id}/cancel`, { method: 'POST', body: { by, reason } })
}

export function markAttendance(id: number, studentId: number, mark?: AttendanceMark): Promise<unknown> {
  return apiFetch<unknown>(`/api/sessions/${id}/attendance`, { method: 'POST', body: { studentId, mark } })
}

export function markLeave(id: number, studentId: number): Promise<unknown> {
  return apiFetch<unknown>(`/api/sessions/${id}/attendance/${studentId}/leave`, { method: 'POST' })
}

export function endSession(id: number, by: string, durationMinutes: number): Promise<ApiSession> {
  return apiFetch<ApiSession>(`/api/sessions/${id}/end`, { method: 'POST', body: { by, durationMinutes } })
}

/** تأجيل حصة مجدولة — الخادم يرفض التعارض مع حصة أخرى لنفس المدرس أو الطالب */
export function rescheduleSession(
  id: number,
  startsAt: string,
  durationMin?: number,
): Promise<ApiSession> {
  return apiFetch<ApiSession>(`/api/sessions/${id}/reschedule`, {
    method: 'POST',
    body: { startsAt, durationMin },
  })
}

export function fetchStudents(): Promise<ApiStudent[]> {
  return apiFetch<ApiStudent[]>('/api/students')
}

export function createStudent(body: { name: string; email: string; password: string; phone?: string }): Promise<ApiStudent> {
  return apiFetch<ApiStudent>('/api/students', { method: 'POST', body })
}

export function fetchUsers(): Promise<ApiUser[]> {
  return apiFetch<ApiUser[]>('/api/users')
}

export function fetchParents(): Promise<ApiParent[]> {
  return apiFetch<ApiParent[]>('/api/parents')
}

export function createParent(body: {
  name: string
  email: string
  password: string
  access?: number
  studentId?: number
  relation?: number
  phone?: string
}): Promise<ApiParent> {
  return apiFetch<ApiParent>('/api/parents', { method: 'POST', body })
}

export function linkParentStudent(parentId: number, body: { studentId: number; relation: number; isPrimary: boolean }): Promise<unknown> {
  return apiFetch<unknown>(`/api/parents/${parentId}/link`, { method: 'POST', body })
}

export function unlinkParentStudent(parentId: number, studentId: number): Promise<unknown> {
  return apiFetch<unknown>(`/api/parents/${parentId}/link/${studentId}`, { method: 'DELETE' })
}

/** أبناء ولي الأمر الحالي وحصصهم — نقطة واحدة بدل تسريب قائمة الطلاب */
export function fetchMyChildren(): Promise<ApiChildBundle[]> {
  return apiFetch<ApiChildBundle[]>('/api/parents/children?mine=1')
}

export function fetchStats(params: { teacherId?: number; studentId?: number; weeks?: number } = {}): Promise<ApiStats> {
  const qs = new URLSearchParams()
  if (params.teacherId !== undefined) qs.set('teacherId', String(params.teacherId))
  if (params.studentId !== undefined) qs.set('studentId', String(params.studentId))
  if (params.weeks !== undefined) qs.set('weeks', String(params.weeks))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return apiFetch<ApiStats>(`/api/sessions/stats${suffix}`)
}

// ─────────────────────────────── التحويل للأنواع الواجهية ───────────────────────────────

/**
 * المادة نص حر في القاعدة — تُطابَق **تمامًا** مع أسماء المواد المعروفة لتعطي مفتاح الترجمة.
 * المطابقة الجزئية كانت تعيد كتابة نص المؤسسة: «الفيزياء — القوانين والحركة» كانت
 * تُعرض «الفيزياء» وتُدمج مع كل حصص الفيزياء في التجميعة نفسها.
 */
const SUBJECT_ALIASES: Record<Exclude<SubjectKey, 'other'>, readonly string[]> = {
  math: ['math', 'mathematics', 'رياضيات', 'الرياضيات'],
  english: ['english', 'english language', 'إنجليزي', 'الإنجليزي', 'لغة إنجليزية', 'اللغة الإنجليزية'],
  physics: ['physics', 'فيزياء', 'الفيزياء'],
  chemistry: ['chemistry', 'كيمياء', 'الكيمياء'],
  biology: ['biology', 'أحياء', 'الأحياء'],
}

const normalizeSubject = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

export function toSubjectKey(subject: string): SubjectKey {
  const s = normalizeSubject(subject)
  if (!s) return 'other'
  for (const [key, aliases] of Object.entries(SUBJECT_ALIASES)) {
    if (aliases.includes(s)) return key as Exclude<SubjectKey, 'other'>
  }
  // لا تُخمَّن المواد غير المعروفة — تُعرض باسمها الحرفي (منصة تُباع لمؤسسات بقوائم مواد مختلفة)
  return 'other'
}

const KNOWN_STATUSES: SessionStatus[] = ['completed', 'live', 'scheduled', 'cancelled', 'no_show']

export function toSessionStatus(status: string): SessionStatus {
  return KNOWN_STATUSES.includes(status as SessionStatus) ? (status as SessionStatus) : 'scheduled'
}

export function toAttendanceMark(mark: string | null): AttendanceMark | null {
  return mark === 'present' || mark === 'late' || mark === 'absent' ? mark : null
}

/** سبب الإلغاء محفوظ في metadata كنص مضمون من الخادم */
function readCancelReason(metadata: string | null | undefined): string | null {
  if (!metadata) return null
  try {
    const parsed = JSON.parse(metadata) as { reason?: string }
    return parsed.reason?.trim() || null
  } catch {
    return null
  }
}

export function toClassSession(dto: ApiSession): ClassSession {
  return {
    id: dto.id,
    code: dto.code,
    teacherId: dto.teacherId,
    studentId: dto.studentId,
    subject: toSubjectKey(dto.subject),
    subjectText: dto.subject?.trim() || undefined,
    startsAt: new Date(dto.startsAt),
    durationMin: dto.durationMin,
    status: toSessionStatus(dto.status),
    attendance: toAttendanceMark(dto.attendance),
    makeupOfId: dto.makeupOfId,
    cancelReason: readCancelReason(dto.metadata),
  }
}

export function toStudent(dto: ApiStudent): Student {
  return {
    id: dto.id,
    name: dto.name ?? dto.email.split('@')[0]!,
    email: dto.email,
    phone: dto.phone ?? '',
    grade: '',
    subject: 'other',
    teacherId: 0,
    parentId: 0,
    active: dto.access === 1 && dto.states === 1,
    joinedAt: new Date(dto.createdAt),
  }
}
