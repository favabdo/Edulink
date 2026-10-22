import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  CircleCheck,
  CircleX,
  ClipboardList,
  Eye,
  HeartHandshake,
  Inbox,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react'
import { studentDetailPath } from '../../app/router/paths'
import { useAuth } from '../../features/auth/authContext'
import { updateParent } from '../../features/admin/api'
import { useAppData } from '../../features/sessions/DataProvider'
import { useLanguage } from '../../i18n/useLanguage'
import {
  sessionsForStudent,
  studentById,
  studentStats,
  subjectDisplayName,
  upcoming,
  type Parent,
  type Student,
} from '../../lib/data/eduStore'
import { canManageStaff, effectiveRoleFor } from '../../lib/roles'
import styles from './ParentsPage.module.css'

// ------------------------------------------------------------------
// النماذج — الحسابات من /api/parents عبر المخزن الرطب
// ------------------------------------------------------------------

type Relation = Parent['relation']
type ParentValues = {
  name: string
  email: string
  /** رقم ولي الأمر — قناة التنبيه الأساسية؛ فارغ = لا رقم */
  phone: string
  relation: Relation
  studentIds: number[]
  /** إلزامية عند الإنشاء، واختيارية عند التعديل (تصفير كلمة المرور) */
  password: string
}
type StatusFilter = 'all' | 'active' | 'inactive'
type RelationFilter = 'all' | Relation
type FormTarget = { mode: 'create' } | { mode: 'edit'; parent: Parent }

/** إحصاءات مشتقة لكل طالب — تُعرض في درج ولي الأمر */
type ChildStat = {
  completedHours: number
  attendanceRate: number
  upcomingCount: number
}

const RELATIONS: readonly Relation[] = [0, 1, 2]
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'inactive']

/** relation رقمي في القاعدة ← مفتاح ترجمة parents:relation.* */
const RELATION_KEY: Record<Relation, 'father' | 'mother' | 'guardian'> = {
  0: 'father',
  1: 'mother',
  2: 'guardian',
}

function toPercent(rate: number): number {
  return Math.round(rate * 100)
}

function formatNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value)
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2)
  return words.map((word) => word.charAt(0)).join('')
}

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

function Avatar({ name }: { name: string }) {
  return (
    <span className={styles.avatar} aria-hidden="true">
      {initialsOf(name)}
    </span>
  )
}

function RelationPill({ relation }: { relation: Relation }) {
  const { t } = useTranslation()
  return <span className={styles.relationPill}>{t(`parents:relation.${RELATION_KEY[relation]}`)}</span>
}

function StatusPill({ active }: { active: boolean }) {
  const { t } = useTranslation()
  return (
    <span className={`${styles.pill} ${active ? styles.pillActive : styles.pillInactive}`}>
      {active ? <CircleCheck size={13} aria-hidden="true" /> : <CircleX size={13} aria-hidden="true" />}
      <span>{active ? t('parents:status.active') : t('parents:status.inactive')}</span>
    </span>
  )
}

type Kpi = { key: string; value: string; Icon: typeof Users; tint: 'blue' | 'green' | 'purple' }

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
          <span className={styles.kpiLabel}>{t(`parents:kpis.${key}`)}</span>
        </div>
      ))}
    </section>
  )
}

// ------------------------------------------------------------------
// نموذج الإضافة / التعديل
// ------------------------------------------------------------------

function ParentFormModal({
  parent,
  rows,
  studentOptions,
  busy,
  serverError,
  onSave,
  onClose,
}: {
  parent: Parent | null
  rows: Parent[]
  studentOptions: Student[]
  busy: boolean
  serverError: string | null
  onSave: (values: ParentValues) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  useDismiss(onClose)

  const [values, setValues] = useState<ParentValues>(() =>
    parent
      ? {
          name: parent.name,
          email: parent.email,
          phone: parent.phone,
          relation: parent.relation,
          studentIds: [...parent.studentIds],
          password: '',
        }
      : { name: '', email: '', phone: '', relation: 0, studentIds: [], password: '' },
  )
  const [childQuery, setChildQuery] = useState('')
  const [error, setError] = useState<'name' | 'email' | 'phone' | 'children' | 'password' | null>(null)

  function update<K extends keyof ParentValues>(key: K, value: ParentValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function toggleChild(studentId: number) {
    setValues((prev) => ({
      ...prev,
      studentIds: prev.studentIds.includes(studentId)
        ? prev.studentIds.filter((id) => id !== studentId)
        : [...prev.studentIds, studentId],
    }))
  }

  /** الولي الأساسي الحالي للطالب = ولي أمر آخر مرتبط به (غير الحساب قيد التعديل) */
  function primaryGuardianOf(studentId: number): Parent | undefined {
    return rows.find((row) => row.id !== parent?.id && row.studentIds.includes(studentId))
  }

  const needle = childQuery.trim().toLowerCase()
  const visibleStudents = needle
    ? studentOptions.filter((student) => student.name.toLowerCase().includes(needle))
    : studentOptions

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!values.name.trim()) return setError('name')
    if (!parent && !/^\S+@\S+\.\S+$/.test(values.email.trim())) return setError('email')
    if (!parent && values.password.trim().length < 8) return setError('password')
    if (parent && values.password.trim().length > 0 && values.password.trim().length < 8) return setError('password')
    if (values.studentIds.length === 0) return setError('children')
    // نفس قواعد PhoneNormalizer: أرقام مع «+» اختياري و8..15 رقمًا — والخادم يرفض الإنشاء بلا رقم
    const phone = values.phone.trim()
    if (!phone) return setError('phone')
    const phoneDigits = phone.replace(/\D/g, '')
    if (!/^\+?[\d\s().-]+$/.test(phone) || phoneDigits.length < 8 || phoneDigits.length > 15) {
      return setError('phone')
    }
    setError(null)
    onSave({
      name: values.name.trim(),
      email: values.email.trim(),
      phone,
      relation: values.relation,
      studentIds: values.studentIds,
      password: values.password.trim(),
    })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parent-form-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2 id="parent-form-title" className={styles.modalTitle}>
              {parent ? t('parents:form.editTitle') : t('parents:form.createTitle')}
            </h2>
            <p className={styles.modalDesc}>{parent ? t('parents:form.editDesc') : t('parents:form.createDesc')}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('parents:drawer.close')}
            title={t('parents:drawer.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('parents:form.name')}</span>
            <input
              className={styles.input}
              type="text"
              value={values.name}
              onChange={(event) => update('name', event.target.value)}
              autoComplete="off"
            />
            {error === 'name' && <span className={styles.errorText}>{t('parents:form.errors.name')}</span>}
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('parents:form.phone')}</span>
            <input
              className={styles.input}
              type="tel"
              dir="ltr"
              value={values.phone}
              onChange={(event) => update('phone', event.target.value)}
              autoComplete="off"
              aria-required
            />
            <span className={styles.hint}>{t('parents:form.phoneHint')}</span>
            {error === 'phone' && values.phone.trim() !== '' && (
              <span className={styles.errorText}>{t('parents:form.errors.phone')}</span>
            )}
            {error === 'phone' && values.phone.trim() === '' && (
              <span className={styles.errorText}>{t('parents:form.errors.phoneRequired')}</span>
            )}
          </label>

          <div className={styles.fieldRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t('parents:form.email')}</span>
              <input
                className={styles.input}
                type="email"
                dir="ltr"
                value={values.email}
                onChange={(event) => update('email', event.target.value)}
                disabled={Boolean(parent)}
                autoComplete="off"
              />
              {error === 'email' && <span className={styles.errorText}>{t('parents:form.errors.email')}</span>}
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                {parent ? t('parents:form.resetPassword') : t('parents:form.password')}
              </span>
              <input
                className={styles.input}
                type="password"
                dir="ltr"
                value={values.password}
                onChange={(event) => update('password', event.target.value)}
                autoComplete="new-password"
              />
              <span className={styles.hint}>
                <ShieldAlert size={13} aria-hidden="true" />
                <span>{parent ? t('parents:form.resetHint') : t('parents:form.passwordHint')}</span>
              </span>
              {error === 'password' && <span className={styles.errorText}>{t('parents:form.errors.password')}</span>}
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>{t('parents:form.relation')}</span>
            <select
              className={styles.select}
              value={values.relation}
              onChange={(event) => update('relation', Number(event.target.value) as Relation)}
            >
              {RELATIONS.map((relation) => (
                <option key={relation} value={relation}>
                  {t(`parents:relation.${RELATION_KEY[relation]}`)}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.field}>
            <div className={styles.childrenHead}>
              <span className={styles.fieldLabel}>{t('parents:form.childrenLabel')}</span>
              <span className={styles.selectedCount}>
                {t('parents:form.selectedCount', { n: values.studentIds.length })}
              </span>
            </div>
            <p className={styles.hint}>
              <ShieldAlert size={13} aria-hidden="true" />
              <span>{t('parents:form.primaryGuardianNote')}</span>
            </p>

            <label className={styles.search}>
              <Search size={16} aria-hidden="true" />
              <input
                className={styles.searchInput}
                type="search"
                value={childQuery}
                onChange={(event) => setChildQuery(event.target.value)}
                placeholder={t('parents:form.searchChildren')}
                aria-label={t('parents:form.searchChildren')}
              />
            </label>

            <ul className={styles.childrenList}>
              {visibleStudents.map((student) => {
                const checked = values.studentIds.includes(student.id)
                const guardian = primaryGuardianOf(student.id)
                return (
                  <li key={student.id}>
                    <label className={`${styles.childOption} ${checked ? styles.childOptionChecked : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleChild(student.id)}
                        className={styles.checkbox}
                      />
                      <span className={styles.childText}>
                        <span className={styles.childName}>{student.name}</span>
                        <span className={styles.childMeta}>
                          {guardian
                            ? t('parents:form.childPrimaryGuardian', { name: guardian.name })
                            : t('parents:form.childNoGuardian')}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {error === 'children' && <span className={styles.errorText}>{t('parents:form.errors.children')}</span>}
          </div>

          {serverError && (
            <p className={styles.errorText} role="alert">
              {serverError}
            </p>
          )}

          <footer className={styles.modalFooter}>
            <button type="button" className={styles.ghostButton} onClick={onClose}>
              <span>{t('parents:form.cancel')}</span>
            </button>
            <button type="submit" className={styles.primaryButton} disabled={busy}>
              <CircleCheck size={16} aria-hidden="true" />
              <span>{busy ? t('common:saving') : parent ? t('parents:form.save') : t('parents:form.create')}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// الدرج الجانبي: ملف ولي الأمر
// ------------------------------------------------------------------

function ParentDrawer({
  parent,
  stats,
  onClose,
}: {
  parent: Parent
  stats: Map<number, ChildStat>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { language } = useLanguage()
  useDismiss(onClose)

  const children = parent.studentIds
    .map((id) => studentById(id))
    .filter((student): student is NonNullable<typeof student> => student !== null)

  return (
    <div className={`${styles.overlay} ${styles.overlayDrawer}`} onClick={onClose}>
      <aside
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parent-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.drawerHeader}>
          <Avatar name={parent.name} />
          <div className={styles.drawerIdentity}>
            <p className={styles.drawerKind}>{t('parents:drawer.title')}</p>
            <h2 id="parent-drawer-title" className={styles.drawerName}>
              {parent.name}
            </h2>
            <p className={styles.drawerMeta}>{t(`parents:relation.${RELATION_KEY[parent.relation]}`)}</p>
          </div>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label={t('parents:drawer.close')}
            title={t('parents:drawer.close')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.drawerBody}>
          <p className={styles.drawerContact}>
            <span dir="ltr">{parent.email}</span>
          </p>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerSectionTitle}>
              <Users size={16} aria-hidden="true" />
              <span>{t('parents:drawer.childrenTitle')}</span>
            </h3>
            {children.length === 0 ? (
              <p className={styles.drawerEmpty}>{t('parents:drawer.noChildren')}</p>
            ) : (
              <ul className={styles.childCardList}>
                {children.map((child) => {
                  const stat = stats.get(child.id)
                  return (
                    <li key={child.id} className={styles.childCard}>
                      <div className={styles.childCardHead}>
                        <Link
                          to={studentDetailPath(child.id)}
                          className={styles.childLink}
                          aria-label={t('parents:drawer.openStudent')}
                        >
                          <span>{child.name}</span>
                          <span className={styles.childSubject}>{subjectDisplayName(child, t, 'parents:subjects')}</span>
                          <Eye size={14} aria-hidden="true" />
                        </Link>
                        {!child.active && <span className={styles.childBadge}>{t('parents:drawer.studentInactive')}</span>}
                      </div>
                      <div className={styles.childStats}>
                        <span className={styles.childStat}>
                          <span className={styles.childStatLabel}>{t('parents:drawer.completedHours')}</span>
                          <span className={styles.childStatValue}>
                            {formatNumber(stat?.completedHours ?? 0, language)}
                          </span>
                        </span>
                        <span className={styles.childStat}>
                          <span className={styles.childStatLabel}>{t('parents:drawer.attendance')}</span>
                          <span className={styles.childStatValue}>{toPercent(stat?.attendanceRate ?? 0)}%</span>
                        </span>
                        <span className={styles.childStat}>
                          <span className={styles.childStatLabel}>{t('parents:drawer.sessions')}</span>
                          <span className={styles.childStatValue}>{stat?.upcomingCount ?? 0}</span>
                        </span>
                      </div>
                      <span className={styles.progressTrack} aria-hidden="true">
                        <span
                          className={styles.progressFill}
                          style={{ width: `${toPercent(stat?.attendanceRate ?? 0)}%` }}
                        />
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerSectionTitle}>
              <ClipboardList size={16} aria-hidden="true" />
              <span>{t('parents:drawer.contactTitle')}</span>
            </h3>
            <div className={styles.contactEmpty}>
              <Inbox size={26} aria-hidden="true" />
              <p className={styles.contactEmptyTitle}>{t('parents:drawer.contactEmpty')}</p>
              <p className={styles.contactEmptyDesc}>{t('parents:drawer.contactEmptyDesc')}</p>
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

/** صفحة أولياء الأمر — المسار: /parents */
export function ParentsPage() {
  const { t } = useTranslation()
  const { language } = useLanguage()
  const { user } = useAuth()

  const canManage = canManageStaff(effectiveRoleFor(user))
  const { parents, students, sessions, loading, addParent, linkParent, unlinkParent, refresh } = useAppData()

  const rows = parents
  const [query, setQuery] = useState('')
  const [relationFilter, setRelationFilter] = useState<RelationFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [flash, setFlash] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)

  /** إحصاءات الطلاب من المخزن الرطب — تُعاد مع كل تحديث للحصص */
  const stats = useMemo(() => {
    const map = new Map<number, ChildStat>()
    for (const student of students) {
      const studentSummary = studentStats(student.id)
      map.set(student.id, {
        completedHours: studentSummary.completedHours,
        attendanceRate: studentSummary.attendanceRate,
        upcomingCount: upcoming(sessionsForStudent(student.id)).length,
      })
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, sessions])

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(timer)
  }, [flash])

  const isActive = (row: Parent) => row.studentIds.some((id) => studentById(id)?.active ?? false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (needle) {
        const haystack = `${row.name} ${row.email}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      if (relationFilter !== 'all' && row.relation !== relationFilter) return false
      if (statusFilter === 'active' && !isActive(row)) return false
      if (statusFilter === 'inactive' && isActive(row)) return false
      return true
    })
  }, [rows, query, relationFilter, statusFilter])

  const kpis = useMemo<Kpi[]>(() => {
    const linked = new Set(rows.flatMap((row) => row.studentIds))
    const unlinked = students.filter((student) => !linked.has(student.id)).length
    return [
      { key: 'total', value: formatNumber(rows.length, language), Icon: HeartHandshake, tint: 'blue' },
      { key: 'linked', value: formatNumber(linked.size, language), Icon: Users, tint: 'green' },
      { key: 'unlinked', value: formatNumber(unlinked, language), Icon: CircleX, tint: 'purple' },
    ]
  }, [rows, students, language])

  /** إنشاء/تعديل حساب ولي أمر + ربط الأبناء وفكّه — كل شيء يُكتب في القاعدة */
  async function handleSave(values: ParentValues) {
    setBusy(true)
    setFormError(null)
    try {
      if (formTarget?.mode === 'edit') {
        const { id, studentIds: before } = formTarget.parent
        await updateParent(id, {
          name: values.name,
          states: 1,
          phone: values.phone,
          ...(values.password ? { password: values.password } : {}),
        })
        const toAdd = values.studentIds.filter((studentId) => !before.includes(studentId))
        const toRemove = before.filter((studentId) => !values.studentIds.includes(studentId))
        for (const studentId of toRemove) await unlinkParent(id, studentId)
        for (const studentId of toAdd) await linkParent(id, studentId, values.relation, false)
        setFlash(t('parents:flash.updated', { name: values.name }))
      } else {
        const [firstChild, ...rest] = values.studentIds
        const parent = await addParent({
          name: values.name,
          email: values.email,
          password: values.password,
          phone: values.phone,
          studentId: firstChild,
          relation: values.relation,
        })
        for (const studentId of rest) await linkParent(parent.id, studentId, values.relation, false)
        setFlash(t('parents:flash.created', { name: values.name }))
      }
      await refresh()
      setFormTarget(null)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : t('parents:saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  function clearFilters() {
    setQuery('')
    setRelationFilter('all')
    setStatusFilter('all')
  }

  const detailParent = rows.find((row) => row.id === detailId) ?? null
  const isFiltering = query.trim() !== '' || relationFilter !== 'all' || statusFilter !== 'all'

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderText}>
          <h1 className={styles.pageTitle}>{t('parents:title')}</h1>
          <p className={styles.pageSub}>{t('parents:subtitle')}</p>
        </div>
        {canManage && (
          <button type="button" className={styles.primaryButton} onClick={() => setFormTarget({ mode: 'create' })}>
            <Plus size={18} aria-hidden="true" />
            <span>{t('parents:form.createTitle')}</span>
          </button>
        )}
      </header>

      <KpiStrip items={kpis} />

      {!canManage && (
        <p className={styles.readOnlyNote}>
          <ShieldAlert size={15} aria-hidden="true" />
          <span>{t('parents:readOnly')}</span>
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
              placeholder={t('parents:searchPlaceholder')}
              aria-label={t('parents:searchPlaceholder')}
            />
          </label>

          <label className={styles.filterSelect}>
            <span className={styles.filterLabel}>{t('parents:filters.relationLabel')}</span>
            <select
              className={styles.select}
              value={relationFilter}
              onChange={(event) =>
                setRelationFilter(event.target.value === 'all' ? 'all' : (Number(event.target.value) as Relation))
              }
            >
              <option value="all">{t('parents:filters.allRelations')}</option>
              {RELATIONS.map((relation) => (
                <option key={relation} value={relation}>
                  {t(`parents:relation.${RELATION_KEY[relation]}`)}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.pillGroup} role="group" aria-label={t('parents:filters.statusLabel')}>
            {STATUS_FILTERS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.pillOption} ${statusFilter === option ? styles.pillOptionActive : ''}`}
                onClick={() => setStatusFilter(option)}
              >
                <span>{t(`parents:status.${option}`)}</span>
              </button>
            ))}
          </div>

          {isFiltering && (
            <button type="button" className={styles.linkButton} onClick={clearFilters}>
              <X size={14} aria-hidden="true" />
              <span>{t('parents:empty.clear')}</span>
            </button>
          )}
        </div>

        <p className={styles.resultCount}>
          {t('parents:table.resultsCount', { shown: filtered.length, total: rows.length })}
        </p>

        {loading && rows.length === 0 ? (
          <p className={styles.resultCount}>{t('common:loading')}</p>
        ) : rows.length === 0 ? (
          <div className={styles.emptyState}>
            <HeartHandshake size={30} aria-hidden="true" />
            <p className={styles.emptyTitle}>{t('parents:noParents.title')}</p>
            <p className={styles.emptyDesc}>{t('parents:noParents.desc')}</p>
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('parents:table.parent')}</th>
                  <th scope="col">{t('parents:table.email')}</th>
                  <th scope="col">{t('parents:table.relation')}</th>
                  <th scope="col">{t('parents:table.children')}</th>
                  <th scope="col">{t('parents:table.status')}</th>
                  <th scope="col" className={styles.actionsHead}>
                    {t('parents:table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className={styles.emptyState}>
                        <Search size={28} aria-hidden="true" />
                        <p className={styles.emptyTitle}>{t('parents:empty.title')}</p>
                        <p className={styles.emptyDesc}>{t('parents:empty.desc')}</p>
                        <button type="button" className={styles.ghostButton} onClick={clearFilters}>
                          <span>{t('parents:empty.clear')}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr key={row.id} className={styles.row}>
                      <td>
                        <span className={styles.parentCell}>
                          <Avatar name={row.name} />
                          <span className={styles.parentText}>
                            <span className={styles.parentName}>{row.name}</span>
                            <span className={styles.parentChildCount}>
                              {t('parents:children.count', { n: row.studentIds.length })}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={styles.cellLtr} dir="ltr">
                          {row.email}
                        </span>
                      </td>
                      <td>
                        <RelationPill relation={row.relation} />
                      </td>
                      <td>
                        {row.studentIds.length === 0 ? (
                          <span className={styles.cellMuted}>{t('parents:children.none')}</span>
                        ) : (
                          <span className={styles.chips}>
                            {row.studentIds.map((studentId) => {
                              const child = studentById(studentId)
                              if (!child) return null
                              return (
                                <Link key={studentId} to={studentDetailPath(studentId)} className={styles.chip}>
                                  <span>{child.name}</span>
                                </Link>
                              )
                            })}
                          </span>
                        )}
                      </td>
                      <td>
                        <span title={isActive(row) ? t('parents:status.activeHint') : t('parents:status.inactiveHint')}>
                          <StatusPill active={isActive(row)} />
                        </span>
                      </td>
                      <td className={styles.actionsCell}>
                        <button
                          type="button"
                          className={styles.iconButton}
                          onClick={() => setDetailId(row.id)}
                          aria-label={t('parents:actions.view')}
                          title={t('parents:actions.view')}
                        >
                          <Eye size={16} aria-hidden="true" />
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            className={styles.iconButton}
                            onClick={() => setFormTarget({ mode: 'edit', parent: row })}
                            aria-label={t('parents:actions.edit')}
                            title={t('parents:actions.edit')}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formTarget && (
        <ParentFormModal
          key={formTarget.mode === 'edit' ? `edit-${formTarget.parent.id}` : 'create'}
          parent={formTarget.mode === 'edit' ? formTarget.parent : null}
          rows={rows}
          studentOptions={students}
          busy={busy}
          serverError={formError}
          onSave={handleSave}
          onClose={() => {
            setFormError(null)
            setFormTarget(null)
          }}
        />
      )}

      {detailParent && (
        <ParentDrawer parent={detailParent} stats={stats} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}
