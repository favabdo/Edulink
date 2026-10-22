/**
 * أنواع مشتركة بين تطبيقات الواجهة.
 *
 * الهدف: أي تطبيق واجهة (المنصة، لوحة إدارة منفصلة، تطبيق آخر لاحقًا) يستورد
 * نفس شكل البيانات من هنا بدل تكراره — فيبقى تغيير عقد الـ API في مكان واحد.
 *
 * ⚠️ هذه أنواع **الواجهة** فقط (TypeScript). الباك اند مكتوب بـ C# وله كياناته
 * الخاصة في `apps/api`، وأي تغيير في عقد الـ API يجب أن ينعكس هنا أيضًا.
 */

// ============================ الأدوار ============================
/** أدوار موظفي المنصة — الرقم يزيد كلما ارتفع الدور. */
export const USER_ROLES = {
  /** مدرس */
  teacher: 0,
  /** مشرف */
  supervisor: 1,
  /** مدير */
  manager: 2,
  /** أونر */
  owner: 3,
} as const

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES]

// ============================ المستخدم ============================
/** أرقام أدوار الموظفين — و-1 طالب (Edu_Students) و-2 ولي أمر (Edu_Parents) */
export type AuthRoleNumber = UserRole | -1 | -2

export type AuthUser = {
  id: number
  name: string | null
  email: string
  role: AuthRoleNumber
  /** الاسم العربي للدور كما يرجّعه الخادم */
  roleName: string
  /** 0 = غير ظاهر للناس، 1 = ظاهر */
  states: number
  /** 0 = غير مفعّل (لا يستطيع الدخول)، 1 = مفعّل */
  access: number
  imgUrl: string | null
  /** رقم الهاتف المطبَّع من الخادم — اختياري لأن الحسابات القديمة بلا رقم */
  phone?: string | null
  createdAt: string
  /** staff = موظفون (Edu_Users) — student = طالب (Edu_Students) — parent = ولي أمر (Edu_Parents). غيابها يُفسَّر staff */
  aud?: 'staff' | 'student' | 'parent'
}

// ============================ طلبات المصادقة ============================
export type LoginRequest = {
  email: string
  password: string
}

export type LoginResponse = {
  token: string
  user: AuthUser
}

// ============================ الجلسات ============================
export type SessionStatus = 'scheduled' | 'live' | 'completed' | 'cancelled' | 'no_show'

export type Session = {
  id: number
  code: string
  subject: string
  teacherId: number
  studentId: number
  gradeKey: string
  durationMin: number
  status: SessionStatus
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

export type SessionAttendance = {
  id: number
  sessionId: number
  studentId: number
  mark: 'present' | 'late' | 'absent'
  joinedAt: string | null
  leftAt: string | null
  durationMs: number
  note: string | null
}

export type SessionStats = {
  TotalSessions: number
  Present: number
  Cancelled: number
  NoShow: number
  CommitmentPercent: number
}

export type CreateSessionRequest = {
  code?: string
  subject: string
  teacherId: number
  studentId: number
  gradeKey?: string
  durationMin: number
  metadata?: string
  startsAt: string
}

export type UpdateSessionRequest = {
  status: SessionStatus
  roomCode?: string
}

export type MarkAttendanceRequest = {
  studentId: number
  mark?: 'present' | 'late' | 'absent'
}

// ============================ الأخطاء ============================
/** الشكل الموحّد لرد الخطأ من الـ API */
export type ApiErrorBody = {
  message: string
}
