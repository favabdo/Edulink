/**
 * جرس الإشعارات الحقيقي — يقرأ من `/api/notifications` ويحدّث نفسه كل دقيقة.
 *
 * لا نداءات شبكة داخل المكوّنات: لوحة الإشعارات في `DashboardLayout` تستهلك هذا الـ hook فقط.
 * التعليم كمقروء يتم فورًا في الواجهة (optimistic) ثم يُرسل للخادم، ومع أي فشل تُعاد
 * القراءة من الخادم حتى لا يبقى الوضع المحلي مخالفًا له.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/apiClient'
import { ROUTES, sessionLivePath, studentDetailPath } from '../../app/router/paths'

// ─────────────────────────────── الأنواع ───────────────────────────────

/** إشعار كما يرجّعه الخادم (NotificationDto في apps/api) — الأوقات ISO والأزمنة ms محليًا */
export type ApiNotification = {
  id: number
  kind: string
  title: string
  body: string | null
  link: string | null
  readAt: string | null
  at: string
}

/** الشكل الذي تستهلكه اللوحة: `at` و `readAt` بالـ epoch ms لتسهيل الزمن النسبي */
export type NotificationItem = {
  id: number
  kind: string
  title: string
  body: string | null
  link: string | null
  readAt: number | null
  at: number
}

type ApiListResponse = {
  unread: number
  items: ApiNotification[]
}

export type UseNotificationsResult = {
  items: NotificationItem[]
  /** عدد غير المقروء من الصف المعروض (الخادم يحسبه على نفس الصفحة) */
  unread: number
  loading: boolean
  /** رسالة خطأ الخادم كما هي (عربي) — تظهر في اللوحة بدل حالة «لا إشعارات» */
  error: string | null
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
  refresh: () => void
}

// ─────────────────────────────── الثوابت ───────────────────────────────

/** عدد الإشعارات المطلوبة — الخادم يقبل حتى 100 */
const TAKE = 30
/** إعادة القراءة كل دقيقة (لا يوجد Push بعد — قرار مؤجّل في docs/04) */
const POLL_MS = 60_000

function toNotificationItem(row: ApiNotification): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt ? Date.parse(row.readAt) : null,
    at: Date.parse(row.at),
  }
}

// ─────────────────────────── توجيه الإشعار داخل التطبيق ───────────────────────────

/** المسارات الأساسية المعروفة — كلها من `ROUTES` (لا تُكتب المسارات نصًا) */
const BASE_ROUTES: readonly string[] = [
  ROUTES.home,
  ROUTES.schedule,
  ROUTES.sessions,
  ROUTES.students,
  ROUTES.teachers,
  ROUTES.parents,
  ROUTES.reports,
  ROUTES.messages,
  ROUTES.settings,
]

/** كلمة «live» الأخيرة في مسار الحصة اللايف، مأخوذة من `ROUTES.classroom` بدل كتابتها نصًا */
const LIVE_SEGMENT = ROUTES.classroom.split('/').pop() ?? ''

function baseRouteOf(pathname: string): string | null {
  const exact = BASE_ROUTES.find((route) => route === pathname)
  if (exact) return exact
  return BASE_ROUTES.find((route) => pathname.startsWith(`${route}/`)) ?? null
}

/**
 * تحويل رابط الإشعار القادم من الخادم (`/schedule` · `/sessions/12` · `/messages?conversation=3`)
 * إلى مسار مُولَّد من `ROUTES`. أي رابط خارجي أو مسار غير معروف يُرجع null (تعليم مقروء فقط بلا تنقل).
 */
export function notificationPath(link: string | null): string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null

  const queryIndex = link.indexOf('?')
  const pathname = queryIndex === -1 ? link : link.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : link.slice(queryIndex)

  const segments = pathname.split('/').filter(Boolean)
  const base = baseRouteOf(pathname)
  if (!base) return null

  const idSegment = segments[1]
  if (!idSegment) return `${base}${query}`

  // /students/{id} — صفحة تفاصيل الطالب
  if (base === ROUTES.students && segments.length === 2) {
    return studentDetailPath(idSegment)
  }

  // /sessions/{id}/live — غرفة الحصة نفسها بدل قائمة الحصص
  if (base === ROUTES.sessions && segments.length === 3 && segments[2] === LIVE_SEGMENT) {
    return sessionLivePath(idSegment)
  }

  // /sessions/{id} أو /messages?conversation=… — المسار الأساسي مع الـ query كما هو
  return `${base}${query}`
}

// ─────────────────────────────── الـ hook ───────────────────────────────

export function useNotifications(): UseNotificationsResult {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** كل زيادة فيه تُعيد تشغيل قراء الإشعارات (تحديث يدوي أو بعد فشل تعليم) */
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((current) => current + 1), [])

  useEffect(() => {
    let alive = true

    apiFetch<ApiListResponse>(`/api/notifications?unreadOnly=0&take=${TAKE}`)
      .then((data) => {
        if (!alive) return
        setItems((data.items ?? []).map(toNotificationItem))
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : null)
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [nonce])

  // إعادة القراءة كل دقيقة لالتقاط إشعارات جديدة (لا يوجد قناة لايف للجرس بعد)
  useEffect(() => {
    const timer = window.setInterval(refresh, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const unread = useMemo(() => items.filter((item) => item.readAt === null).length, [items])

  const markRead = useCallback(
    async (id: number) => {
      const now = Date.now()
      setItems((current) =>
        current.map((item) => (item.id === id && item.readAt === null ? { ...item, readAt: now } : item)),
      )
      try {
        await apiFetch<void>(`/api/notifications/${id}/read`, { method: 'POST' })
      } catch {
        refresh()
      }
    },
    [refresh],
  )

  const markAllRead = useCallback(async () => {
    const now = Date.now()
    setItems((current) => current.map((item) => (item.readAt === null ? { ...item, readAt: now } : item)))
    try {
      await apiFetch<void>('/api/notifications/read-all', { method: 'POST' })
    } catch {
      refresh()
    }
  }, [refresh])

  return { items, unread, loading, error, markRead, markAllRead, refresh }
}
