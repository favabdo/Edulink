/**
 * مصدر البيانات الحقيقي للواجهة — يجلب الحصص والطلاب والمدرسين وأولياء الأمر
 * من الـ API حسب نوع الحساب (موظف/طالب/ولي أمر)، يبني نماذج العرض المتسقة،
 * ثم يرطّب مخازن `lib/data/eduStore` فيقرأ كل الصفحات البيانات الحقيقية.
 *
 * **لا بيانات وهمية في أي مسار:** المخزن يبدأ فارغًا، وأي فشل شبكة يمسحه ويُظهر
 * رسالة الخطأ بدل أن يترك على الشاشة صفوفًا قديمة أو أسماء نموذجية. القوائم التي
 * لا يصرح بها الخادم لهذا الدور (مثل `/api/users` للمدرس) ترجع فارغة **بشرط أن تكون
 * الاستجابة 401/403** — أي فشل آخر يُعامَل كخطأ.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ClassSession,
  GradeKey,
  Parent,
  Student,
  SubjectKey,
  Teacher,
  AttendanceMark,
} from '../../lib/data/eduStore'
import { clearStore, hydrateFromApi, setSelfScope } from '../../lib/data/eduStore'
import { useAuth } from '../auth/authContext'
import {
  ApiError,
  cancelSession,
  createParent,
  createSession,
  createStudent,
  endSession,
  fetchMyChildren,
  fetchParents,
  fetchSessions,
  fetchStudents,
  fetchUsers,
  linkParentStudent,
  markAttendance,
  markLeave,
  rescheduleSession,
  toClassSession,
  toSubjectKey,
  unlinkParentStudent,
  type ApiParent,
  type ApiSession,
  type ApiStudent,
  type ApiUser,
} from './api'

type AppData = {
  loading: boolean
  error: string | null
  sessions: ClassSession[]
  students: Student[]
  teachers: Teacher[]
  parents: Parent[]
  /** إعادة الجلب من الخادم */
  refresh: () => Promise<void>
  /** إنشاء حصة — يُحدّث الحالة محليًا بنجاح النداء */
  addSession: (input: {
    subject: string
    teacherId: number
    studentId: number
    gradeKey: string
    durationMin: number
    startsAt: Date
  }) => Promise<ClassSession>
  cancelSessionAction: (id: number, reason: string) => Promise<void>
  rescheduleSessionAction: (id: number, startsAt: Date, durationMin?: number) => Promise<void>
  markAttendanceAction: (sessionId: number, studentId: number, mark?: AttendanceMark) => Promise<void>
  markLeaveAction: (sessionId: number, studentId: number) => Promise<void>
  endSessionAction: (sessionId: number, durationMinutes: number) => Promise<void>
  addStudent: (input: { name: string; email: string; password: string }) => Promise<Student>
  addParent: (input: {
    name: string
    email: string
    password: string
    studentId?: number
    relation?: number
  }) => Promise<Parent>
  linkParent: (parentId: number, studentId: number, relation: number, isPrimary: boolean) => Promise<void>
  unlinkParent: (parentId: number, studentId: number) => Promise<void>
}

const AppDataContext = createContext<AppData | null>(null)

// ─────────────── بناء نماذج العرض من ردود الخادم ───────────────

function modeOr<T>(values: T[], fallback: T): T {
  if (values.length === 0) return fallback
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const GRADE_KEYS: GradeKey[] = ['g7', 'g8', 'g9', 'g10', 'g11', 'g12']

/**
 * قائمة لا يصرح بها الخادم لهذا الدور ⇒ فارغة مشروعًا (401/403 فقط).
 * أي فشل آخر يُعاد رميه حتى يُمسح المخزن وتظهر رسالة خطأ — «لم نقرأ شيئًا»
 * يجب ألا تبدو قط كـ «لا توجد بيانات».
 */
async function emptyUnlessAllowed<T>(promise: Promise<T[]>): Promise<T[]> {
  try {
    return await promise
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return []
    throw e
  }
}

function studentFromDto(
  dto: ApiStudent,
  sessions: ApiSession[],
  parentByStudent: Map<number, { id: number; relation: number }>,
): Student {
  const mine = sessions.filter((s) => s.studentId === dto.id)
  const parent = parentByStudent.get(dto.id)
  const rawSubject = modeOr(mine.map((s) => s.subject?.trim() ?? ''), '')
  return {
    id: dto.id,
    name: dto.name ?? dto.email.split('@')[0]!,
    email: dto.email,
    grade: modeOr(mine.map((s) => s.gradeKey as GradeKey).filter((g) => GRADE_KEYS.includes(g)), '') as GradeKey | '',
    subject: modeOr(mine.map((s) => toSubjectKey(s.subject)), 'other'),
    subjectText: rawSubject || undefined,
    teacherId: modeOr(mine.map((s) => s.teacherId), 0),
    parentId: parent?.id ?? 0,
    active: dto.access === 1 && dto.states === 1,
    joinedAt: new Date(dto.createdAt),
  }
}

function teachersFromUsers(users: ApiUser[], sessions: ApiSession[]): Teacher[] {
  return users
    .filter((u) => u.role === 0)
    .map((u) => {
      const theirs = sessions.filter((s) => s.teacherId === u.id)
      return {
        id: u.id,
        name: u.name ?? u.email,
        email: u.email,
        subject: modeOr(theirs.map((s) => toSubjectKey(s.subject)), 'other'),
        subjectText: modeOr(theirs.map((s) => s.subject?.trim() ?? ''), '') || undefined,
        active: u.access === 1 && u.states === 1,
      }
    })
}

/** مدرّسو الحساب الحالي مستنتجون من حصصه — يعمل لمن لا يصرح له /api/users */
function teachersFromSessions(sessions: ApiSession[]): Teacher[] {
  const map = new Map<number, { name: string; subjects: SubjectKey[]; texts: string[] }>()
  for (const s of sessions) {
    const entry = map.get(s.teacherId) ?? { name: s.teacherName ?? '—', subjects: [], texts: [] }
    entry.subjects.push(toSubjectKey(s.subject))
    if (s.subject?.trim()) entry.texts.push(s.subject.trim())
    map.set(s.teacherId, entry)
  }
  return [...map.entries()].map(([id, v]) => ({
    id,
    name: v.name,
    email: '',
    subject: modeOr(v.subjects, 'other'),
    subjectText: modeOr(v.texts, '') || undefined,
    active: true,
  }))
}

function parentsFromDtos(dtos: ApiParent[]): Parent[] {
  return dtos.map((p) => ({
    id: p.id,
    name: p.name ?? p.email,
    email: p.email,
    relation: Math.min(2, p.children.find((c) => c.isPrimary)?.relation ?? 2) as 0 | 1 | 2,
    studentIds: p.children.map((c) => c.studentId),
  }))
}

// ─────────────── المزوّد ───────────────

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const aud = user?.aud ?? 'staff'
  const isStaff = aud === 'staff'

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rawSessions, setRawSessions] = useState<ClassSession[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [parents, setParents] = useState<Parent[]>([])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // الخادم يفرض العزل حسب التوكن — ما نستهلمه هو بالضرورة ملك هذا الحساب
      const sessionDtos = (await fetchSessions()).sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      )

      let studentDtos: ApiStudent[] = []
      let userDtos: ApiUser[] = []
      let parentDtos: ApiParent[] = []

      if (isStaff) {
        ;[studentDtos, userDtos, parentDtos] = await Promise.all([
          emptyUnlessAllowed(fetchStudents()),
          // المدرس العادي لا يُصرّح له — يُفهم المدرسون من حصصه (teachersFromSessions)
          emptyUnlessAllowed(fetchUsers()),
          emptyUnlessAllowed(fetchParents()),
        ])
      } else if (aud === 'parent') {
        const bundles = await emptyUnlessAllowed(fetchMyChildren())
        studentDtos = bundles.map((b) => b.student)
      } else if (user) {
        // الطالب: سجل نفسه من بيانات الدخول — لا قائمة طلاب له
        studentDtos = [
          {
            id: user.id,
            name: user.name,
            email: user.email,
            states: 1,
            access: 1,
            imgUrl: user.imgUrl ?? null,
            createdAt: user.createdAt,
          },
        ]
      }

      const parentByStudent = new Map<number, { id: number; relation: number }>()
      for (const p of parentDtos) {
        const primary = p.children.find((c) => c.isPrimary) ?? p.children[0]
        if (primary && !parentByStudent.has(primary.studentId))
          parentByStudent.set(primary.studentId, { id: p.id, relation: primary.relation })
      }

      const mappedStudents = studentDtos.map((s) => studentFromDto(s, sessionDtos, parentByStudent))
      const mappedTeachers = isStaff
        ? userDtos.some((u) => u.role === 0)
          ? teachersFromUsers(userDtos, sessionDtos)
          : teachersFromSessions(sessionDtos)
        : teachersFromSessions(sessionDtos)
      const mappedParents = parentsFromDtos(parentDtos)
      const mappedSessions = sessionDtos.map(toClassSession)

      hydrateFromApi({
        sessions: mappedSessions,
        students: mappedStudents,
        teachers: mappedTeachers,
        parents: mappedParents,
      })
      // «من أنا» من معرّف الحساب المُصادَق عليه حصرًا — والبقية null صراحةً
      setSelfScope({
        teacherId: isStaff && user?.role === 0 ? user.id : null,
        studentId: aud === 'student' && user ? user.id : null,
        parentId: aud === 'parent' && user ? user.id : null,
      })

      setRawSessions(mappedSessions)
      setStudents(mappedStudents)
      setTeachers(mappedTeachers)
      setParents(mappedParents)
    } catch (e) {
      // فشل الجلب يُمسح المخزن: لا يبقى على الشاشة أي صف لم يُقرأ من القاعدة
      clearStore()
      setRawSessions([])
      setStudents([])
      setTeachers([])
      setParents([])
      setError(e instanceof ApiError ? e.message : 'تعذّر تحميل البيانات من الخادم.')
    } finally {
      setLoading(false)
    }
  }, [aud, isStaff, user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sessions = rawSessions

  const applySession = useCallback((updated: ClassSession) => {
    setRawSessions((prev) => {
      const exists = prev.some((s) => s.id === updated.id)
      const next = exists ? prev.map((s) => (s.id === updated.id ? updated : s)) : [...prev, updated]
      const sorted = next.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      hydrateFromApi({ sessions: sorted })
      return sorted
    })
  }, [])

  const addSession = useCallback<AppData['addSession']>(
    async (input) => {
      const dto = await createSession({ ...input, startsAt: input.startsAt.toISOString() })
      const session = toClassSession(dto)
      applySession(session)
      return session
    },
    [applySession],
  )

  const cancelSessionAction = useCallback<AppData['cancelSessionAction']>(
    async (id, reason) => {
      const dto = await cancelSession(id, user?.name ?? 'staff', reason)
      applySession(toClassSession(dto))
    },
    [applySession, user],
  )

  const rescheduleSessionAction = useCallback<AppData['rescheduleSessionAction']>(
    async (id, startsAt, durationMin) => {
      const dto = await rescheduleSession(id, startsAt.toISOString(), durationMin)
      applySession(toClassSession(dto))
    },
    [applySession],
  )

  const markAttendanceAction = useCallback<AppData['markAttendanceAction']>(
    async (sessionId, studentId, mark) => {
      await markAttendance(sessionId, studentId, mark)
      setRawSessions((prev) => {
        const next = prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                status: s.status === 'scheduled' ? ('live' as const) : s.status,
                attendance: mark ?? s.attendance ?? ('present' as const),
              }
            : s,
        )
        hydrateFromApi({ sessions: next })
        return next
      })
    },
    [],
  )

  const markLeaveAction = useCallback<AppData['markLeaveAction']>(async (sessionId, studentId) => {
    await markLeave(sessionId, studentId)
  }, [])

  const endSessionAction = useCallback<AppData['endSessionAction']>(
    async (sessionId, durationMinutes) => {
      const dto = await endSession(sessionId, user?.name ?? 'teacher', durationMinutes)
      applySession(toClassSession(dto))
    },
    [applySession, user],
  )

  const addStudent = useCallback<AppData['addStudent']>(
    async (input) => {
      const dto = await createStudent(input)
      const student = studentFromDto(dto, [], new Map())
      setStudents((prev) => {
        const next = [...prev, student]
        hydrateFromApi({ students: next })
        return next
      })
      return student
    },
    [],
  )

  const addParent = useCallback<AppData['addParent']>(async (input) => {
    const dto = await createParent(input)
    const parent = parentsFromDtos([dto])[0]!
    setParents((prev) => {
      const next = [...prev.filter((p) => p.id !== parent.id), parent]
      hydrateFromApi({ parents: next })
      return next
    })
    return parent
  }, [])

  const linkParent = useCallback<AppData['linkParent']>(
    async (parentId, studentId, relation, isPrimary) => {
      await linkParentStudent(parentId, { studentId, relation, isPrimary })
      await refresh()
    },
    [refresh],
  )

  const unlinkParent = useCallback<AppData['unlinkParent']>(
    async (parentId, studentId) => {
      await unlinkParentStudent(parentId, studentId)
      setParents((prev) => {
        const next = prev.map((p) =>
          p.id === parentId ? { ...p, studentIds: p.studentIds.filter((s) => s !== studentId) } : p,
        )
        hydrateFromApi({ parents: next })
        return next
      })
    },
    [],
  )

  const value = useMemo<AppData>(
    () => ({
      loading,
      error,
      sessions,
      students,
      teachers,
      parents,
      refresh,
      addSession,
      cancelSessionAction,
      rescheduleSessionAction,
      markAttendanceAction,
      markLeaveAction,
      endSessionAction,
      addStudent,
      addParent,
      linkParent,
      unlinkParent,
    }),
    [
      loading,
      error,
      sessions,
      students,
      teachers,
      parents,
      refresh,
      addSession,
      cancelSessionAction,
      rescheduleSessionAction,
      markAttendanceAction,
      markLeaveAction,
      endSessionAction,
      addStudent,
      addParent,
      linkParent,
      unlinkParent,
    ],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData يجب أن يُستخدم داخل AppDataProvider')
  return ctx
}
