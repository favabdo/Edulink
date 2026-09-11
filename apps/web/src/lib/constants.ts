/** ثوابت عامة للتطبيق — تُقرأ مرة واحدة من متغيّرات البيئة */

/** عنوان الـ API: فارغ يعني مسار نسبي `/api` (يمرّ عبر بروكسي Vite في التطوير) */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/** مفتاح حفظ توكن الدخول في المتصفح */
export const TOKEN_STORAGE_KEY = 'edulink.token'
