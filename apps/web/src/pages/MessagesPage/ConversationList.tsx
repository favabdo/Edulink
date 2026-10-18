import { Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { counterpartNames, toEpoch, type ConversationSummary } from '../../features/messages/api'
import { Avatar, KindChip } from './PersonBadge'
import { RelativeTime } from './RelativeTime'
import styles from './MessagesPage.module.css'

type Props = {
  conversations: readonly ConversationSummary[]
  selectedId: number | null
  loading: boolean
  /** رسالة خطأ الخادم عند فشل قراءة المحادثات (عربية كما ترجع) */
  error: string | null
  onSelect: (id: number) => void
}

/**
 * آخر رسالة من المستخدم الحالي؟ الطرف الآخر (`with`) لا يحتويه،
 * لذلك غياب المرسل منها يعني أنه أنا — دون الحاجة إلى تمرير هويتي هنا.
 */
function sentByMe(conversation: ConversationSummary): boolean {
  return !conversation.with.some(
    (person) => person.kind === conversation.lastSenderKind && person.id === conversation.lastSenderId,
  )
}

/** عمود المحادثات: الطرف الآخر + النوع + آخر رسالة + الزمن + شارة غير المقروء */
export function ConversationList({ conversations, selectedId, loading, error, onSelect }: Props) {
  const { t } = useTranslation()

  if (conversations.length === 0) {
    return (
      <div className={styles.listEmpty}>
        <Inbox size={26} aria-hidden="true" />
        <p role={error ? 'alert' : undefined}>{error ?? t(loading ? 'messages:loading' : 'messages:empty.list')}</p>
      </div>
    )
  }

  return (
    <ul className={styles.list}>
      {conversations.map((conversation) => {
        const isSelected = conversation.conversationId === selectedId
        const mine = sentByMe(conversation)
        const names = counterpartNames(conversation.with)
        const label =
          names.length > 1 ? `${names[0]} ${t('messages:others', { value: names.length - 1 })}` : (names[0] ?? '')

        return (
          <li key={conversation.conversationId}>
            <button
              type="button"
              className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
              onClick={() => onSelect(conversation.conversationId)}
              aria-current={isSelected ? 'true' : undefined}
            >
              <Avatar
                kind={conversation.with[0]?.kind ?? conversation.lastSenderKind}
                name={conversation.with[0]?.name ?? conversation.lastSenderName}
              />

              <span className={styles.itemMain}>
                <span className={styles.itemNameRow}>
                  <span className={styles.itemName}>{label}</span>
                  {conversation.with[0] && <KindChip kind={conversation.with[0].kind} />}
                </span>
                <span className={styles.itemPreview}>
                  {conversation.lastBody
                    ? `${mine ? t('messages:youPrefix') : ''}${conversation.lastBody}`
                    : t('messages:empty.noMessages')}
                </span>
              </span>

              <span className={styles.itemSide}>
                <RelativeTime at={toEpoch(conversation.lastAt)} className={styles.itemTime} />
                {conversation.unread > 0 && (
                  <span
                    className={styles.unreadBadge}
                    title={t('messages:unread', { value: conversation.unread })}
                  >
                    {conversation.unread}
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
