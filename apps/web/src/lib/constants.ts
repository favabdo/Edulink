/** ثوابت عامة للتطبيق — تُقرأ مرة واحدة من متغيّرات البيئة */

/**
 * عنوان الـ API.
 *
 * - `VITE_API_BASE_URL` مضبوطًا = الـ API على **أصل آخر** (أصل مطلق بلا شرطة مائلة نهائية).
 * - بلا ذلك يُشتَقّ من بادئة النشر (`base` في Vite): `/edulink/` ⇒ `/edulink`، و`/` ⇒ `''`
 *   فيبقى التطوير على المسار النسبي عبر بروكسي Vite. الاشتقاق هو ما يمنع السطر المنسيّ:
 *   المنصة تُسلَّم على السيرفر من نفس الأصل تحت بادئة، فمن يبنِ بـ `VITE_BASE_PATH=/edulink/`
 *   ينادي `/edulink/api` و`/edulink/hubs` بلا أي ضبط إضافي.
 */
const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
export const API_BASE_URL = (
  configuredApiBase && configuredApiBase.length > 0
    ? configuredApiBase
    : (import.meta.env.BASE_URL ?? '/')
).replace(/\/$/, '')

/**
 * أصل الـ Hub (SignalR): يتبع أصل الـ API، مع `ws`/`wss` بدل `http`/`https` حين يكون مطلقًا.
 * القيمة النسبية (`/edulink` أو `''`) تُترك كما هي — عميل SignalR يبني عليها `ws(s)://نفس الأصل`
 * من صفحة التطبيق، وهذا ما يعمل خلف بروكسي Vite في التطوير وخلف nginx على السيرفر.
 */
export const HUB_BASE_URL = /^https?:/i.test(API_BASE_URL)
  ? API_BASE_URL.replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:')
  : API_BASE_URL

/** مفتاح حفظ توكن الدخول في المتصفح */
export const TOKEN_STORAGE_KEY = 'edulink.token'
