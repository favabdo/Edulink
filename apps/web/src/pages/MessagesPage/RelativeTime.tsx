import { useTranslation } from 'react-i18next'
import { relativeBucket } from './format'

/** زمن نسبي بصيغة الترجمة: «منذ 5 دقائق» / “5 min ago” */
export function RelativeTime({ at, className }: { at: number; className?: string }) {
  const { t } = useTranslation()
  const bucket = relativeBucket(at)

  const text =
    bucket.key === 'now'
      ? t('messages:time.now')
      : t(`messages:time.${bucket.key}`, { value: bucket.value })

  return <span className={className}>{text}</span>
}
