import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from './locales/ar.json'
import en from './locales/en.json'

export const supportedLanguages = ['ar', 'en'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'ar'
export const LANGUAGE_STORAGE_KEY = 'edulink.language'

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (supportedLanguages as readonly string[]).includes(value)
}

export function directionFor(language: SupportedLanguage): 'rtl' | 'ltr' {
  return language === 'ar' ? 'rtl' : 'ltr'
}

function readStoredLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
  return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE
}

function applyDocumentLanguage(language: SupportedLanguage) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  document.documentElement.dir = directionFor(language)

  const title = i18n.t('common.pageTitle')
  if (title && title !== 'common.pageTitle') document.title = title
}

void i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: readStoredLanguage(),
  fallbackLng: 'en',
  supportedLngs: supportedLanguages,
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => {
  if (isSupportedLanguage(language)) applyDocumentLanguage(language)
})

const initialLanguage = readStoredLanguage()
applyDocumentLanguage(initialLanguage)
void i18n.changeLanguage(initialLanguage)

export async function changeLanguage(language: SupportedLanguage) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  await i18n.changeLanguage(language)
}

export default i18n
