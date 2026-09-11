const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{6,17}$/

export const MIN_PASSWORD_LENGTH = 8

export type ValidationCode = 'required' | 'invalid' | 'tooShort'

/**
 * الدخول مسموح بالبريد الإلكتروني أو رقم الهاتف (المشرف هو من يُدخل البيانات).
 */
export function validateIdentifier(value: string): ValidationCode | null {
  const trimmed = value.trim()
  if (!trimmed) return 'required'
  if (EMAIL_PATTERN.test(trimmed) || PHONE_PATTERN.test(trimmed)) return null
  return 'invalid'
}

export function validatePassword(value: string): ValidationCode | null {
  if (!value) return 'required'
  if (value.length < MIN_PASSWORD_LENGTH) return 'tooShort'
  return null
}
