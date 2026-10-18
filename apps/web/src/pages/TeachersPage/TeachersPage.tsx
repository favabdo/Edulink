import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Ban,
  CalendarDays,
  CircleCheck,
  CirclePause,
  CirclePlay,
  Clock,
  Eye,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  TrendingUp,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../../features/auth/authContext'
import {
  createStaffUser,
  fetchStaff,
  updateUser,
  type StaffAccount,
} from '../../features/admin/api'
import { useAppData } from '../../features/sessions/DataProvider'
import { ApiError } from '../../lib/apiClient'
import { useLanguage } from '../../i18n/useLanguage'
import {
  statsForSessions,
  studentById,
  subjectDisplayName,
  subjectGroupKey,
  upcoming,
  type ClassSession,
  type HoursStats,
  type SubjectKey,
} from '../../lib/data/eduStore'
import { canManageStaff, effectiveRoleFor, type EffectiveRole } from '../../lib/roles'
import styles from './TeachersPage.module.css'

// ------------------------------------------------------------------
// النماذج — الحسابات من /api/users، والإحصاءات من مخزن الحصص الرطب
// ------------------------------------------------------------------

type StaffRole = 'teacher' | 'supervisor' | 'manager' | 'owner'

/** أرقام الأدوار كما تخزَّن في Edu_Users.role */
const ROLE_NUMBER: Record<StaffRole, number> = { teacher: 0, supervisor: 1, manager: 2, owner: 3 }
const ROLE_NAME: Record<number, StaffRole> = { 0: 'teacher', 1: 'supervisor', 2: 'manager', 3: 'owner' }
/** طالب/ولي الأمر حسابات خارج Edu_Users — قيم سالبة حتى لا يمسّها أحد من الإدارة */
const ROLE_LADDER: Record<EffectiveRole, number> = {
  teacher: 0,
  supervisor: 1,
  manager: 2,
  owner: 3,
  student: -1,
  parent: -2,
}

type StaffMember = {
  id: number
  name: string
  email: string
  subject: SubjectKey
  subjectText?: string
  role: StaffRole
  active: boolean
}

/** قيم النموذج القابلة للحفظ فعليًا في القاعدة (لا عمود هاتف/مادة في Edu_Users) */
type StaffValues = {
  name: string
  email: string
  role: StaffRole
  active: boolean
  /** تُترك فارغة عند التعديل لتحافظ الحسابات على كلمات مرورها */
  password: string
}

type TeacherDetail = {
  stats: HoursStats
  nextSessions: ClassSession[]
  upcomingTotal: number
  monthHours: number
}

type StatusFilter = 'all' | 'active' | 'paused'
type FormTarget = { mode: 'create' } | { mode: 'edit'; member: StaffMember }
type ConfirmTarget = { member: StaffMember; nextActive: boolean }

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'paused']

const EMPTY_DETAIL: TeacherDetail = {
  stats: statsForSessions([]),
  nextSessions: [],
  upcomingTotal: 0,
  monthHours: 0,
}

/** الأدوار التي يمكن لهذا الدور إسنادُها — لا أحد يُسند دورًا مساويًا أو أعلى من دوره (نفس حارس الخادم) */
function assignableRolesFor(role: EffectiveRole): StaffRole[] {
  if (role === 'owner') return ['manager', 'supervisor', 'teacher']
  if (role === 'manager') return ['supervisor', 'teacher']
  if (role === 'supervisor') return ['teacher']
  return []
}

/** نفس حارس UsersController: المشرف يدير المدرسين، والمدير فأعلى يدير من هم أدنى منه */
function canTouchAccount(role: EffectiveRole, target: StaffRole): boolean {
  const mine = ROLE_LADDER[role]
  if (mine < ROLE_LADDER.supervisor) return false
  return target === 'teacher' || ROLE_LADDER[target] < mine
}

function hoursThisMonth(list: ClassSession[]): number {
  const now = new Date()
  return (
    list
      .filter(
        (session) =>
          session.status === 'completed' &&
          session.startsAt.getFullYear() === now.getFullYear() &&
          session.startsAt.getMonth() === now.getMonth(),
      )
      .reduce((acc, session) => acc + session.durationMin, 0) / 60
  )
}

function detailFor(teacherId: number, list: ClassSession[]): TeacherDetail {
  const mine = list.filter((session) => session.teacherId === teacherId)
  const next = upcoming(mine)
  return {
    stats: statsForSessions(mine),
    nextSessions: next.slice(0, 3),
    upcomingTotal: next.length,
    monthHours: hoursThisMonth(mine),
  }
}

function initialsOf(name: string): string {
  const words = name.replace(/^أ\.\s*/, '').trim().split(/\s+/).slice(0, 2)
  return words.map((word) => word.charAt(0)).join('')
}

/** المادة نص حر كما وردت في حصص المدرس — بلا حصة يعني شرطة، لا «أخرى» مختلقة */
function subjectLabelOf(
  member: StaffMember,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (member.subject === 'other' && !member.subjectText?.trim()) return '—'
  return subjectDisplayName(member, t, 'teachers:subjects')
}

function toPercent(rate: number): number {
  return Math.round(rate * 100)
}

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)
}

/** Escape يُغلق النوافذ والدرج الجانبي */
function useDismiss(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
}

// ------------------------------------------------------------------
// عناصر صغيرة
// ------------------------------------------------------------------

function StatusPill({ active }: { active: boolean }) {
  const { t } = useTranslation()
  return (
    <span className={`${styles.pill} ${active ? styles.pillActive : styles.pillPaused}`}>
      {active ? <CircleCheck size={13} aria-hidden="true" /> : <Ban size={13} aria-hidden="true" />}
      <span>{active ? t('teachers:status.active') : t('teachers:status.paused')}</span>
    </span>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

type Kpi = { key: string; value: string; Icon: typeof Users; tint: 'blue' | 'green' | 'purple' | 'pink' }

function KpiStrip({ items }: { items: Kpi[] }) {
  const { t } = useTranslation()
  return (
    <section className={styles.kpiGrid}>
      {items.map(({ key, value, Icon, tint }) => (
        <div key={key} className={`${styles.kpiCard} ${styles[`tint_${tint}`]}`}>
          <span className={`${styles.kpiIcon} ${styles[`icon_${tint}`]}`} aria-hidden="true">
            <Icon size={20} />
          </span>
          <span className={styles.kpiValue}>{value}</span>
          <span className={styles.kpiLabel}>{t(`teachers:kpis.${key}`)}</span>
        </div>
      ))}
    </section>
  )
}

// ------------------------------------------------------------------
// نموذج الإضافة / التعديل
// ------------------------------------------------------------------

function StaffFormModal({
  member,
  allowedRoles,
  canChangeRole,
  busy,
  serverError,
  onSave,
  onClose,
}: {
  member: StaffMember | null
  allowedRoles: StaffRole[]
  canChangeRole: boolean
  busy: boolean
  serverError: string | null
  onSave: (values: StaffValues) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  useDismiss(onClose)

  const [draft, setDraft] = useState<StaffValues>(() =>
    member
      ? { name: member.name, email: member.email, role: member.role, active: member.active, password: '' }
      : {
          name: '',
          email: '',
          role: allowedRoles[allowedRoles.length - 1] ?? 'teacher',
          active: true,
          password: '',
        },
  )
  const [error, setError] = useState<keyof StaffValues | null>(null)

  function update<K extends keyof StaffValues>(key: K, value: StaffValues[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  /** الدور الحالي غير مسموح به نظريًا (حساب دوره أعلى من دورك) — يُعرض ولا يُختار */
  const roleOptions = allowedRoles.includes(draft.role) ? allowedRoles : [draft.role, ...allowedRoles]

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.name.trim()) return setError('name')
    if (!member && !/^\S+@\S+\.\S+$/.test(draft.email.trim())) return setError('email')
    if (!member && draft.password.length < 8) return setError('password')
    if (member && draft.password.length > 0 && draft.password.length < 8) return setError('password')
    setError(null)
    onSave({
      name: draft.name.trim(),
      email: draft.email.trim(),
      role: draft.role,
      active: draft.active,
      password: draft.password,
    })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-form-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2 id="staff-form-title" className={styles.modalTitle}>
              {member ? t('teachers:form.editTitle') : t('teachers:form.createTitle')}
            </h2>
            <p className={styles.modalDesc}>{member ? t('teachers:form.editDesc') : t('teachers:form.createDesc')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('teachers:drawer.close')}
            title={t('teachers:drawer.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('teachers:form.name')}</span>
            <input
              className={styles.input}
              type="text"
              value={draft.name}
              onChange={(event) => update('name', event.target.value)}
              autoComplete="off"
            />
            {error === 'name' && <span className={styles.errorText}>{t('teachers:form.errors.name')}</span>}
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('teachers:form.email')}</span>
            <input
              className={styles.input}
              type="email"
              dir="ltr"
              value={draft.email}
              onChange={(event) => update('email', event.target.value)}
              disabled={Boolean(member)}
              autoComplete="off"
            />
            {member ? (
              <span className={styles.hint}>{t('teachers:form.emailLocked')}</span>
            ) : (
              error === 'email' && <span className={styles.errorText}>{t('teachers:form.errors.email')}</span>
            )}
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              {member ? t('teachers:form.resetPassword') : t('teachers:form.password')}
            </span>
            <input
              className={styles.input}
              type="password"
              dir="ltr"
              value={draft.password}
              onChange={(event) => update('password', event.target.value)}
              autoComplete="new-password"
            />
            <span className={styles.hint}>
              <ShieldAlert size={13} aria-hidden="true" />
              <span>{member ? t('teachers:form.resetHint') : t('teachers:form.passwordHint')}</span>
            </span>
            {error === 'password' && <span className={styles.errorText}>{t('teachers:form.errors.password')}</span>}
          </label>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('teachers:form.role')}</span>
              <select
                className={styles.select}
                value={draft.role}
                onChange={(event) => update('role', event.target.value as StaffRole)}
                disabled={!canChangeRole}
              >
                {roleOptions.map((roleOption) => (
                  <option key={roleOption} value={roleOption}>
                    {t(`teachers:roles.${roleOption}`)}
                  </option>
                ))}
              </select>
              <span className={styles.hint}>{canChangeRole ? t('teachers:form.roleHint') : t('teachers:form.roleLocked')}</span>
            </label>
          </div>

          <div className={styles.switchRow}>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => update('active', event.target.checked)}
              />
              <span className={styles.switchTrack} aria-hidden="true" />
            </label>
            <span className={styles.switchText}>
              <span className={styles.fieldLabel}>{t('teachers:form.activeLabel')}</span>
              <span className={styles.hint}>{t('teachers:form.activeHint')}</span>
            </span>
          </div>

          {serverError && (
            <p className={styles.errorText} role="alert">
              {serverError}
            </p>
          )}

          <footer className={styles.modalFooter}>
            <button type="button" className={styles.ghostButton} onClick={onClose}>
              <span>{t('teachers:form.cancel')}</span>
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              <CircleCheck size={16} aria-hidden="true" />
              <span>{busy ? t('common:saving') : member ? t('teachers:form.save') : t('teachers:form.create')}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// حوار تأكيد الإيقاف / التفعيل (semantics = access في الـ API)
// ------------------------------------------------------------------

function ConfirmDialog({
  member,
  nextActive,
  busy,
  onCancel,
  onConfirm,
}: {
  member: StaffMember
  nextActive: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  useDismiss(onCancel)

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div
        className={`${styles.modal} ${styles.confirmModal}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="staff-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className={`${styles.confirmIcon} ${nextActive ? styles.confirmSafe : styles.confirmDanger}`}>
          {nextActive ? <CirclePlay size={22} aria-hidden="true" /> : <CirclePause size={22} aria-hidden="true" />}
        </span>
        <h2 id="staff-confirm-title" className={styles.modalTitle}>
          {nextActive ? t('teachers:confirm.activateTitle') : t('teachers:confirm.pauseTitle')}
        </h2>
        <p className={styles.confirmDesc}>
          {nextActive
            ? t('teachers:confirm.activateDesc', { name: member.name })
            : t('teachers:confirm.pauseDesc', { name: member.name })}
        </p>
        <footer className={styles.modalFooter}>
          <button type="button" className={styles.ghostButton} onClick={onCancel}>
            <span>{t('teachers:confirm.cancel')}</span>
          </button>
          <button type="button" className={nextActive ? styles.primaryButton : styles.dangerButton} onClick={onConfirm} disabled={busy}>
            <span>{nextActive ? t('teachers:confirm.activateConfirm') : t('teachers:confirm.pauseConfirm')}</span>
          </button>
        </footer>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// الدرج الجانبي: ملف المدرس
// ------------------------------------------------------------------

function TeacherDrawer({
  member,
  detail,
  onClose,
}: {
  member: StaffMember
  detail: TeacherDetail
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  useDismiss(onClose)

  const sessionDate = new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const weekDate = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'numeric' })
  const maxWeekly = Math.max(1, ...detail.stats.weekly.map((week) => week.hours))

  const metrics = [
    { key: 'completedHours', value: formatNumber(detail.stats.completedHours, language) },
    { key: 'monthHours', value: formatNumber(detail.monthHours, language) },
    { key: 'attendance', value: `${toPercent(detail.stats.attendanceRate)}%` },
    { key: 'commitment', value: `${toPercent(detail.stats.commitmentRate)}%` },
    { key: 'scheduled', value: String(detail.stats.scheduled) },
    { key: 'cancelled', value: String(detail.stats.cancelled) },
  ]

  return (
    <div className={`${styles.overlay} ${styles.overlayDrawer}`} onClick={onClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="teacher-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <Avatar name={member.name} />
          <div className={styles.drawerIdentity}>
            <p className={styles.drawerKind}>{t('teachers:drawer.title')}</p>
            <h2 id="teacher-drawer-title" className={styles.drawerName}>
              {member.name}
            </h2>
            <p className={styles.drawerMeta}>
              {t(`teachers:roles.${member.role}`)} · {subjectLabelOf(member, t)}
            </p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('teachers:drawer.close')}
            title={t('teachers:drawer.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.drawerBody}>
          <p className={styles.drawerContact}>
            <span dir="ltr">{member.email}</span>
          </p>
          <div className={styles.drawerStatus}>
            <StatusPill active={member.active} />
          </div>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerSectionTitle}>
              <TrendingUp size={16} aria-hidden="true" />
              <span>{t('teachers:drawer.performance')}</span>
            </h3>
            <dl className={styles.metricGrid}>
              {metrics.map((metric) => (
                <div key={metric.key} className={styles.metric}>
                  <dt className={styles.metricLabel}>{t(`teachers:drawer.${metric.key}`)}</dt>
                  <dd className={styles.metricValue}>{metric.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerSectionTitle}>
              <CalendarDays size={16} aria-hidden="true" />
              <span>{t('teachers:drawer.upcomingTitle')}</span>
            </h3>
            {detail.nextSessions.length === 0 ? (
              <p className={styles.drawerEmpty}>{t('teachers:drawer.noUpcoming')}</p>
            ) : (
              <ul className={styles.nextList}>
                {detail.nextSessions.map((session) => (
                  <li key={session.id} className={styles.nextRow}>
                    <span className={styles.nextDate}>{sessionDate.format(session.startsAt)}</span>
                    <span className={styles.nextStudent}>
                      <Users size={14} aria-hidden="true" />
                      <span>
                        {t('teachers:drawer.withStudent', { name: studentById(session.studentId)?.name ?? '' })}
                      </span>
                    </span>
                    <span className={styles.nextDuration}>
                      <Clock size={14} aria-hidden="true" />
                      <span>{t('teachers:drawer.duration', { minutes: session.durationMin })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerSectionTitle}>
              <UserCog size={16} aria-hidden="true" />
              <span>{t('teachers:drawer.weeklyTitle')}</span>
            </h3>
            <div className={styles.bars}>
              {detail.stats.weekly.map((week) => (
                <div
                  key={week.weekStart.toISOString()}
                  className={styles.barColumn}
                  title={t('teachers:drawer.weekLabel', { date: weekDate.format(week.weekStart) })}
                >
                  <span className={styles.barTop}>{week.hours > 0 ? formatNumber(week.hours, language) : ''}</span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{ height: `${Math.max(4, (week.hours / maxWeekly) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.barLabel}>{weekDate.format(week.weekStart)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}

// ------------------------------------------------------------------
// الصفحة
// ------------------------------------------------------------------

/** صفحة المدرسين/الموظفين — المسار: /teachers */
export function TeachersPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()
  const { teachers, sessions, loading: sessionsLoading } = useAppData()

  const role = effectiveRoleFor(user)
  const canManage = canManageStaff(role)

  const [accounts, setAccounts] = useState<StaffAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [subjectFilter, setSubjectFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [flash, setFlash] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)

  /** قائمة Edu_Users — تُعاد القراءة مع كل تحديث لمخزن الحصص (حساب جديد/حصة جديدة) */
  const reload = useCallback(async () => {
    try {
      setAccounts(await fetchStaff())
    } catch (e) {
      setFlash(e instanceof ApiError ? e.message : t('teachers:loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void reload()
  }, [reload, sessions])

  /** الحساب + ما اشتقته الواجهة من حصص المدرس (المادة) */
  const staff = useMemo<StaffMember[]>(
    () =>
      accounts.map((account) => {
        const derived = teachers.find((teacher) => teacher.id === account.id)
        return {
          id: account.id,
          name: account.name || account.email,
          email: account.email,
          subject: derived?.subject ?? 'other',
          subjectText: derived?.subjectText,
          role: ROLE_NAME[account.role] ?? 'teacher',
          active: account.access === 1 && account.states === 1,
        }
      }),
    [accounts, teachers],
  )

  const details = useMemo(() => {
    const map = new Map<number, TeacherDetail>()
    for (const account of accounts) map.set(account.id, detailFor(account.id, sessions))
    return map
  }, [accounts, sessions])

  const detailOf = (id: number) => details.get(id) ?? EMPTY_DETAIL

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(timer)
  }, [flash])

  /** خيارات المادة من البيانات الفعلية فقط — المؤسسة تكتب أسماءها الحرّة */
  const subjectChoices = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of staff) {
      if (member.subject === 'other' && !member.subjectText?.trim()) continue
      const key = subjectGroupKey(member.subject, member.subjectText)
      if (!map.has(key)) map.set(key, subjectDisplayName(member, t, 'teachers:subjects'))
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], language))
  }, [staff, t, language])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return staff.filter((member) => {
      if (needle && !`${member.name} ${member.email}`.toLowerCase().includes(needle)) return false
      if (subjectFilter !== 'all' && subjectGroupKey(member.subject, member.subjectText) !== subjectFilter) return false
      if (statusFilter === 'active' && !member.active) return false
      if (statusFilter === 'paused' && member.active) return false
      return true
    })
  }, [staff, query, subjectFilter, statusFilter])

  const kpis = useMemo<Kpi[]>(() => {
    const active = staff.filter((member) => member.active)
    const monthHours = active.reduce((acc, member) => acc + (details.get(member.id)?.monthHours ?? 0), 0)
    const commitment = active.length
      ? active.reduce((acc, member) => acc + (details.get(member.id)?.stats.commitmentRate ?? 0), 0) / active.length
      : 0
    return [
      { key: 'total', value: formatNumber(staff.length, language), Icon: Users, tint: 'blue' },
      {
        key: 'activePaused',
        value: `${formatNumber(active.length, language)} / ${formatNumber(staff.length - active.length, language)}`,
        Icon: CircleCheck,
        tint: 'green',
      },
      { key: 'monthHours', value: formatNumber(monthHours, language), Icon: Clock, tint: 'purple' },
      { key: 'avgCommitment', value: `${toPercent(commitment)}%`, Icon: TrendingUp, tint: 'pink' },
    ]
  }, [staff, details, language])

  async function handleSave(values: StaffValues) {
    setBusy(true)
    setFormError(null)
    try {
      if (formTarget?.mode === 'edit') {
        await updateUser(formTarget.member.id, {
          name: values.name,
          role: ROLE_NUMBER[values.role],
          states: 1,
          access: values.active ? 1 : 0,
          ...(values.password ? { password: values.password } : {}),
        })
        setFlash(t('teachers:flash.updated', { name: values.name }))
      } else {
        await createStaffUser({
          name: values.name,
          email: values.email,
          password: values.password,
          role: ROLE_NUMBER[values.role],
        })
        setFlash(t('teachers:flash.created', { name: values.name }))
      }
      await reload()
      setFormTarget(null)
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : t('teachers:saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function handleConfirmToggle() {
    if (!confirmTarget) return
    const { member, nextActive } = confirmTarget
    setBusy(true)
    try {
      await updateUser(member.id, { states: 1, access: nextActive ? 1 : 0 })
      await reload()
      setFlash(
        nextActive
          ? t('teachers:flash.activated', { name: member.name })
          : t('teachers:flash.paused', { name: member.name }),
      )
    } catch (e) {
      setFlash(e instanceof ApiError ? e.message : t('teachers:saveFailed'))
    } finally {
      setBusy(false)
      setConfirmTarget(null)
    }
  }

  function clearFilters() {
    setQuery('')
    setSubjectFilter('all')
    setStatusFilter('all')
  }

  const detailMember = staff.find((member) => member.id === detailId) ?? null
  const isFiltering = query.trim() !== '' || subjectFilter !== 'all' || statusFilter !== 'all'

  /** نفس قواعد الخادم: لا تعديل حساب دوره مساوٍ أو أعلى، ولا تغيير دور حسابك */
  const editingMember = formTarget?.mode === 'edit' ? formTarget.member : null
  const canChangeRole =
    formTarget?.mode === 'create' ||
    Boolean(editingMember && editingMember.id !== user?.id && canTouchAccount(role, editingMember.role))

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <h1 className={styles.pageTitle}>{t('teachers:title')}</h1>
          <p className={styles.pageSub}>{t('teachers:subtitle')}</p>
        </div>
        {canManage && (
          <button type="button" className={styles.primaryButton} onClick={() => setFormTarget({ mode: 'create' })}>
            <Plus size={18} aria-hidden="true" />
            <span>{t('teachers:form.createTitle')}</span>
          </button>
        )}
      </header>

      <KpiStrip items={kpis} />

      {!canManage && (
        <p className={styles.readOnlyNote}>
          <ShieldAlert size={15} aria-hidden="true" />
          <span>{t('teachers:readOnly')}</span>
        </p>
      )}

      {flash && (
        <p className={styles.flash} role="status" aria-live="polite">
          <CircleCheck size={16} aria-hidden="true" />
          <span>{flash}</span>
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <input
              className={styles.searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('teachers:searchPlaceholder')}
              aria-label={t('teachers:searchPlaceholder')}
            />
          </label>

          <label className={styles.filterSelect}>
            <span className={styles.filterLabel}>{t('teachers:filters.subjectLabel')}</span>
            <select
              className={styles.select}
              value={subjectFilter}
              onChange={(event) => setSubjectFilter(event.target.value)}
            >
              <option value="all">{t('teachers:filters.allSubjects')}</option>
              {subjectChoices.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.pillGroup} role="group" aria-label={t('teachers:filters.statusLabel')}>
            {STATUS_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.pillOption} ${statusFilter === option ? styles.pillOptionActive : ''}`}
                onClick={() => setStatusFilter(option)}
              >
                <span>{t(`teachers:status.${option}`)}</span>
              </button>
            ))}
          </div>

          {isFiltering && (
            <button type="button" className={styles.linkButton} onClick={clearFilters}>
              <X size={14} aria-hidden="true" />
              <span>{t('teachers:empty.clear')}</span>
            </button>
          )}
        </div>

        <p className={styles.resultCount}>
          {t('teachers:table.resultsCount', { shown: rows.length, total: staff.length })}
        </p>

        {(loading || sessionsLoading) && staff.length === 0 ? (
          <p className={styles.resultCount}>{t('common:loading')}</p>
        ) : staff.length === 0 ? (
          <div className={styles.emptyState}>
            <UserCog size={30} aria-hidden="true" />
            <p className={styles.emptyTitle}>{t('teachers:noStaff.title')}</p>
            <p className={styles.emptyDesc}>{t('teachers:noStaff.desc')}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('teachers:table.staff')}</th>
                  <th scope="col">{t('teachers:table.email')}</th>
                  <th scope="col">{t('teachers:table.subject')}</th>
                  <th scope="col" className={styles.numCell}>
                    {t('teachers:table.upcoming')}
                  </th>
                  <th scope="col" className={styles.numCell}>
                    {t('teachers:table.hours')}
                  </th>
                  <th scope="col">{t('teachers:table.commitment')}</th>
                  <th scope="col">{t('teachers:table.status')}</th>
                  <th scope="col" className={styles.actionsHead}>
                    {t('teachers:table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className={styles.emptyState}>
                        <Search size={28} aria-hidden="true" />
                        <p className={styles.emptyTitle}>{t('teachers:empty.title')}</p>
                        <p className={styles.emptyDesc}>{t('teachers:empty.desc')}</p>
                        <button type="button" className={styles.ghostButton} onClick={clearFilters}>
                          <span>{t('teachers:empty.clear')}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  rows.map((member) => {
                    const detail = detailOf(member.id)
                    const commitment = toPercent(detail.stats.commitmentRate)
                    return (
                      <tr key={member.id} className={styles.row}>
                        <td>
                          <span className={styles.staffCell}>
                            <Avatar name={member.name} />
                            <span className={styles.staffText}>
                              <span className={styles.staffName}>{member.name}</span>
                              <span className={styles.staffRole}>{t(`teachers:roles.${member.role}`)}</span>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={styles.cellLtr} dir="ltr">
                            {member.email}
                          </span>
                        </td>
                        <td>{subjectLabelOf(member, t)}</td>
                        <td className={styles.numCell}>{detail.upcomingTotal}</td>
                        <td className={styles.numCell}>{formatNumber(detail.stats.completedHours, language)}</td>
                        <td>
                          <span className={styles.commitment}>
                            <span className={styles.commitmentValue}>{commitment}%</span>
                            <span className={styles.progressTrack} aria-hidden="true">
                              <span className={styles.progressFill} style={{ width: `${commitment}%` }} />
                            </span>
                          </span>
                        </td>
                        <td>
                          <StatusPill active={member.active} />
                        </td>
                        <td className={styles.actionsCell}>
                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => setDetailId(member.id)}
                            aria-label={t('teachers:actions.view')}
                            title={t('teachers:actions.view')}
                          >
                            <Eye size={16} aria-hidden="true" />
                          </button>
                          {canManage && canTouchAccount(role, member.role) && (
                            <>
                              <button
                                type="button"
                                className={styles.iconButton}
                                onClick={() => setFormTarget({ mode: 'edit', member })}
                                aria-label={t('teachers:actions.edit')}
                                title={t('teachers:actions.edit')}
                              >
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className={`${styles.iconButton} ${member.active ? styles.iconDanger : styles.iconSafe}`}
                                onClick={() => setConfirmTarget({ member, nextActive: !member.active })}
                                aria-label={member.active ? t('teachers:actions.pause') : t('teachers:actions.activate')}
                                title={member.active ? t('teachers:actions.pause') : t('teachers:actions.activate')}
                              >
                                {member.active ? (
                                  <CirclePause size={16} aria-hidden="true" />
                                ) : (
                                  <CirclePlay size={16} aria-hidden="true" />
                                )}
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formTarget && (
        <StaffFormModal
          key={formTarget.mode === 'edit' ? `edit-${formTarget.member.id}` : 'create'}
          member={formTarget.mode === 'edit' ? formTarget.member : null}
          allowedRoles={assignableRolesFor(role)}
          canChangeRole={canChangeRole}
          busy={busy}
          serverError={formError}
          onSave={handleSave}
          onClose={() => {
            setFormError(null)
            setFormTarget(null)
          }}
        />
      )}

      {confirmTarget && (
        <ConfirmDialog
          member={confirmTarget.member}
          nextActive={confirmTarget.nextActive}
          busy={busy}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={handleConfirmToggle}
        />
      )}

      {detailMember && (
        <TeacherDrawer member={detailMember} detail={detailOf(detailMember.id)} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}
