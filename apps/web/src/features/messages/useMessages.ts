/**
 * حالة صفحة الرسائل الحقيقية: صندوق الوارد + الخيط المفتوح + الإرسال.
 *
 * - قائمة المحادثات تُقرأ عند الفتح وكل 30 ثانية (لا قناة Push بعد).
 * - الخيط المفتوح يُقرأ كل 15 ثانية، والخادم يُعلّم رسائله مقروءة عند القراءة.
 * - الإرسال يظهر فورًا في الواجهة ثم يُعاد ضبطه مع أول رد حقيقي من الخادم.
 */
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/authContext'
import {
  accountKindOf,
  fetchConversations,
  fetchThread,
  replyInConversation,
  startConversation,
  toEpoch,
  type AccountKind,
  type ConversationSummary,
  type ThreadMessage,
} from './api'

const CONVERSATIONS_POLL_MS = 30_000
const THREAD_POLL_MS = 15_000

/** الخيط المحمّل: معرّفه حتى تُشتق الحالة الصحيحة عند تبديل المحادثة */
type ThreadState = {
  id: number
  messages: ThreadMessage[]
}

export type StartResult = {
  ok: boolean
  conversationId?: number
  /** رسالة خطأ الخادم (عربي كما هي) — تُعرض في الحوار عند 403 أو 400 */
  error?: string
}

export type UseMessagesResult = {
  conversations: ConversationSummary[]
  loadingConversations: boolean
  messages: ThreadMessage[]
  loadingThread: boolean
  sending: boolean
  error: string | null
  reload: () => void
  send: (body: string) => Promise<boolean>
  start: (recipientKind: AccountKind, recipientId: number, body: string) => Promise<StartResult>
}

/** تحديث صف الوارد محليًا بعد الإرسال (آخر رسالة + الزمن ثم إعادة الترتيب) */
function touch(
  list: readonly ConversationSummary[],
  conversationId: number,
  patch: Partial<ConversationSummary>,
): ConversationSummary[] {
  const next = list.map((item) => (item.conversationId === conversationId ? { ...item, ...patch } : item))
  return [...next].sort((a, b) => toEpoch(b.lastAt) - toEpoch(a.lastAt))
}

export function useMessages(selectedId: number | null): UseMessagesResult {
  const { user } = useAuth()
  const myKind = accountKindOf(user)
  const myId = user?.id ?? 0
  const myName = user?.name ?? user?.email ?? ''

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationsNonce, setConversationsNonce] = useState(0)
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)

  const reload = useCallback(() => setConversationsNonce((current) => current + 1), [])

  // ── صندوق الوارد ──
  useEffect(() => {
    let alive = true

    fetchConversations()
      .then((rows) => {
        if (!alive) return
        setConversations(rows ?? [])
        setError(null)
        setLoadingConversations(false)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : null)
        setLoadingConversations(false)
      })

    const timer = window.setInterval(reload, CONVERSATIONS_POLL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [conversationsNonce, reload])

  // ── الخيط المفتوح ──
  // الحالة تحمل معرّف الخيط، و`messages`/`loadingThread` تُشتق أثناء الرسم — بلا setState داخل الـ effect
  const [thread, setThread] = useState<ThreadState | null>(null)

  useEffect(() => {
    if (selectedId === null) return

    let alive = true

    const apply = (rows: ThreadMessage[]) => {
      if (!alive) return
      setThread({ id: selectedId, messages: rows })
      // الخادم علّمها مقروءة عند القراءة — يُصفَّر العدّاد محليًا دون انتظار النبض التالي
      setConversations((current) =>
        current.map((item) => (item.conversationId === selectedId ? { ...item, unread: 0 } : item)),
      )
    }

    fetchThread(selectedId)
      .then((rows) => apply(rows ?? []))
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : null)
        // يُعتبر الخيط محمولًا حتى مع الفشل حتى لا تبقى اللوحة في وضع التحميل
        setThread({ id: selectedId, messages: [] })
      })

    const timer = window.setInterval(() => {
      fetchThread(selectedId)
        .then((rows) => {
          if (alive) setThread({ id: selectedId, messages: rows ?? [] })
        })
        .catch(() => {
          /* النبض التالي يحاول مجددًا — لا رسالة خطأ لكل محاولة */
        })
    }, THREAD_POLL_MS)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [selectedId])

  const activeThread = thread && thread.id === selectedId ? thread : null
  const messages = activeThread?.messages ?? []
  const loadingThread = selectedId !== null && activeThread === null

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (selectedId === null) return false

      setSending(true)
      try {
        const result = await replyInConversation(selectedId, body)
        // الإضافة المحلية تختفي عند أول نبض قادم من الخادم (نفس المعرّف)
        setThread((current) =>
          current && current.id === selectedId
            ? {
                ...current,
                messages: [
                  ...current.messages,
                  {
                    id: result.id,
                    body,
                    senderKind: myKind,
                    senderId: myId,
                    senderName: myName,
                    mine: true,
                    at: result.at,
                  },
                ],
              }
            : current,
        )
        setConversations((current) =>
          touch(current, selectedId, {
            lastBody: body,
            lastAt: result.at,
            lastSenderKind: myKind,
            lastSenderId: myId,
            lastSenderName: myName,
            unread: 0,
          }),
        )
        setError(null)
        return true
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : null)
        return false
      } finally {
        setSending(false)
      }
    },
    [myId, myKind, myName, selectedId],
  )

  const start = useCallback(
    async (recipientKind: AccountKind, recipientId: number, body: string): Promise<StartResult> => {
      try {
        const result = await startConversation(recipientKind, recipientId, body)
        reload()
        return { ok: true, conversationId: result.conversationId }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined
        return { ok: false, error: message }
      }
    },
    [reload],
  )

  return {
    conversations,
    loadingConversations,
    messages,
    loadingThread,
    sending,
    error,
    reload,
    send,
    start,
  }
}
