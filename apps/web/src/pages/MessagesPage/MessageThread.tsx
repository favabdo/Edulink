import { ArrowLeft, ArrowRight, Paperclip, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../../i18n/useLanguage'
import { counterpartNames, toEpoch, type ConversationSummary, type ThreadMessage } from '../../features/messages/api'
import { dayKeyOf, formatAbsoluteDay, formatClock, isToday, isYesterday } from './format'
import { Avatar, KindChip } from './PersonBadge'
import styles from './MessagesPage.module.css'

type DayGroup = {
  key: string
  at: number
  items: ThreadMessage[]
}

function groupByDay(messages: readonly ThreadMessage[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const message of messages) {
    const key = dayKeyOf(toEpoch(message.at))
    const current = groups[groups.length - 1]
    if (current && current.key === key) current.items.push(message)
    else groups.push({ key, at: toEpoch(message.at), items: [message] })
  }
  return groups
}

type Props = {
  conversation: ConversationSummary
  messages: ThreadMessage[]
  loading: boolean
  sending: boolean
  /** رسالة خطأ الخادم عند فشل الإرسال أو القراءة (عربية كما ترجع) */
  error: string | null
  /** يظهر فقط على الشاشات الضيقة (تحت 900px) */
  onBack: () => void
  onSend: (text: string) => void
}

/** عمود المحادثة: فقاعات + فواصل الأيام + صندوق الكتابة */
export function MessageThread({ conversation, messages, loading, sending, error, onBack, onSend }: Props) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const [draft, setDraft] = useState('')

  /** أرقام لاتينية في العربي (نفس أسلوب بقية صفحات اللوحة) */
  const locale = language === 'ar' ? 'ar-u-nu-latn' : 'en-GB'

  const scrollRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupByDay(messages), [messages])

  const counterpart = conversation.with[0] ?? {
    kind: conversation.lastSenderKind,
    id: conversation.lastSenderId,
    name: conversation.lastSenderName,
  }

  const names = counterpartNames(conversation.with)
  const threadTitle =
    names.length > 1 ? `${names[0]} ${t('messages:others', { value: names.length - 1 })}` : (names[0] ?? counterpart.name)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, loading])

  function dayLabel(at: number): string {
    if (isToday(at)) return t('messages:day.today')
    if (isYesterday(at)) return t('messages:day.yesterday')
    return formatAbsoluteDay(at, locale)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    onSend(text)
    setDraft('')
  }

  return (
    <>
      <header className={styles.threadHeader}>
        <button type="button" className={styles.backButton} onClick={onBack} aria-label={t('messages:back')}>
          {language === 'ar' ? <ArrowRight size={18} aria-hidden="true" /> : <ArrowLeft size={18} aria-hidden="true" />}
        </button>

        <Avatar kind={counterpart.kind} name={counterpart.name} small />

        <div className={styles.threadIdentity}>
          <div className={styles.threadNameRow}>
            <span className={styles.threadName}>{threadTitle}</span>
            <KindChip kind={counterpart.kind} />
          </div>
          <span className={styles.threadSubject}>{t('messages:subtitleShort')}</span>
        </div>
      </header>

      <div className={styles.threadScroll} ref={scrollRef}>
        {loading && messages.length === 0 && (
          <p className={styles.typing} role="status">
            {t('messages:loading')}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.key} className={styles.dayGroup}>
            <span className={styles.daySeparator}>
              <span>{dayLabel(group.at)}</span>
            </span>

            <ul className={styles.dayItems}>
              {group.items.map((message) => (
                <li key={message.id} className={`${styles.bubbleRow} ${message.mine ? styles.bubbleRowMine : ''}`}>
                  <div className={`${styles.bubble} ${message.mine ? styles.bubbleMine : styles.bubbleOther}`}>
                    <p className={styles.bubbleText}>{message.body}</p>
                    <span className={styles.bubbleTime}>
                      {formatClock(toEpoch(message.at), locale)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {!loading && messages.length === 0 && (
          <p className={styles.typing} role="status">
            {t('messages:empty.noMessages')}
          </p>
        )}

        {error && (
          <p className={styles.typing} role="alert">
            {error}
          </p>
        )}
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <button
          type="button"
          className={styles.attachButton}
          disabled
          title={t('messages:composer.soon')}
          aria-label={t('messages:composer.attach')}
        >
          <Paperclip size={18} aria-hidden="true" />
        </button>

        <label className={styles.composerField}>
          <span className={styles.visuallyHidden}>{t('messages:composer.placeholder')}</span>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('messages:composer.placeholder')}
            maxLength={500}
          />
        </label>

        <button type="submit" className={styles.sendButton} disabled={draft.trim().length === 0 || sending}>
          <Send size={18} aria-hidden="true" />
          <span>{t('messages:composer.send')}</span>
        </button>
      </form>
    </>
  )
}
