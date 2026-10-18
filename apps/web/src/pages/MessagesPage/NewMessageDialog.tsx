import { X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AccountKind, MessageContact } from '../../features/messages/api'
import styles from './MessagesPage.module.css'

type Props = {
  contacts: MessageContact[]
  loading: boolean
  busy: boolean
  /** رسالة خطأ الخادم (مثال: 403 «لا تملك صلاحية بدء محادثة مع هذا الحساب») */
  error: string | null
  onClose: () => void
  onCreate: (contact: MessageContact, body: string) => void
}

/** ترتيب مجموعات نوع الحساب في القائمة المنسدلة */
const KIND_ORDER: readonly AccountKind[] = ['staff', 'student', 'parent']

function groupByKind(contacts: readonly MessageContact[]): Array<{ kind: AccountKind; people: MessageContact[] }> {
  return KIND_ORDER.map((kind) => ({ kind, people: contacts.filter((contact) => contact.kind === kind) })).filter(
    (group) => group.people.length > 0,
  )
}

/** نافذة إنشاء محادثة جديدة — المستلمون من دليل الحسابات الحقيقي حسب صلاحيات الدور */
export function NewMessageDialog({ contacts, loading, busy, error, onClose, onCreate }: Props) {
  const { t } = useTranslation()
  const groups = useMemo(() => groupByKind(contacts), [contacts])
  const [pickedKey, setPickedKey] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  /** أول مستلم متاح يبقى مختارًا قبل أي تدخّل من المستخدم — بلا setState هنا */
  const firstKey = groups[0]?.people[0] ? `${groups[0].kind}:${groups[0].people[0].id}` : ''
  const contactKey = pickedKey || firstKey

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const text = body.trim()
    if (!text) return

    for (const group of groups) {
      const found = group.people.find((person) => `${group.kind}:${person.id}` === contactKey)
      if (found) {
        onCreate(found, text)
        return
      }
    }
  }

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-message-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <h2 id="new-message-title" className={styles.dialogTitle}>
            {t('messages:dialog.title')}
          </h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('messages:dialog.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form className={styles.dialogBody} onSubmit={submit}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('messages:dialog.recipient')}</span>
            <select
              className={styles.control}
              value={contactKey}
              onChange={(event) => setPickedKey(event.target.value)}
              required
              disabled={loading || groups.length === 0}
            >
              {groups.map((group) => (
                <optgroup key={group.kind} label={t(`messages:kinds.${group.kind}`)}>
                  {group.people.map((person) => (
                    <option key={`${group.kind}:${person.id}`} value={`${group.kind}:${person.id}`}>
                      {person.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {!loading && groups.length === 0 && (
            <p className={styles.typing} role="status">
              {t('messages:dialog.noContacts')}
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('messages:dialog.body')}</span>
            <textarea
              className={`${styles.control} ${styles.textarea}`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t('messages:dialog.bodyPlaceholder')}
              rows={5}
              maxLength={800}
              required
            />
          </label>

          {error && (
            <p className={styles.typing} role="alert">
              {error}
            </p>
          )}

          <footer className={styles.dialogFooter}>
            <button type="button" className={styles.ghostButton} onClick={onClose}>
              {t('messages:dialog.cancel')}
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={body.trim().length === 0 || busy || loading || groups.length === 0}
            >
              {t(busy ? 'messages:dialog.sending' : 'messages:dialog.create')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
