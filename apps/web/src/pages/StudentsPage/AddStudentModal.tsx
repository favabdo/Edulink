import { useEffect, useId, useState } from 'react'
import type { FormEvent, MouseEvent, ReactNode } from 'react'
import { CircleAlert, UserPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppData } from '../../features/sessions/DataProvider'
import { ApiError } from '../../lib/apiClient'
import type { Student } from '../../lib/data/eduStore'
import styles from './StudentsPage.module.css'

type Errors = { name: boolean; email: boolean; password: boolean }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NO_ERRORS: Errors = { name: false, email: false, password: false }

/** صلات القرابة المحفوظة في Edu_Relations.relation: 0 أب · 1 أم · 2 وصي */
const RELATIONS = [0, 1, 2] as const

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  )
}

/**
 * نافذة إضافة طالب — تكتب الحساب فعليًا في Edu_Students (POST /api/students).
 *
 * لا تُطلب المادة ولا الصف ولا المدرس: هذه قيم على الحصة لا على الحساب،
 * فتُحدَّد عند الجدولة (وإلا عرضت الواجهة بيانات لا يقرأها الخادم).
 */
function AddStudentForm({ onClose, onCreated }: { onClose: () => void; onCreated: (student: Student) => void }) {
  const { t } = useTranslation()
  const { addStudent, linkParent, parents } = useAppData()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [relation, setRelation] = useState<(typeof RELATIONS)[number]>(0)
  const [errors, setErrors] = useState<Errors>(NO_ERRORS)
  const [serverError, setServerError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: Errors = {
      name: name.trim().length < 3,
      email: !EMAIL_PATTERN.test(email.trim()),
      password: password.trim().length < 8,
    }
    setErrors(nextErrors)
    if (nextErrors.name || nextErrors.email || nextErrors.password) return

    setBusy(true)
    setServerError(null)
    try {
      const student = await addStudent({ name: name.trim(), email: email.trim(), password: password.trim() })
      if (parentId) await linkParent(parentId, student.id, relation, true)
      onCreated(student)
    } catch (e) {
      setServerError(e instanceof ApiError ? e.message : t('students:form.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <Field label={t('students:form.name')}>
        <input
          className={styles.input}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('students:form.namePlaceholder')}
          autoComplete="off"
          aria-invalid={errors.name}
          autoFocus
        />
        {errors.name && <span className={styles.error}>{t('students:form.errName')}</span>}
      </Field>

      <Field label={t('students:form.email')}>
        <input
          className={styles.input}
          type="email"
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('students:form.emailPlaceholder')}
          autoComplete="off"
          aria-invalid={errors.email}
        />
        {errors.email && <span className={styles.error}>{t('students:form.errEmail')}</span>}
      </Field>

      <Field label={t('students:form.password')}>
        <input
          className={styles.input}
          type="password"
          dir="ltr"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={t('students:form.passwordPlaceholder')}
          autoComplete="new-password"
          aria-invalid={errors.password}
        />
        {errors.password && <span className={styles.error}>{t('students:form.errPassword')}</span>}
        <span className={styles.hint}>
          <CircleAlert size={14} aria-hidden="true" />
          <span>{t('students:form.passwordNote')}</span>
        </span>
      </Field>

      <Field label={t('students:form.parentOptional')}>
        <select
          className={styles.select}
          value={parentId ?? ''}
          onChange={(event) => setParentId(event.target.value === '' ? null : Number(event.target.value))}
        >
          <option value="">{t('students:form.parentNone')}</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
      </Field>

      {parentId !== null && (
        <Field label={t('students:form.relation')}>
          <select
            className={styles.select}
            value={relation}
            onChange={(event) => setRelation(Number(event.target.value) as (typeof RELATIONS)[number])}
          >
            {RELATIONS.map((value) => (
              <option key={value} value={value}>
                {t(`parents:relation.${value === 0 ? 'father' : value === 1 ? 'mother' : 'guardian'}`)}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            <CircleAlert size={14} aria-hidden="true" />
            <span>{t('students:form.primaryNote')}</span>
          </span>
        </Field>
      )}

      {serverError && (
        <p className={styles.error} role="alert">
          {serverError}
        </p>
      )}

      <footer className={styles.modalFooter}>
        <button type="button" className={styles.secondaryButton} onClick={onClose}>
          {t('students:form.cancel')}
        </button>
        <button type="submit" className={styles.primaryButton} disabled={busy}>
          {busy ? t('common:saving') : t('students:form.submit')}
        </button>
      </footer>
    </form>
  )
}

export function AddStudentModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (student: Student) => void }) {
  const { t } = useTranslation()
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose()
  }

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className={styles.modalHeader}>
          <h2 className={styles.modalTitle} id={titleId}>
            <UserPlus size={20} aria-hidden="true" />
            <span>{t('students:form.title')}</span>
          </h2>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label={t('students:form.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <p className={styles.modalSub}>{t('students:form.subtitle')}</p>

        <AddStudentForm onClose={onClose} onCreated={onCreated} />
      </div>
    </div>
  )
}
