import { SquarePen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../features/auth/authContext'
import { accountKindOf, fetchContacts, type MessageContact } from '../../features/messages/api'
import { useMessages } from '../../features/messages/useMessages'
import { ConversationList } from './ConversationList'
import { MessageThread } from './MessageThread'
import { NewMessageDialog } from './NewMessageDialog'
import styles from './MessagesPage.module.css'

/** الخيط المفتوح يعيش في الـ query حتى يعمل رابط الإشعار `/messages?conversation=12` */
const CONVERSATION_PARAM = 'conversation'

function readSelectedId(params: URLSearchParams): number | null {
  const raw = params.get(CONVERSATION_PARAM)
  if (!raw) return null
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** صفحة الرسائل — المسار: /messages — عمودان: المحادثات الحقيقية + نص المحادثة */
export function MessagesPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = readSelectedId(searchParams)

  const {
    conversations,
    loadingConversations,
    messages,
    loadingThread,
    sending,
    error,
    send,
    start,
  } = useMessages(selectedId)

  /** أي عمود يظهر وحده على الشاشات الضيقة */
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>('list')
  const [dialogOpen, setDialogOpen] = useState(false)
  /** null = الدليل لم يُقرأ بعد — حالة التحميل تُشتق من ذلك بدل setState داخل الـ effect */
  const [contacts, setContacts] = useState<MessageContact[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const contactsLoading = dialogOpen && contacts === null

  const selected = conversations.find((conversation) => conversation.conversationId === selectedId) ?? null
  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unread, 0)

  /** دليل المستلمين يُقرأ عند أول فتح للحوار فقط (وليس مع تحميل الصفحة) */
  useEffect(() => {
    if (!dialogOpen || contacts !== null) return

    let alive = true

    fetchContacts(accountKindOf(user), user?.id ?? 0)
      .then((rows) => {
        if (alive) setContacts(rows)
      })
      .catch(() => {
        if (alive) setContacts([])
      })

    return () => {
      alive = false
    }
  }, [contacts, dialogOpen, user])

  const openConversation = useCallback(
    (id: number) => {
      setSearchParams({ [CONVERSATION_PARAM]: String(id) }, { replace: true })
      setMobilePane('thread')
    },
    [setSearchParams],
  )

  const goBack = useCallback(() => setMobilePane('list'), [])

  const closeDialog = useCallback(() => {
    setDialogOpen(false)
    setDialogError(null)
  }, [])

  function sendReply(text: string) {
    void send(text)
  }

  async function createConversation(contact: MessageContact, body: string) {
    setCreating(true)
    setDialogError(null)

    const result = await start(contact.kind, contact.id, body)
    setCreating(false)

    if (!result.ok) {
      setDialogError(result.error ?? null)
      return
    }

    setDialogOpen(false)
    if (result.conversationId) openConversation(result.conversationId)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('messages:heading')}</h1>
          <p className={styles.subtitle}>{t('messages:subtitle')}</p>
        </div>
        <button type="button" className={styles.composeButton} onClick={() => setDialogOpen(true)}>
          <SquarePen size={18} aria-hidden="true" />
          <span>{t('messages:newMessage')}</span>
        </button>
      </header>

      <div className={styles.layout} data-mobile={mobilePane}>
        <section className={styles.listPane} aria-label={t('messages:listLabel')}>
          <div className={styles.listHeader}>
            <span className={styles.listCount}>
              {t('messages:conversations', { value: conversations.length })}
            </span>
            {unreadTotal > 0 && (
              <span className={styles.listUnread}>{t('messages:unread', { value: unreadTotal })}</span>
            )}
          </div>
          <div className={styles.listScroll}>
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              loading={loadingConversations}
              error={error}
              onSelect={openConversation}
            />
          </div>
        </section>

        <section className={styles.threadPane} aria-label={t('messages:threadLabel')}>
          {selected ? (
            <MessageThread
              key={selected.conversationId}
              conversation={selected}
              messages={messages}
              loading={loadingThread}
              sending={sending}
              error={error}
              onBack={goBack}
              onSend={sendReply}
            />
          ) : (
            <div className={styles.threadEmpty}>
              <p>{error && !loadingConversations ? error : t('messages:empty.thread')}</p>
            </div>
          )}
        </section>
      </div>

      {dialogOpen && (
        <NewMessageDialog
          contacts={contacts ?? []}
          loading={contactsLoading}
          busy={creating}
          error={dialogError}
          onClose={closeDialog}
          onCreate={(contact, body) => void createConversation(contact, body)}
        />
      )}
    </div>
  )
}
