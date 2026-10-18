import { useMemo } from 'react'
import { useLanguage } from '../../i18n/useLanguage'

/**
 * مُنسّقات الأرقام والتواريخ حسب اللغة النشطة (`Intl`).
 *
 * العربية → `ar-EG` (أرقام عربية) · الإنجليزية → `en-GB`.
 * النِسب تُعرض من 0 إلى 100 بغير كسور، والساعات بكسر عشري واحد بحد أقصى.
 */
export type ReportFormatters = {
  locale: string
  int: Intl.NumberFormat
  decimal: Intl.NumberFormat
  shortDate: Intl.DateTimeFormat
  longDate: Intl.DateTimeFormat
  count: (value: number) => string
  hours: (value: number) => string
  percent: (rate: number) => string
}

export function useReportsFormatters(): ReportFormatters {
  const { language } = useLanguage()

  return useMemo(() => {
    const locale = language === 'ar' ? 'ar-EG' : 'en-GB'
    const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
    const shortDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' })
    const longDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })

    return {
      locale,
      int,
      decimal,
      shortDate,
      longDate,
      count: (value: number) => int.format(value),
      hours: (value: number) => decimal.format(Math.round(value * 10) / 10),
      percent: (rate: number) => int.format(Math.round(rate * 100)),
    }
  }, [language])
}
