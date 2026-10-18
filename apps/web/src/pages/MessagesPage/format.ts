/** أدوات تنسيق الأسماء والأزمنة لصفحة الرسائل (لا نداءات شبكة هنا) */

/** أول حرفين من الاسم، مع تجاهل الاختصارات زي «أ.» */
export function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => !(part.length <= 2 && part.endsWith('.')))
  const initials = parts.slice(0, 2).map((part) => part.charAt(0)).join('')
  return initials || '؟'
}

export type RelativeKey = 'now' | 'minutes' | 'hours' | 'days'

export type RelativeBucket = {
  readonly key: RelativeKey
  readonly value: number
}

/** تصنيف الزمن النسبي (دقيقة/ساعة/يوم) — النص يأتي من الترجمة */
export function relativeBucket(at: number, now: number = Date.now()): RelativeBucket {
  const diff = Math.max(0, now - at)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return { key: 'now', value: 0 }
  if (minutes < 60) return { key: 'minutes', value: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'hours', value: hours }
  return { key: 'days', value: Math.floor(hours / 24) }
}

const DAY_START_MS = 86_400_000

/** مفتاح اليوم للتجميع (YYYY-MM-DD محليًا) — يفصل بين رسائل الأيام المختلفة */
export function dayKeyOf(at: number): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function isToday(at: number, now: number = Date.now()): boolean {
  return dayKeyOf(at) === dayKeyOf(now)
}

export function isYesterday(at: number, now: number = Date.now()): boolean {
  return dayKeyOf(at) === dayKeyOf(now - DAY_START_MS)
}

/** تاريخ مطلق مفصّل لأيام أقدم من أمس */
export function formatAbsoluteDay(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(at))
}

/** وقت مختصر داخل الفقاعة (٩:٤١ ص / 9:41 AM) */
export function formatClock(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(at))
}
