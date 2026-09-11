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
export type AuthUser = {
  id: number
  name: string | null
  email: string
  role: UserRole
  /** الاسم العربي للدور كما يرجّعه الخادم */
  roleName: string
  /** 0 = غير ظاهر للناس، 1 = ظاهر */
  states: number
  /** 0 = غير مفعّل (لا يستطيع الدخول)، 1 = مفعّل */
  access: number
  imgUrl: string | null
  createdAt: string
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

// ============================ طلبات المستخدمين ============================
export type CreateUserRequest = {
  name?: string | null
  email: string
  password: string
  role: UserRole
  access?: number
  states?: number
}

// ============================ الأخطاء ============================
/** الشكل الموحّد لرد الخطأ من الـ API */
export type ApiErrorBody = {
  message: string
}
