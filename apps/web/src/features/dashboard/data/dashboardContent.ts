/**
 * بيانات اللوحة الداخلية.
 *
 * ⚠️ هذه **بيانات تجريبية ثابتة** — جداول الحصص والطلاب والتقارير لم تُبنَ بعد
 * في قاعدة البيانات. الهدف الآن هو بناء الشكل النهائي للصفحة فقط.
 * عند بناء تلك الجداول تُستبدل هذه الثوابت بنداءات API.
 */

export type SessionStatus = 'completed' | 'live' | 'inHour' | 'inHours'

export type SessionRow = {
  id: number
  from: string
  to: string
  subjectKey: 'math' | 'english' | 'physics' | 'chemistry'
  student: string
  status: SessionStatus
  /** تُستخدم مع حالة inHours */
  hours?: number
}

export type UpcomingRow = {
  id: number
  from: string
  to: string
  subjectKey: SessionRow['subjectKey']
  student: string
}

export type ActivityRow = {
  id: number
  textKey: string
  atKey: string
}

export const todayStats = {
  total: 3,
  completed: 1,
  remaining: 2,
  nextWeek: 5,
}

export const todaySessions: SessionRow[] = [
  {
    id: 1,
    from: '10:00 ص',
    to: '11:00 ص',
    subjectKey: 'math',
    student: 'أحمد خالد',
    status: 'completed',
  },
  {
    id: 2,
    from: '12:00 م',
    to: '1:00 م',
    subjectKey: 'english',
    student: 'سارة محمد',
    status: 'live',
  },
  {
    id: 3,
    from: '3:00 م',
    to: '4:00 م',
    subjectKey: 'physics',
    student: 'علي حسن',
    status: 'inHour',
  },
  {
    id: 4,
    from: '5:00 م',
    to: '6:00 م',
    subjectKey: 'chemistry',
    student: 'مريم أحمد',
    status: 'inHours',
    hours: 3,
  },
]

export const upcomingSessions: UpcomingRow[] = [
  {
    id: 1,
    from: '3:00 م',
    to: '4:00 م',
    subjectKey: 'physics',
    student: 'علي حسن',
  },
  {
    id: 2,
    from: '5:00 م',
    to: '6:00 م',
    subjectKey: 'chemistry',
    student: 'مريم أحمد',
  },
  {
    id: 3,
    from: '7:00 م',
    to: '8:00 م',
    subjectKey: 'math',
    student: 'محمد علي',
  },
]

export const recentActivity: ActivityRow[] = [
  { id: 1, textKey: 'sessionCompleted', atKey: 'minutes30' },
  { id: 2, textKey: 'studentJoined', atKey: 'hour1' },
  { id: 3, textKey: 'studentAdded', atKey: 'hours2' },
  { id: 4, textKey: 'scheduleUpdated', atKey: 'hours3' },
]
