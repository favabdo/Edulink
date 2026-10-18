import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../i18n/useLanguage'
import type { AttendanceMark, GradeKey, SessionStatus, SubjectKey } from '../../lib/data/eduStore'

/**
 * تنسيق التواريخ/الأرقام والنصوص لصفحة تفاصيل الطالب.
 * نفس أسلوب صفحة القائمة: `ar-EG` للعربية و`en-GB` للإنجليزية.
 */
export function useFormatters() {
  const { language } = useLanguage()
  const locale = language === 'ar' ? 'ar-EG' : 'en-GB'

  return useMemo(
    () => ({
      locale,
      date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
      dateTime: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
      time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }),
      day: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short' }),
      shortDay: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
      number: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
      percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    }),
    [locale],
  )
}

export function initialsOf(name: string, fallback: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  const initials = parts.map((part) => part.charAt(0)).join('')
  return initials || fallback
}

export function useLabels() {
  const { t, i18n } = useTranslation()

  return useMemo(
    () => ({
      grade: (grade: GradeKey | '') => (grade ? t(`students:grades.${grade}`) : t('students:grades.none')),
      subject: (subject: SubjectKey) => {
        const key = `dashboard:subjects.${subject}`
        return i18n.exists(key) ? t(key) : t(`students:subjects.${subject}`)
      },
      sessionStatus: (status: SessionStatus) => t(`students:sessionStatus.${status}`),
      attendance: (mark: AttendanceMark | null) =>
        mark === null ? t('students:attendance.pending') : t(`students:attendance.${mark}`),
    }),
    [t, i18n],
  )
}
