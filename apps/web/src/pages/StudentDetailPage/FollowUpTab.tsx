import { useId, useState } from 'react'
import { BarChart3, Save, StickyNote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { studentStats, useStoreSnapshot } from '../../lib/data/eduStore'
import { useFormatters } from './text'
import styles from './StudentDetailPage.module.css'

type SavedNote = {
  id: number
  text: string
  at: Date
}

/** الملاحظات تُحفظ على هذا الجهاز فقط — لا عمود ملاحظات في Edu_Students حتى الآن */
const notesKey = (studentId: number) => `edulink:followup:${studentId}`

function readNotes(studentId: number): SavedNote[] {
  try {
    const raw = localStorage.getItem(notesKey(studentId))
    if (!raw) return []
    return (JSON.parse(raw) as { id: number; text: string; at: string }[]).map((n) => ({ ...n, at: new Date(n.at) }))
  } catch {
    return []
  }
}

function writeNotes(studentId: number, notes: SavedNote[]) {
  try {
    localStorage.setItem(notesKey(studentId), JSON.stringify(notes))
  } catch {
    /* التخزين ممتلئ أو مقفول — الملاحظات تبقى في الجلسة */
  }
}

/** تبويب «المتابعة»: رسم ساعات الأسابيع + ملاحظات المدرس (محلية) */
export function FollowUpTab({ studentId }: { studentId: number }) {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const notesId = useId()

  useStoreSnapshot()
  const stats = studentStats(studentId)
  const maxHours = Math.max(0.5, ...stats.weekly.map((week) => week.hours))

  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState<SavedNote[]>(() => readNotes(studentId))
  const [justSaved, setJustSaved] = useState(false)

  const handleSave = () => {
    const text = draft.trim()
    if (!text) return
    const next = [{ id: Date.now(), text, at: new Date() }, ...notes]
    setNotes(next)
    writeNotes(studentId, next)
    setDraft('')
    setJustSaved(true)
  }

  return (
    <div className={styles.followUp}>
      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>
            <BarChart3 size={18} aria-hidden="true" />
            <span>{t('students:followUp.chartTitle')}</span>
          </h3>
          <span className={styles.panelHint}>{t('students:followUp.chartHint')}</span>
        </header>

        <div className={styles.chart} role="img" aria-label={t('students:followUp.chartAria')}>
          {stats.weekly.map((week) => (
            <div key={week.weekStart.toISOString()} className={styles.barCol}>
              <span className={styles.barValue}>
                {fmt.number.format(week.hours)}
                <span className={styles.barUnit}>{t('students:followUp.hoursUnit')}</span>
              </span>
              <span className={styles.barTrack}>
                <span
                  className={styles.bar}
                  style={{ height: `${Math.max(4, Math.round((week.hours / maxHours) * 100))}%` }}
                />
              </span>
              <span className={styles.barLabel}>{fmt.shortDay.format(week.weekStart)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>
            <StickyNote size={18} aria-hidden="true" />
            <span>{t('students:followUp.notesTitle')}</span>
          </h3>
          <span className={styles.panelHint}>{t('students:followUp.notesHint')}</span>
        </header>

        <label className={styles.visuallyHidden} htmlFor={notesId}>
          {t('students:followUp.notesTitle')}
        </label>
        <textarea
          id={notesId}
          className={styles.textarea}
          rows={4}
          value={draft}
          placeholder={t('students:followUp.notesPlaceholder')}
          onChange={(event) => {
            setDraft(event.target.value)
            setJustSaved(false)
          }}
        />

        <div className={styles.notesActions}>
          <button type="button" className={styles.primaryButton} onClick={handleSave}>
            <Save size={16} aria-hidden="true" />
            <span>{t('students:followUp.notesSave')}</span>
          </button>
          {justSaved && (
            <span className={styles.savedNote} role="status">
              {t('students:followUp.notesSaved')}
            </span>
          )}
        </div>

        {notes.length > 0 && (
          <ul className={styles.notesList}>
            <li className={styles.notesListTitle}>{t('students:followUp.savedTitle')}</li>
            {notes.map((note) => (
              <li key={note.id} className={styles.noteItem}>
                <p className={styles.noteText}>{note.text}</p>
                <span className={styles.noteDate}>{fmt.dateTime.format(note.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
