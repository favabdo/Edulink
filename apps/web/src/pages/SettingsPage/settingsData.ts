/**
 * بيانات وتخزين صفحة الإعدادات — كل شيء محلي (localStorage فقط، لا نداءات شبكة).
 *
 * المفاتيح المستخدمة:
 *   edulink.prefs      ← مفاتيح الإشعارات
 *   edulink.brand      ← هوية المؤسسة (white-label) — معاينة فقط، غير موصولة بالنظام
 *   edulink.themeMode  ← تفضيل المظهر (فاتح/غامق/تلقائي) — المظهر الفعلي يكتبه ThemeProvider
 */
import type { Theme } from '../../theme/themeContext'

const PREFS_KEY = 'edulink.prefs'
const BRAND_KEY = 'edulink.brand'
const THEME_MODE_KEY = 'edulink.themeMode'

// ------------------------------------------------------------------
// قراءة/كتابة آمنة
// ------------------------------------------------------------------

function readObject(key: string): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function writeObject(key: string, value: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // التخزين مقفول (وضع التصفح الخاص) — الإعدادات تبقى في الذاكرة فقط
  }
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

// ------------------------------------------------------------------
// الإشعارات
// ------------------------------------------------------------------

export type NotificationPrefs = {
  sessionReminders: boolean
  newMessages: boolean
  weeklyReport: boolean
}

const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  sessionReminders: true,
  newMessages: true,
  weeklyReport: false,
}

export function readNotificationPrefs(): NotificationPrefs {
  const stored = readObject(PREFS_KEY)
  if (!stored) return { ...DEFAULT_NOTIFICATIONS }
  return {
    sessionReminders: toBoolean(stored.sessionReminders, DEFAULT_NOTIFICATIONS.sessionReminders),
    newMessages: toBoolean(stored.newMessages, DEFAULT_NOTIFICATIONS.newMessages),
    weeklyReport: toBoolean(stored.weeklyReport, DEFAULT_NOTIFICATIONS.weeklyReport),
  }
}

export function writeNotificationPrefs(prefs: NotificationPrefs) {
  writeObject(PREFS_KEY, { ...prefs })
}

// ------------------------------------------------------------------
// هوية المؤسسة (white-label)
// ------------------------------------------------------------------

export type AccentKey = 'blue' | 'teal' | 'violet' | 'rose' | 'amber' | 'green'

export type AccentSwatch = {
  readonly key: AccentKey
  readonly hex: string
}

export const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { key: 'blue', hex: '#245493' },
  { key: 'teal', hex: '#0f9b8e' },
  { key: 'violet', hex: '#6d4bd8' },
  { key: 'rose', hex: '#d6407f' },
  { key: 'amber', hex: '#c8791a' },
  { key: 'green', hex: '#2f9e44' },
]

const ACCENT_KEYS: readonly AccentKey[] = ACCENT_SWATCHES.map((swatch) => swatch.key)

export function accentHex(key: AccentKey): string {
  return ACCENT_SWATCHES.find((swatch) => swatch.key === key)?.hex ?? ACCENT_SWATCHES[0]!.hex
}

export type BrandPrefs = {
  institutionName: string
  supportEmail: string
  accent: AccentKey
  logoName: string
}

const DEFAULT_BRAND: BrandPrefs = {
  institutionName: 'EduLink',
  /** فارغًا عمدًا: لا بريد دعم مُختلَق — تُدخله المؤسسة في هذه الشاشة */
  supportEmail: '',
  accent: 'blue',
  logoName: '',
}

export function readBrandPrefs(): BrandPrefs {
  const stored = readObject(BRAND_KEY)
  if (!stored) return { ...DEFAULT_BRAND }
  const accent = toText(stored.accent, DEFAULT_BRAND.accent)
  return {
    institutionName: toText(stored.institutionName, DEFAULT_BRAND.institutionName),
    supportEmail: toText(stored.supportEmail, DEFAULT_BRAND.supportEmail),
    accent: (ACCENT_KEYS as readonly string[]).includes(accent) ? (accent as AccentKey) : DEFAULT_BRAND.accent,
    logoName: toText(stored.logoName, DEFAULT_BRAND.logoName),
  }
}

export function writeBrandPrefs(brand: BrandPrefs) {
  writeObject(BRAND_KEY, { ...brand })
}

// ------------------------------------------------------------------
// تفضيل المظهر
// ------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark' | 'system'

const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system']

/** الوضع المحفوظ، وإلا يُستنتج من المظهر الحالي حتى لا ينقلب الثيم عند أول دخول */
export function readThemeMode(current: Theme): ThemeMode {
  if (typeof window === 'undefined') return current
  const stored = window.localStorage.getItem(THEME_MODE_KEY)
  return THEME_MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : current
}

export function writeThemeMode(mode: ThemeMode) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_MODE_KEY, mode)
}

// ------------------------------------------------------------------
// أدوات التحقق
// ------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

export type StrengthRule = {
  readonly key: 'length' | 'upper' | 'digit' | 'symbol'
  readonly test: (value: string) => boolean
}

/** 4 قواعد لقوة كلمة المرور — تُعرض كقائمة تحقق */
export const STRENGTH_RULES: readonly StrengthRule[] = [
  { key: 'length', test: (value) => value.length >= 8 },
  { key: 'upper', test: (value) => /[A-Z]/.test(value) },
  { key: 'digit', test: (value) => /\d/.test(value) },
  { key: 'symbol', test: (value) => /[^A-Za-z0-9\s]/.test(value) },
]

export function passedRuleCount(value: string): number {
  return STRENGTH_RULES.filter((rule) => rule.test(value)).length
}
