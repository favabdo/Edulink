import { parentById, studentStats, subjectGroupKey, teacherById, type Student } from '../../lib/data/eduStore'

/** صف واحد جاهز للعرض: بيانات الطالب + اسم مدرسه/ولي أمره + إحصاؤه من حصص الخادم */
export type StudentRow = {
  student: Student
  teacherName: string
  parentName: string
  /** الساعات المكتملة (من studentStats) */
  completedHours: number
  /** نسبة الحضور 0..1 */
  attendanceRate: number
}

export function buildRow(student: Student): StudentRow {
  const stats = studentStats(student.id)
  return {
    student,
    teacherName: teacherById(student.teacherId)?.name ?? '',
    parentName: parentById(student.parentId)?.name ?? '',
    completedHours: stats.completedHours,
    attendanceRate: stats.attendanceRate,
  }
}

export type StatusFilter = 'all' | 'active' | 'inactive'
export type SortKey = 'newest' | 'name' | 'hours'
export type ViewMode = 'table' | 'cards'

export type Filters = {
  query: string
  teacherId: 'all' | number
  /** مفتاح مجموعة المادة (subjectGroupKey) — يشمل الأسماء الحرفية التي تدخلها المؤسسة */
  subject: 'all' | string
  status: StatusFilter
  sort: SortKey
}

export const DEFAULT_FILTERS: Filters = {
  query: '',
  teacherId: 'all',
  subject: 'all',
  status: 'all',
  sort: 'newest',
}

/** التصفية والترتيب محليًا بالكامل — لا نداءات شبكة */
export function applyFilters(rows: StudentRow[], filters: Filters, collator: Intl.Collator): StudentRow[] {
  const query = filters.query.trim().toLowerCase()

  const filtered = rows.filter(({ student }) => {
    if (query && !student.name.toLowerCase().includes(query)) return false
    if (filters.teacherId !== 'all' && student.teacherId !== filters.teacherId) return false
    if (filters.subject !== 'all' && subjectGroupKey(student.subject, student.subjectText) !== filters.subject) return false
    if (filters.status === 'active' && !student.active) return false
    if (filters.status === 'inactive' && student.active) return false
    return true
  })

  return [...filtered].sort((a, b) => {
    if (filters.sort === 'name') return collator.compare(a.student.name, b.student.name)
    if (filters.sort === 'hours') return b.completedHours - a.completedHours
    return b.student.joinedAt.getTime() - a.student.joinedAt.getTime()
  })
}

export function filtersAreActive(filters: Filters): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.teacherId !== 'all' ||
    filters.subject !== 'all' ||
    filters.status !== 'all' ||
    filters.sort !== DEFAULT_FILTERS.sort
  )
}
