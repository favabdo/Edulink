/**
 * مخزن بيانات العرض الموحّد — **لا يحتوي أي بيانات**.
 *
 * المصفوفات هنا تُملأ حصريًا من الـ API (`hydrateFromApi`) الذي يقرأ من SQL Server،
 * وتحالت عند أي فشل شبكة (`clearStore`) فلا يمكن أن يظهر صف أو اسم أو رقم لم يُكتب
 * في القاعدة. المصدر الوحيد للجداول هو `database/schema.sql`.
 *
 * الأنواع والدوال النقية (تجميع/إحصاء) تبقى هنا لأن كل الصفحات تعتمد عليها في عرض
 * ردود الخادم بأشكال متسقة: ساعات مدرس في التقارير = حصته في الجدول = سجل حضور الطالب.
 */

import { useSyncExternalStore } from 'react'

export type SubjectKey = 'math' | 'english' | 'physics' | 'chemistry' | 'biology' | 'other'
export type SessionStatus = 'completed' | 'live' | 'scheduled' | 'cancelled' | 'no_show'
export type AttendanceMark = 'present' | 'late' | 'absent'
/** الصف الدراسي كمفتاح ترجمة — كل namespace صفحة يترجمه */
export type GradeKey = 'g7' | 'g8' | 'g9' | 'g10' | 'g11' | 'g12'

export type Teacher = {
  id: number
  name: string
  email: string
  subject: SubjectKey
  subjectText?: string
  active: boolean
}

export type Student = {
  id: number
  name: string
  email: string
  /** الصف مشتق من حصص الطالب — '' معناه لم تُجدوَل له حصة بعد */
  grade: GradeKey | ''
  subject: SubjectKey
  subjectText?: string
  teacherId: number
  parentId: number
  active: boolean
  joinedAt: Date
}

export type Parent = {
  id: number
  name: string
  email: string
  studentIds: number[]
  /** 0 أب · 1 أم · 2 وصي — مفتاح ترجمة في صفحة أولياء الأمر */
  relation: 0 | 1 | 2
}

export type ClassSession = {
  id: number
  code: string
  teacherId: number
  studentId: number
  subject: SubjectKey
  /** اسم المادة كما كتبه المستخدم — يُعرض حرفًا حين لا تنتمي لإحدى المواد المعروفة */
  subjectText?: string
  startsAt: Date
  durationMin: number
  status: SessionStatus
  attendance: AttendanceMark | null
  /** حصة تعويضية عن حصة ملغاة */
  makeupOfId: number | null
  /** سبب الإلغاء كما أدخلته الإدارة */
  cancelReason?: string | null
}

const DAY_MS = 86_400_000

/**
 * مفاتيح الصفوف المعروفة — قائمة ترجمة لا بيانات مؤسسة: institution حقيقية قد
 * تستخدم صفوفًا أخرى فيُعرض المفتاح كما هو بلا فرض أسماء على الشاشة.
 */
export const GRADES: GradeKey[] = ['g7', 'g8', 'g9', 'g10', 'g11', 'g12']

/**
 * اسم المادة للعرض: المواد المعروفات مترجمات، وما عداها يُعرض باسمه الحرفي
 * كما أدخلته المؤسسة — المنصة white-label ولا يجوز فرض قائمة مواد واحدة عليها.
 */
export function subjectDisplayName(
  item: { subject: SubjectKey; subjectText?: string },
  t: (key: string, options?: Record<string, unknown>) => string,
  namespace: string,
): string {
  if (item.subject !== 'other') return t(`${namespace}.${item.subject}`)
  const raw = item.subjectText?.trim()
  return raw ? raw : t(`${namespace}.other`)
}

/** مفتاح التجميع في الرسوم — المواد خارج القائمة بأسمائها الحرفية */
export function subjectGroupKey(subject: SubjectKey, subjectText?: string): string {
  return subject === 'other' ? subjectText?.trim() || 'other' : subject
}

// ------------------------------------------------------------------
// المخزن — يبدأ فارغًا دائمًا
// ------------------------------------------------------------------
export const sessions: ClassSession[] = []
export const students: Student[] = []
export const teachers: Teacher[] = []
export const parents: Parent[] = []

let storeVersion = 0
const storeListeners = new Set<() => void>()

export function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

export function getStoreVersion(): number {
  return storeVersion
}

/**
 * لقطة المخزن: نسخ بهويات جديدة عند كل تحديث حتى تسقط `useMemo` في الصفحات،
 * وتشترك الصفحة فيها عبر `useStoreSnapshot()` فتُعاد رسوماتها ببيانات الخادم.
 */
export type StoreSnapshot = {
  version: number
  sessions: ClassSession[]
  students: Student[]
  teachers: Teacher[]
  parents: Parent[]
}

let snapshot: StoreSnapshot = {
  version: 0,
  sessions: [...sessions],
  students: [...students],
  teachers: [...teachers],
  parents: [...parents],
}

export function getStoreSnapshot(): StoreSnapshot {
  return snapshot
}

export function useStoreSnapshot(): StoreSnapshot {
  return useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreSnapshot)
}

function notifyStore() {
  storeVersion += 1
  snapshot = {
    version: storeVersion,
    sessions: [...sessions],
    students: [...students],
    teachers: [...teachers],
    parents: [...parents],
  }
  storeListeners.forEach((listener) => listener())
}

/**
 * يستبدل محتويات المخزن ببيانات الخادم في نفس المصفوفات (splice) لأن اسم
 * المصفوفة مستورد مباشرة في صفحات كثيرة؛ تُستدعى بحقول كاملة من `DataProvider`.
 * الحقل غير المرسَل **يُمسح** لا يحتفظ ببياته — لا يُترك على الشاشة ما لم يُقرأ من القاعدة.
 */
export function hydrateFromApi(next: {
  sessions?: ClassSession[]
  students?: Student[]
  teachers?: Teacher[]
  parents?: Parent[]
}) {
  sessions.splice(0, sessions.length, ...(next.sessions ?? []))
  students.splice(0, students.length, ...(next.students ?? []))
  teachers.splice(0, teachers.length, ...(next.teachers ?? []))
  parents.splice(0, parents.length, ...(next.parents ?? []))
  notifyStore()
}

/** يُمسح المخزن كله — يُستدعى عند فشل الجلب فلا تبقى صفوف قديمة على الشاشة */
export function clearStore() {
  hydrateFromApi({})
  setSelfScope({ teacherId: null, studentId: null, parentId: null })
}

// ------------------------------------------------------------------
// «من أنا» — يُضبط فقط من معرّف الحساب المُصادَق عليه من الخادم
// ------------------------------------------------------------------
export type SelfScope = { teacherId: number | null; studentId: number | null; parentId: number | null }

let selfScope: SelfScope = { teacherId: null, studentId: null, parentId: null }

export function setSelfScope(ids: Partial<SelfScope>) {
  selfScope = { ...selfScope, ...ids }
}

export function getSelfScope(): SelfScope {
  return selfScope
}

// ------------------------------------------------------------------
// اشتقاقات
// ------------------------------------------------------------------
export const teacherById = (id: number) => teachers.find((t) => t.id === id) ?? null
export const studentById = (id: number) => students.find((s) => s.id === id) ?? null
export const parentById = (id: number) => parents.find((p) => p.id === id) ?? null
export const sessionById = (id: number) => sessions.find((s) => s.id === id) ?? null

export const sessionsForTeacher = (teacherId: number) => sessions.filter((s) => s.teacherId === teacherId)
export const sessionsForStudent = (studentId: number) => sessions.filter((s) => s.studentId === studentId)
export const sessionsForParent = (parentId: number) => {
  const parent = parentById(parentId)
  const ids = new Set(parent?.studentIds ?? [])
  return sessions.filter((s) => ids.has(s.studentId))
}

const isPast = (s: ClassSession) => s.status === 'completed' || s.status === 'cancelled' || s.status === 'no_show'
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function sessionsOn(list: ClassSession[], day: Date): ClassSession[] {
  return list.filter((s) => sameDay(s.startsAt, day))
}

export function upcoming(list: ClassSession[], from: Date = new Date()): ClassSession[] {
  return list.filter((s) => !isPast(s) && s.startsAt.getTime() >= from.getTime() - 60 * 60_000)
}

export type HoursStats = {
  total: number
  completed: number
  cancelled: number
  noShow: number
  scheduled: number
  completedHours: number
  attendanceRate: number
  commitmentRate: number
  /** آخر 8 أسابيع: عدد الساعات المكتملة لكل أسبوع */
  weekly: Array<{ weekStart: Date; hours: number }>
  bySubject: Record<string, number>
}

export function statsForSessions(list: ClassSession[]): HoursStats {
  const completed = list.filter((s) => s.status === 'completed')
  const cancelled = list.filter((s) => s.status === 'cancelled')
  const noShow = list.filter((s) => s.status === 'no_show')
  const scheduled = list.filter((s) => s.status === 'scheduled' || s.status === 'live')
  const attended = completed.filter((s) => s.attendance !== 'absent').length

  const weekly: Array<{ weekStart: Date; hours: number }> = []
  const now = new Date()
  for (let w = 7; w >= 0; w--) {
    const weekStart = new Date(now.getTime() - (w * 7 + now.getDay()) * DAY_MS)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS)
    const hours =
      completed
        .filter((s) => s.startsAt >= weekStart && s.startsAt < weekEnd)
        .reduce((acc, s) => acc + s.durationMin, 0) / 60
    weekly.push({ weekStart, hours })
  }

  const bySubject: Record<string, number> = {}
  for (const session of completed) {
    // المواد خارج القائمة المعروفة تُحسب باسمها الحرفي لا تُدمج في «رياضيات»
    const key = subjectGroupKey(session.subject, session.subjectText)
    bySubject[key] = (bySubject[key] ?? 0) + 1
  }

  return {
    total: list.length,
    completed: completed.length,
    cancelled: cancelled.length,
    noShow: noShow.length,
    scheduled: scheduled.length,
    completedHours: completed.reduce((acc, s) => acc + s.durationMin, 0) / 60,
    attendanceRate: completed.length ? attended / completed.length : 0,
    commitmentRate: list.length ? 1 - (cancelled.length + noShow.length) / list.length : 0,
    weekly,
    bySubject,
  }
}

export const teacherStats = (teacherId: number) => statsForSessions(sessionsForTeacher(teacherId))
export const studentStats = (studentId: number) => statsForSessions(sessionsForStudent(studentId))
export const institutionStats = () => statsForSessions(sessions)

export function nextSessionFor(list: ClassSession[], from: Date = new Date()): ClassSession | null {
  return upcoming(list, from)[0] ?? null
}

/**
 * خيارات المواد للفلترات — مشتقة من حصص الخادم الفعلية لا من قائمة ثابتة:
 * مادة المؤسسة الحرفية تظهر باسمها، ولا تُفرض مواد على شاشة عميل white-label.
 */
export function subjectOptionsFrom(
  list: Array<{ subject: SubjectKey; subjectText?: string }>,
): Array<{ key: string; subject: SubjectKey; subjectText?: string }> {
  const seen = new Map<string, { key: string; subject: SubjectKey; subjectText?: string }>()
  for (const item of list) {
    const key = subjectGroupKey(item.subject, item.subjectText)
    if (!seen.has(key)) seen.set(key, { key, subject: item.subject, subjectText: item.subjectText })
  }
  return [...seen.values()]
}
