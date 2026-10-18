/** كل مسارات التطبيق في مكان واحد — لا تُكتب المسارات نصًّا داخل المكوّنات */
export const ROUTES = {
  login: '/login',
  home: '/home',
  schedule: '/schedule',
  sessions: '/sessions',
  /** الحصة اللايف — تُولّد عبر sessionLivePath() ولا تُستخدم مباشرة في <Link> */
  classroom: '/sessions/:sessionId/live',
  students: '/students',
  /** تفاصيل طالب — تُولّد عبر studentDetailPath() */
  studentDetail: '/students/:studentId',
  teachers: '/teachers',
  parents: '/parents',
  reports: '/reports',
  messages: '/messages',
  settings: '/settings',
} as const

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES]

export function sessionLivePath(sessionId: number | string): string {
  return `/sessions/${sessionId}/live`
}

export function studentDetailPath(studentId: number | string): string {
  return `/students/${studentId}`
}
