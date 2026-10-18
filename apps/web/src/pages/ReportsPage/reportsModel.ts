import {
  getSelfScope,
  parentById,
  sessions,
  statsForSessions,
  studentById,
  subjectGroupKey,
  teacherById,
  teachers,
  type ClassSession,
  type HoursStats,
} from '../../lib/data/eduStore'
import type { EffectiveRole } from '../../lib/roles'

/**
 * منطق صفحة التقارير — كل التجميعات هنا (بدون JSX) حتى تبقى الصفحة للعرض فقط.
 *
 * ⚠️ لا أي بيانات مالية: التقارير ساعاتُ مدرسين + حضورٍ والتزامًا فقط (docs/01-requirements.md).
 * كل الأرقام تُشتق من `seed.ts` عبر `statsForSessions` فتطابق بقية الصفحات.
 */

/** نطاق البيانات الذي تُعرض على أساسه التقارير */
export type ReportScope = 'teacher' | 'staff' | 'student' | 'parent'

export type RangePreset = 'week' | 'month' | 'quarter' | 'custom'

export type DateRange = { from: Date; to: Date }

export type SortKey = 'label' | 'sessions' | 'completedHours' | 'attendanceRate' | 'commitmentRate'

export type SortDir = 'asc' | 'desc'

export type SortState = { key: SortKey; dir: SortDir }

/** صف في جدول الساعات — قد يكون مدرسًا (للمشرف/المدير/الأونر) أو طالبًا (لطالب/ولي أمر) */
export type ReportRow = {
  id: string
  /** الاسم كما هو في البيانات التجريبية (بيانات لا واجهة — لا يُترجم) */
  label: string
  /** مفتاح المادة للعرض — مترجم للمعروف، واسمها الحرفي للباقي */
  subjectKey: string
  sessions: number
  completedHours: number
  attendanceRate: number
  commitmentRate: number
}

const DAY_MS = 86_400_000

export function scopeForRole(role: EffectiveRole): ReportScope {
  switch (role) {
    case 'teacher':
      return 'teacher'
    case 'student':
      return 'student'
    case 'parent':
      return 'parent'
    default:
      return 'staff'
  }
}

// ------------------------------------------------------------------
// تواريخ الفترة
// ------------------------------------------------------------------
function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

/** بداية الأسبوع = السبت (المتعارف عليه محليًا) */
function startOfWeek(date: Date): Date {
  const daysSinceSaturday = (date.getDay() + 1) % 7
  return startOfDay(new Date(date.getTime() - daysSinceSaturday * DAY_MS))
}

function startOfMonth(date: Date): Date {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1))
}

/** `YYYY-MM-DD` بالتوقيت المحلي — صالح مباشرة لـ `<input type="date">` */
export function toInputDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** تحليل تاريخ `YYYY-MM-DD` يدويًا حتى لا يُفسَّر كـ UTC */
export function parseInputDate(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts) return null

  const year = Number(parts[1] ?? '0')
  const month = Number(parts[2] ?? '0')
  const day = Number(parts[3] ?? '0')
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function resolveRange(preset: RangePreset, fromInput: string, toInput: string): DateRange {
  const now = new Date()

  switch (preset) {
    case 'week':
      return { from: startOfWeek(now), to: endOfDay(now) }
    case 'month':
      return { from: startOfMonth(now), to: endOfDay(now) }
    case 'quarter':
      return {
        from: startOfDay(new Date(now.getFullYear(), now.getMonth() - 3, now.getDate())),
        to: endOfDay(now),
      }
    case 'custom': {
      let from = startOfDay(parseInputDate(fromInput) ?? startOfWeek(now))
      let to = startOfDay(parseInputDate(toInput) ?? now)
      if (from > to) {
        const swap = from
        from = to
        to = swap
      }
      return { from, to: endOfDay(to) }
    }
  }
}

export const DEFAULT_CUSTOM_FROM = toInputDate(new Date(Date.now() - 30 * DAY_MS))
export const DEFAULT_CUSTOM_TO = toInputDate(new Date())

// ------------------------------------------------------------------
// الحصص داخل النطاق والصفوف
// ------------------------------------------------------------------
function familyStudentIds(): number[] {
  const { parentId } = getSelfScope()
  if (parentId === null) return []
  return parentById(parentId)?.studentIds ?? []
}

function inScope(session: ClassSession, scope: ReportScope): boolean {
  const self = getSelfScope()
  switch (scope) {
    case 'teacher':
      return self.teacherId !== null && session.teacherId === self.teacherId
    case 'staff':
      return true
    case 'student':
      return self.studentId !== null && session.studentId === self.studentId
    case 'parent':
      return familyStudentIds().includes(session.studentId)
  }
}

const inRange = (session: ClassSession, range: DateRange): boolean =>
  session.startsAt >= range.from && session.startsAt <= range.to

/** كل حصص النطاق المختار داخل الفترة المحددة */
export function sessionsForScope(scope: ReportScope, range: DateRange): ClassSession[] {
  return sessions.filter((s) => inRange(s, range) && inScope(s, scope))
}

function sessionsOfTeacher(teacherId: number, range: DateRange): ClassSession[] {
  return sessions.filter((s) => s.teacherId === teacherId && inRange(s, range))
}

function sessionsOfStudent(studentId: number, range: DateRange): ClassSession[] {
  return sessions.filter((s) => s.studentId === studentId && inRange(s, range))
}

function rowFromStats(
  id: string,
  label: string,
  subjectKey: string,
  list: ClassSession[],
): ReportRow {
  const stats: HoursStats = statsForSessions(list)
  return {
    id,
    label,
    subjectKey,
    sessions: stats.total,
    completedHours: stats.completedHours,
    attendanceRate: stats.attendanceRate,
    commitmentRate: stats.commitmentRate,
  }
}

/** صفوف الجدول: مدرسون للأدوار الإدارية، والنفس/الأبناء لطالب وولي أمر */
export function rowsForScope(scope: ReportScope, range: DateRange): ReportRow[] {
  if (scope === 'staff') {
    const rows = teachers.map((teacher) =>
      rowFromStats(`t${teacher.id}`, teacher.name, subjectGroupKey(teacher.subject, teacher.subjectText), sessionsOfTeacher(teacher.id, range)),
    )
    return rows.filter((row) => row.sessions > 0)
  }

  if (scope === 'teacher') {
    const { teacherId } = getSelfScope()
    const teacher = teacherId === null ? null : teacherById(teacherId)
    if (!teacher) return []
    return [rowFromStats(`t${teacher.id}`, teacher.name, subjectGroupKey(teacher.subject, teacher.subjectText), sessionsOfTeacher(teacher.id, range))]
  }

  const { studentId: selfStudentId } = getSelfScope()
  const studentIds = scope === 'student' ? (selfStudentId === null ? [] : [selfStudentId]) : familyStudentIds()
  const rows: ReportRow[] = []
  for (const studentId of studentIds) {
    const student = studentById(studentId)
    if (!student) continue
    rows.push(
      rowFromStats(`s${student.id}`, student.name, subjectGroupKey(student.subject, student.subjectText), sessionsOfStudent(student.id, range)),
    )
  }
  return rows
}

function compareRows(a: ReportRow, b: ReportRow, key: SortKey, factor: number, locale: string): number {
  if (key === 'label') return a.label.localeCompare(b.label, locale) * factor
  return (a[key] - b[key]) * factor
}

export function sortRows(rows: ReportRow[], sort: SortState, locale: string): ReportRow[] {
  const factor = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => compareRows(a, b, sort.key, factor, locale))
}
