import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import arCommon from '../locales/ar/common.json'
import arDashboard from '../locales/ar/dashboard.json'
import arLogin from '../locales/ar/login.json'
import arSchedule from '../locales/ar/schedule.json'
import arSessions from '../locales/ar/sessions.json'
import arClassroom from '../locales/ar/classroom.json'
import arStudents from '../locales/ar/students.json'
import arTeachers from '../locales/ar/teachers.json'
import arParents from '../locales/ar/parents.json'
import arReports from '../locales/ar/reports.json'
import arMessages from '../locales/ar/messages.json'
import arSettings from '../locales/ar/settings.json'
import enCommon from '../locales/en/common.json'
import enDashboard from '../locales/en/dashboard.json'
import enLogin from '../locales/en/login.json'
import enSchedule from '../locales/en/schedule.json'
import enSessions from '../locales/en/sessions.json'
import enClassroom from '../locales/en/classroom.json'
import enStudents from '../locales/en/students.json'
import enTeachers from '../locales/en/teachers.json'
import enParents from '../locales/en/parents.json'
import enReports from '../locales/en/reports.json'
import enMessages from '../locales/en/messages.json'
import enSettings from '../locales/en/settings.json'

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
export const namespaces = [
  'common',
  'login',
  'dashboard',
  'schedule',
  'sessions',
  'classroom',
  'students',
  'teachers',
  'parents',
  'reports',
  'messages',
  'settings',
] as const
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
    ar: {
      common: arCommon,
      login: arLogin,
      dashboard: arDashboard,
      schedule: arSchedule,
      sessions: arSessions,
      classroom: arClassroom,
      students: arStudents,
      teachers: arTeachers,
      parents: arParents,
      reports: arReports,
      messages: arMessages,
      settings: arSettings,
    },
    en: {
      common: enCommon,
      login: enLogin,
      dashboard: enDashboard,
      schedule: enSchedule,
      sessions: enSessions,
      classroom: enClassroom,
      students: enStudents,
      teachers: enTeachers,
      parents: enParents,
      reports: enReports,
      messages: enMessages,
      settings: enSettings,
    },
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
