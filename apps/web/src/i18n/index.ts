import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import arCommon from '../locales/ar/common.json'
import arDashboard from '../locales/ar/dashboard.json'
import arLogin from '../locales/ar/login.json'
import enCommon from '../locales/en/common.json'
import enDashboard from '../locales/en/dashboard.json'
import enLogin from '../locales/en/login.json'

/**
 * إعداد الترجمة — **namespace لكل صفحة/وحدة**.
 *
 * كل صفحة لها ملفها الخاص:
 *    locales/<lang>/common.json     ← ما يُستخدم في كل مكان (الاسم، المظهر، اللغة)
 *    locales/<lang>/login.json      ← صفحة الدخول
 *    locales/<lang>/dashboard.json  ← اللوحة الداخلية
 *
 * الاستخدام داخل المكوّنات (بدون تمرير namespace لـ useTranslation):
 *    t('login:form.submit')        ← من ملف login
 *    t('dashboard:greeting')       ← من ملف dashboard
 *    t('common:theme.light')       ← من ملف common
 *
 * إضافة صفحة جديدة = ملف JSON جديد في locales/<lang>/ + إضافته في resources و ns.
 */

export const supportedLanguages = ['ar', 'en'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

export const DEFAULT_LANGUAGE: SupportedLanguage = 'ar'
export const LANGUAGE_STORAGE_KEY = 'edulink.language'

/** كل الوحدات المترجمة — تُضاف الوحدة الجديدة هنا */
export const namespaces = ['common', 'login', 'dashboard'] as const
export type Namespace = (typeof namespaces)[number]

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

  const title = i18n.t('common:pageTitle')
  if (title && title !== 'common:pageTitle') document.title = title
}

void i18n.use(initReactI18next).init({
  resources: {
    ar: { common: arCommon, login: arLogin, dashboard: arDashboard },
    en: { common: enCommon, login: enLogin, dashboard: enDashboard },
  },
  ns: namespaces,
  defaultNS: 'common',
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
