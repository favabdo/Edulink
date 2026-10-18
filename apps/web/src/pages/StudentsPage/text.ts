import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../i18n/useLanguage'
import { subjectDisplayName, type GradeKey, type SubjectKey } from '../../lib/data/eduStore'

/**
 * أدوات التنسيق والنصوص المشتركة لصفحتي الطلاب.
 *
 * التواريخ والأرقام تُنسَّق حسب اللغة الفعّالة (`ar-EG` للعربية و`en-GB` للإنجليزية)
 * حتى تظهر الأرقام والتواريخ بنظام الكتابة الصحيح في كل لغة.
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
      collator: new Intl.Collator(locale, { sensitivity: 'base' }),
    }),
    [locale],
  )
}

export type Formatters = ReturnType<typeof useFormatters>

/** حرفان من أول كلمتين — بديل الصورة الرمزية */
export function initialsOf(name: string, fallback: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
  const initials = parts.map((part) => part.charAt(0)).join('')
  return initials || fallback
}

/**
 * أسماء الصفوف والمادة.
 *
 * المواد تُقرأ من `dashboard:subjects.*` (المصدر المعتمد حاليًا)، ومع ذلك تُرْجَع
 * ترجمة الصفحة نفسها عند غياب المفتاح (مثل biology غير المسجَّلة بعد في اللوحة).
 */
export function useLabels() {
  const { t, i18n } = useTranslation()

  return useMemo(
    () => ({
      grade: (grade: GradeKey | '') => (grade ? t(`students:grades.${grade}`) : t('students:grades.none')),
      subject: (subject: SubjectKey) => {
        const key = `dashboard:subjects.${subject}`
        return i18n.exists(key) ? t(key) : t(`students:subjects.${subject}`)
      },
      /** المادة نص حر كما تدخله المؤسسة — طالب بلا حصص ليس له مادة بعد */
      subjectOf: (item: { subject: SubjectKey; subjectText?: string }) =>
        item.subject === 'other' && !item.subjectText ? '—' : subjectDisplayName(item, t, 'dashboard:subjects'),
    }),
    [t, i18n],
  )
}
