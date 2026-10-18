import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useLanguage } from '../../i18n/useLanguage'

/** سهم يشير دائمًا نحو نهاية السطر (يسار في العربية، يمين في الإنجليزية) */
export function DirectionalArrow({ size = 16 }: { size?: number }) {
  const { language } = useLanguage()
  return language === 'ar' ? (
    <ArrowLeft size={size} aria-hidden="true" />
  ) : (
    <ArrowRight size={size} aria-hidden="true" />
  )
}
