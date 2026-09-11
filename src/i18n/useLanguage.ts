import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { changeLanguage, isSupportedLanguage, type SupportedLanguage } from './index'

type UseLanguageResult = {
  language: SupportedLanguage
  setLanguage: (language: SupportedLanguage) => void
  toggleLanguage: () => void
}

export function useLanguage(): UseLanguageResult {
  const { i18n } = useTranslation()
  const language: SupportedLanguage = isSupportedLanguage(i18n.language) ? i18n.language : 'ar'

  const setLanguage = useCallback((next: SupportedLanguage) => {
    void changeLanguage(next)
  }, [])

  const toggleLanguage = useCallback(() => {
    void changeLanguage(language === 'ar' ? 'en' : 'ar')
  }, [language])

  return { language, setLanguage, toggleLanguage }
}
