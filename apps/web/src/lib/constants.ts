/** ثوابت عامة للتطبيق — تُقرأ مرة واحدة من متغيّرات البيئة */

/** عنوان الـ API: فارغ يعني مسار نسبي `/api` (يمرّ عبر بروكسي Vite في التطوير) */
export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

/**
 * أصل الـ Hub (SignalR): يتبع نفس أصل الـ API مع `ws`/`wss` بدل `http`/`https`.
 * قيمته فارغة (مثل `API_BASE_URL`) تعني المسار النسبي — بروكسي Vite في التطوير
 * أو nginx بنفس الأصل في الإنتاج. بدون هذا يرتبط اتصال الغرفة بالواجهة نفسها
 * فتفشل الحصص الحيّة لو استُضيفت الواجهة على أصل مختلف عن الـ API.
 */
export const HUB_BASE_URL = API_BASE_URL
  ? API_BASE_URL.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  : ''

/** مفتاح حفظ توكن الدخول في المتصفح */
export const TOKEN_STORAGE_KEY = 'edulink.token'
