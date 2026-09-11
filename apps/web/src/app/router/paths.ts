/** كل مسارات التطبيق في مكان واحد — لا تُكتب المسارات نصًّا داخل المكوّنات */
export const ROUTES = {
  login: '/login',
  home: '/home',
  schedule: '/schedule',
  sessions: '/sessions',
  students: '/students',
  reports: '/reports',
  messages: '/messages',
  settings: '/settings',
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]
