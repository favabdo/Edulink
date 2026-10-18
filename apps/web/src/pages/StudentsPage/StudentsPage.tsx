import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { LayoutGrid, Plus, RotateCcw, Rows3, Search, Users, X } from 'lucide-react'
import { studentDetailPath } from '../../app/router/paths'
import { useAuth } from '../../features/auth/authContext'
import { ManageAccountModal } from '../../components/ManageAccountModal'
import { updateStudent } from '../../features/admin/api'
import { useAppData } from '../../features/sessions/DataProvider'
import {
  getSelfScope,
  subjectGroupKey,
  teachers,
  type Student,
} from '../../lib/data/eduStore'
import { canManageStaff, effectiveRoleFor, seesAllSchedule } from '../../lib/roles'
import { AddStudentModal } from './AddStudentModal'
import { DirectionalArrow } from './DirectionalArrow'
import { StatusPill } from './StatusPill'
import { StudentCards } from './StudentCards'
import { StudentTable } from './StudentTable'
import {
  DEFAULT_FILTERS,
  applyFilters,
  buildRow,
  filtersAreActive,
  type Filters,
  type SortKey,
  type StatusFilter,
  type StudentRow,
  type ViewMode,
} from './studentRows'
import { initialsOf, useFormatters, useLabels } from './text'
import styles from './StudentsPage.module.css'

function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: ReactNode
  title: string
  desc: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        {icon}
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      <p className={styles.emptyDesc}>{desc}</p>
      {action && (
        <button type="button" className={styles.secondaryButton} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}

/** ملف الطالب نفسه — الدور «طالب»: لا قائمة ولا فلاتر، فقط بطاقته */
function StudentSelfView() {
  const { t } = useTranslation()
  const fmt = useFormatters()
  const labels = useLabels()
  const { user } = useAuth()
  const { students } = useAppData()
  const me = students.find((student) => student.id === user?.id) ?? null

  if (!me) {
    return (
      <section className={styles.card}>
        <EmptyState
          icon={<Users size={26} aria-hidden="true" />}
          title={t('students:empty.none')}
          desc={t('students:empty.noneDesc')}
        />
      </section>
    )
  }

  return (
    <section className={styles.card}>
      <div className={styles.selfCard}>
        <span className={`${styles.avatar} ${styles.avatarXl}`} aria-hidden="true">
          {initialsOf(me.name, t('students:detail.avatarFallback'))}
        </span>
        <div className={styles.selfText}>
          <p className={styles.studentName}>{me.name}</p>
          <p className={styles.studentEmail}>{me.email}</p>
          <div className={styles.pillGroup}>
            <StatusPill active={me.active} />
            <span className={`${styles.pill} ${styles.pillNeutral}`}>{labels.grade(me.grade)}</span>
            <span className={`${styles.pill} ${styles.pillNeutral}`}>{labels.subjectOf(me)}</span>
            <span className={`${styles.pill} ${styles.pillNeutral}`}>
              {t('students:detail.joined', { date: fmt.date.format(me.joinedAt) })}
            </span>
          </div>
        </div>
        <Link to={studentDetailPath(me.id)} className={styles.primaryButton}>
          <span>{t('students:openMyProfile')}</span>
          <DirectionalArrow size={16} />
        </Link>
      </div>
    </section>
  )
}

/** صفحة الطلاب — المسار: /students (و«أبنائي» لولي الأمر) */
export function StudentsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const fmt = useFormatters()
  const labels = useLabels()
  const role = effectiveRoleFor(user)

  const { students, loading, refresh } = useAppData()

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [view, setView] = useState<ViewMode>('table')
  const [modalOpen, setModalOpen] = useState(false)
  const [manageTarget, setManageTarget] = useState<Student | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const isParent = role === 'parent'
  const canSeeAll = seesAllSchedule(role)
  const mayAdd = canManageStaff(role)

  useEffect(() => {
    if (!flash) return
    const timer = window.setTimeout(() => setFlash(null), 6000)
    return () => window.clearTimeout(timer)
  }, [flash])

  /** الإدارة ترى كل الطلاب، والمدرس طلابَ حصصه، وولي الأمر أبناءه (الخادم يرجّعهم له حصرًا) */
  const scoped = useMemo<Student[]>(() => {
    if (isParent || canSeeAll) return students
    const { teacherId } = getSelfScope()
    if (teacherId === null) return []
    return students.filter((student) => student.teacherId === teacherId)
  }, [isParent, canSeeAll, students])

  /** خيارات المادة من طلاب الخادم فعلًا — لا قائمة مواد ثابتة تُفرض على مؤسسة */
  const subjectChoices = useMemo(() => {
    const map = new Map<string, string>()
    for (const student of scoped) {
      if (student.subject === 'other' && !student.subjectText?.trim()) continue // بلا مادة بعد — لا خيار «—»
      const key = subjectGroupKey(student.subject, student.subjectText)
      if (!map.has(key)) map.set(key, labels.subjectOf(student))
    }
    return [...map.entries()]
  }, [scoped, labels])

  const rows = useMemo<StudentRow[]>(
    () => applyFilters(scoped.map((student) => buildRow(student)), filters, fmt.collator),
    [scoped, filters, fmt],
  )

  if (role === 'student') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleWrap}>
            <h1 className={styles.title}>{t('students:myProfileTitle')}</h1>
            <p className={styles.subtitle}>{t('students:myProfileText')}</p>
          </div>
        </header>
        <StudentSelfView />
      </div>
    )
  }

  const active = filtersAreActive(filters)

  const patch = (part: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...part }))
  const hasQuery = filters.query.trim() !== ''

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleWrap}>
          <h1 className={styles.title}>{t(isParent ? 'students:childrenTitle' : 'students:pageTitle')}</h1>
          <p className={styles.subtitle}>
            {t(isParent ? 'students:childrenSubtitle' : 'students:pageSubtitle')}
          </p>
        </div>
        {mayAdd && (
          <button type="button" className={styles.primaryButton} onClick={() => setModalOpen(true)}>
            <Plus size={18} aria-hidden="true" />
            <span>{t('students:addStudent')}</span>
          </button>
        )}
      </header>

      <section className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search size={16} aria-hidden="true" />
            <input
              className={styles.searchInput}
              value={filters.query}
              onChange={(event) => patch({ query: event.target.value })}
              placeholder={t('students:filters.search')}
              aria-label={t('students:filters.searchAria')}
              type="search"
            />
            {hasQuery && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => patch({ query: '' })}
                aria-label={t('students:filters.clear')}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>

          {canSeeAll && (
            <select
              className={styles.select}
              value={filters.teacherId}
              onChange={(event) =>
                patch({ teacherId: event.target.value === 'all' ? 'all' : Number(event.target.value) })
              }
              aria-label={t('students:filters.teacherAria')}
            >
              <option value="all">{t('students:filters.allTeachers')}</option>
              {teachers.map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
            </select>
          )}

          <select
            className={styles.select}
            value={filters.subject}
            onChange={(event) => patch({ subject: event.target.value })}
            aria-label={t('students:filters.subjectAria')}
          >
            <option value="all">{t('students:filters.allSubjects')}</option>
            {subjectChoices.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={filters.status}
            onChange={(event) => patch({ status: event.target.value as StatusFilter })}
            aria-label={t('students:filters.statusAria')}
          >
            <option value="all">{t('students:filters.allStatuses')}</option>
            <option value="active">{t('students:filters.active')}</option>
            <option value="inactive">{t('students:filters.inactive')}</option>
          </select>

          <select
            className={styles.select}
            value={filters.sort}
            onChange={(event) => patch({ sort: event.target.value as SortKey })}
            aria-label={t('students:filters.sortAria')}
          >
            <option value="newest">{t('students:filters.sortNewest')}</option>
            <option value="name">{t('students:filters.sortName')}</option>
            <option value="hours">{t('students:filters.sortHours')}</option>
          </select>

          <div className={styles.segmented} role="group" aria-label={t('students:view.label')}>
            <button
              type="button"
              className={`${styles.segment} ${view === 'table' ? styles.segmentActive : ''}`}
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
            >
              <Rows3 size={16} aria-hidden="true" />
              <span>{t('students:view.table')}</span>
            </button>
            <button
              type="button"
              className={`${styles.segment} ${view === 'cards' ? styles.segmentActive : ''}`}
              onClick={() => setView('cards')}
              aria-pressed={view === 'cards'}
            >
              <LayoutGrid size={16} aria-hidden="true" />
              <span>{t('students:view.cards')}</span>
            </button>
          </div>
        </div>

        <div className={styles.toolbarFoot}>
          <span className={styles.count}>{t('students:resultCount', { n: fmt.number.format(rows.length) })}</span>
          {loading && <span className={styles.scopeHint}>{t('common:loading')}</span>}

          <div className={styles.footSpacer} />

          {active && (
            <button
              type="button"
              className={styles.resetButton}
              onClick={() => {
                setFilters(DEFAULT_FILTERS)
              }}
            >
              <RotateCcw size={15} aria-hidden="true" />
              <span>{t('students:filters.reset')}</span>
            </button>
          )}
        </div>
      </section>

      {flash && (
        <p className={styles.flash} role="status">
          {flash}
        </p>
      )}

      <section className={styles.card}>
        {rows.length === 0 ? (
          <EmptyState
            icon={active ? <Search size={26} aria-hidden="true" /> : <Users size={26} aria-hidden="true" />}
            title={t(active ? 'students:empty.filtered' : 'students:empty.none')}
            desc={t(active ? 'students:empty.filteredDesc' : 'students:empty.noneDesc')}
            action={
              active
                ? {
                    label: t('students:filters.reset'),
                    onClick: () => {
                      setFilters(DEFAULT_FILTERS)
                    },
                  }
                : undefined
            }
          />
        ) : view === 'table' ? (
          <StudentTable rows={rows} onManage={mayAdd ? setManageTarget : undefined} />
        ) : (
          <StudentCards rows={rows} onManage={mayAdd ? setManageTarget : undefined} />
        )}
      </section>

      {mayAdd && (
        <AddStudentModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onCreated={(student) => {
            setModalOpen(false)
            setFlash(t('students:form.success', { name: student.name }))
          }}
        />
      )}

      {manageTarget && (
        <ManageAccountModal
          open
          accountName={manageTarget.name}
          accountEmail={manageTarget.email}
          active={manageTarget.active}
          onClose={() => setManageTarget(null)}
          onSave={async (patch) => {
            await updateStudent(manageTarget.id, {
              name: patch.name,
              states: 1,
              access: patch.active ? 1 : 0,
              ...(patch.password ? { password: patch.password } : {}),
            })
            await refresh()
            setFlash(t('students:form.updated', { name: patch.name }))
            setManageTarget(null)
          }}
        />
      )}
    </div>
  )
}
