import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import {
  Atom,
  Ban,
  BookOpen,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash,
  Clock,
  FlaskConical,
  Languages,
  Microscope,
  Sigma,
  Users,
  Video,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/authContext'
import { ApiError } from '../../features/sessions/api'
import { useAppData } from '../../features/sessions/DataProvider'
import { useLanguage } from '../../i18n/useLanguage'
import {
  GRADES,
  getSelfScope,
  sessionById,
  sessions,
  studentById,
  subjectDisplayName,
  subjectOptionsFrom,
  teacherById,
  teachers,
  useStoreSnapshot,
  type ClassSession,
  type GradeKey,
  type SessionStatus,
  type SubjectKey,
} from '../../lib/data/eduStore'
import { effectiveRoleFor, seesAllSchedule, type EffectiveRole } from '../../lib/roles'
import styles from './SchedulePage.module.css'

// ============================================================
// ثوابت الشبكة والزمن
// ============================================================

/** ساعة بداية/نهاية اليوم الدراسي داخل شبكة الجدول */
const GRID_START_HOUR = 9
const GRID_END_HOUR = 20
/** ارتفاع الساعة الواحدة — يطابق calc(56 * var(--u)) في SchedulePage.module.css */
const HOUR_HEIGHT = 56
const GRID_HEIGHT = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT
const MINUTE_MS = 60_000
const SLOT_STEP_MIN = 30

/** ترتيب أيام الشبكة: من الأحد، والسبت اختياري */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

const TIME_SLOTS: string[] = (() => {
  const out: string[] = []
  for (let minutes = GRID_START_HOUR * 60; minutes <= GRID_END_HOUR * 60 - SLOT_STEP_MIN; minutes += SLOT_STEP_MIN) {
    out.push(`${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`)
  }
  return out
})()

const DURATIONS = [45, 60, 90]

type Tint = 'blue' | 'green' | 'purple' | 'pink'

const SCOPE_KEY: Record<EffectiveRole, string> = {
  owner: 'schedule:scope.all',
  manager: 'schedule:scope.all',
  supervisor: 'schedule:scope.all',
  teacher: 'schedule:scope.teacher',
  student: 'schedule:scope.student',
  parent: 'schedule:scope.parent',
}

const SUBJECT_STYLE: Record<SubjectKey, { Icon: typeof Sigma; tint: Tint }> = {
  math: { Icon: Sigma, tint: 'purple' },
  english: { Icon: Languages, tint: 'blue' },
  physics: { Icon: Atom, tint: 'green' },
  chemistry: { Icon: FlaskConical, tint: 'pink' },
  biology: { Icon: Microscope, tint: 'blue' },
  other: { Icon: BookOpen, tint: 'green' },
}

const TINT_BG: Record<Tint, string> = {
  blue: styles.tintBlue,
  green: styles.tintGreen,
  purple: styles.tintPurple,
  pink: styles.tintPink,
}

const TINT_FG: Record<Tint, string> = {
  blue: styles.iconBlue,
  green: styles.iconGreen,
  purple: styles.iconPurple,
  pink: styles.iconPink,
}

const STATUS_CHIP: Record<SessionStatus, string> = {
  completed: styles.chipCompleted,
  live: styles.chipLive,
  scheduled: styles.chipScheduled,
  cancelled: styles.chipCancelled,
  no_show: styles.chipNoShow,
}

const STATUS_BLOCK: Record<SessionStatus, string> = {
  completed: styles.blockCompleted,
  live: styles.blockLive,
  scheduled: styles.blockScheduled,
  cancelled: styles.blockCancelled,
  no_show: styles.blockNoShow,
}

const STATUS_ICON: Record<SessionStatus, typeof Sigma> = {
  completed: CheckCircle2,
  live: Video,
  scheduled: Clock,
  cancelled: Ban,
  no_show: CircleSlash,
}

// ============================================================
// الأنواع
// ============================================================

type ViewMode = 'week' | 'day'

/** حصة بعد تطبيق التعديلات وربطها بأسماء الطالب والمدرس */
type ScheduleItem = {
  id: number
  code: string
  subject: SubjectKey
  subjectText?: string
  status: SessionStatus
  startsAt: Date
  durationMin: number
  teacherId: number
  studentId: number
  studentName: string
  studentGrade: GradeKey | null
  teacherName: string
  makeupCode: string | null
  cancelReason?: string | null
}

type Positioned = { item: ScheduleItem; top: number; height: number; lane: number; lanes: number }

type DayColumn = { date: Date; items: ScheduleItem[] }

type SlotProblem = 'pastSlot' | 'endsLate' | 'teacherBusy' | 'studentBusy'
type FormProblem = SlotProblem | 'dateRequired' | 'timeRequired'

type SlotCheckInput = {
  startsAt: Date
  durationMin: number
  teacherId: number
  studentId: number
  ignoreId: number
}

type SlotChecker = (input: SlotCheckInput) => SlotProblem | null

type NewSessionInput = {
  teacherId: number
  studentId: number
  /** اسم المادة كما أدخلته الإدارة — نص حر في القاعدة */
  subject: string
  gradeKey: string
  startsAt: Date
  durationMin: number
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'details'; id: number }
  | { kind: 'cancel'; id: number }
  | { kind: 'reschedule'; id: number }
  | { kind: 'create' }

// ============================================================
// أدوات التاريخ والتنسيق (دوال خالصة)
// ============================================================

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function startOfDay(date: Date): Date {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

/** بداية الأسبوع = الأحد (نفس ترتيب جدول العمل) */
function startOfWeek(date: Date): Date {
  const copy = startOfDay(date)
  copy.setDate(copy.getDate() - copy.getDay())
  return copy
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function parseTimeSlot(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

function fromDateInputs(dateValue: string, timeValue: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  const time = parseTimeSlot(timeValue)
  if (!parts || !time) return null
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), time.hour, time.minute, 0, 0)
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function getFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  const cached = FORMATTERS.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(locale, options)
  FORMATTERS.set(key, created)
  return created
}

/**
 * العربية → `ar-EG` مع أرقام لاتينية (`-u-nu-latn`) لتظل الأرقام متسقة مع الواجهة،
 * والإنجليزية → `en-GB`. التواريخ كلها من `seed`.
 */
function useLocale(): string {
  const { language } = useLanguage()
  return language === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB'
}

function formatTime(date: Date, locale: string): string {
  return getFormatter(locale, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function formatDayNumber(date: Date, locale: string): string {
  return getFormatter(locale, { day: 'numeric' }).format(date)
}

function formatDate(date: Date, locale: string): string {
  return getFormatter(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatMonthDay(date: Date, locale: string): string {
  return getFormatter(locale, { day: 'numeric', month: 'long' }).format(date)
}

function formatDateTime(date: Date, locale: string): string {
  return `${formatDate(date, locale)} · ${formatTime(date, locale)}`
}

function toScheduleItem(session: ClassSession): ScheduleItem {
  const student = studentById(session.studentId)
  const teacher = teacherById(session.teacherId)
  const original = session.makeupOfId === null ? null : sessionById(session.makeupOfId)
  return {
    id: session.id,
    code: session.code,
    subject: session.subject,
    subjectText: session.subjectText,
    status: session.status,
    startsAt: session.startsAt,
    durationMin: session.durationMin,
    teacherId: session.teacherId,
    studentId: session.studentId,
    studentName: student?.name ?? `#${session.studentId}`,
    studentGrade: student?.grade || null,
    teacherName: teacher?.name ?? `#${session.teacherId}`,
    makeupCode: original?.code ?? null,
    cancelReason: session.cancelReason ?? null,
  }
}

/** توزيع كتل اليوم على مسارات متوازية حتى لا تتداخل الحصص المتزامنة */
function layoutDay(items: ScheduleItem[]): Positioned[] {
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  const laneEnds: number[] = []

  const placed = sorted.map((item) => {
    const start = item.startsAt.getTime()
    const end = start + item.durationMin * MINUTE_MS
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane === -1) {
      laneEnds.push(end)
      lane = laneEnds.length - 1
    } else {
      laneEnds[lane] = end
    }
    return { item, lane }
  })

  const lanes = Math.max(1, laneEnds.length)

  return placed.map(({ item, lane }) => {
    const gridStart = new Date(item.startsAt)
    gridStart.setHours(GRID_START_HOUR, 0, 0, 0)
    const offsetPx = ((item.startsAt.getTime() - gridStart.getTime()) / MINUTE_MS / 60) * HOUR_HEIGHT
    const top = Math.min(Math.max(offsetPx, 0), GRID_HEIGHT - HOUR_HEIGHT / 2)
    const rawHeight = (item.durationMin / 60) * HOUR_HEIGHT
    const height = Math.max(Math.min(rawHeight, GRID_HEIGHT - top), HOUR_HEIGHT / 2)
    return { item, top, height, lane, lanes }
  })
}

function blockStyle(placed: Positioned): CSSProperties {
  const laneWidth = `calc(100% / ${placed.lanes})`
  return {
    top: `calc(${Math.round(placed.top)} * var(--u))`,
    height: `calc(${Math.round(placed.height)} * var(--u))`,
    width: `calc(${laneWidth} - 6 * var(--u))`,
    insetInlineStart: `calc(${placed.lane} * ${laneWidth})`,
  }
}

function slotLabel(slot: string, locale: string): string {
  const time = parseTimeSlot(slot)
  if (!time) return slot
  return formatTime(new Date(2000, 0, 1, time.hour, time.minute, 0, 0), locale)
}

// ============================================================
// مكوّنات صغيرة
// ============================================================

/** السهم يتبع اتجاه اللغة: «السابق» في RTL يشير يمينًا */
function ChevronIcon({ to, size = 18 }: { to: 'prev' | 'next'; size?: number }) {
  const { language } = useLanguage()
  const rtl = language === 'ar'
  const pointsRight = (to === 'prev') === rtl
  return pointsRight ? <ChevronRight size={size} aria-hidden="true" /> : <ChevronLeft size={size} aria-hidden="true" />
}

function SubjectMark({ subject, size = 18 }: { subject: SubjectKey; size?: number }) {
  const { Icon, tint } = SUBJECT_STYLE[subject]
  return (
    <span className={`${styles.subjectIcon} ${TINT_BG[tint]} ${TINT_FG[tint]}`} aria-hidden="true">
      <Icon size={size} />
    </span>
  )
}

function StatusChip({ status }: { status: SessionStatus }) {
  const { t } = useTranslation()
  const Icon = STATUS_ICON[status]
  return (
    <span className={`${styles.chip} ${STATUS_CHIP[status]}`}>
      <Icon size={14} aria-hidden="true" />
      <span>{t(`schedule:status.${status}`)}</span>
    </span>
  )
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <CalendarDays size={26} />
      </span>
      <p className={styles.emptyTitle}>{title}</p>
      {hint && <p className={styles.emptyHint}>{hint}</p>}
    </div>
  )
}

type DialogProps = {
  variant: 'center' | 'drawer'
  title: string
  onClose: () => void
  children: ReactNode
}

/** قشرة واحدة لكل الحوارات: Escape يُغلق، والخلفية تُغلق، وaria-modal + تركيز أولي */
function Dialog({ variant, title, onClose, children }: DialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  return (
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${styles.panel} ${variant === 'drawer' ? styles.panelDrawer : styles.panelCenter}`}
      >
        <header className={styles.panelHead}>
          <h2 id={titleId} className={styles.panelTitle}>
            {title}
          </h2>
          <button type="button" className={styles.panelClose} onClick={onClose} aria-label={t('schedule:actions.close')}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

// ============================================================
// العرض الأسبوعي والقوائم
// ============================================================

type SessionBlockViewProps = {
  placed: Positioned
  dayLabel: string
  showTeacher: boolean
  locale: string
  onOpen: (id: number) => void
}

function SessionBlockView({ placed, dayLabel, showTeacher, locale, onOpen }: SessionBlockViewProps) {
  const { t } = useTranslation()
  const { item } = placed
  const endsAt = new Date(item.startsAt.getTime() + item.durationMin * MINUTE_MS)

  return (
    <button
      type="button"
      className={`${styles.block} ${STATUS_BLOCK[item.status]}`}
      style={blockStyle(placed)}
      onClick={() => onOpen(item.id)}
      aria-label={t('schedule:aria.block', {
        student: item.studentName,
        day: dayLabel,
        time: formatTime(item.startsAt, locale),
        status: t(`schedule:status.${item.status}`),
      })}
    >
      <span className={styles.blockTime}>
        {t('schedule:timeRange', { from: formatTime(item.startsAt, locale), to: formatTime(endsAt, locale) })}
      </span>
      <span className={styles.blockStudent}>{item.studentName}</span>
      <span className={styles.blockSubject}>
        {showTeacher ? item.teacherName : subjectDisplayName(item, t, 'dashboard:subjects')}
      </span>
      {item.makeupCode && <span className={styles.blockMakeup}>{t('schedule:makeupOf', { code: item.makeupCode })}</span>}
    </button>
  )
}

type WeekGridProps = {
  columns: DayColumn[]
  showTeacher: boolean
  onOpen: (id: number) => void
  onPickDay: (date: Date) => void
}

function WeekGrid({ columns, showTeacher, onOpen, onPickDay }: WeekGridProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const today = startOfDay(new Date())

  const hourMarks = useMemo(
    () =>
      Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, index) => {
        const date = new Date()
        date.setHours(GRID_START_HOUR + index, 0, 0, 0)
        return date
      }),
    [],
  )

  const template = `calc(64 * var(--u)) repeat(${columns.length}, minmax(calc(128 * var(--u)), 1fr))`

  const now = new Date()
  const nowOffset =
    now.getHours() >= GRID_START_HOUR && now.getHours() < GRID_END_HOUR
      ? (now.getHours() + now.getMinutes() / 60 - GRID_START_HOUR) * HOUR_HEIGHT
      : null

  return (
    <div className={styles.gridScroll} role="group" aria-label={t('schedule:aria.weekGrid')}>
      <div className={styles.grid} style={{ gridTemplateColumns: template }}>
        <div className={styles.corner} aria-hidden="true" />

        {columns.map(({ date }) => (
          <button
            key={date.getTime()}
            type="button"
            className={`${styles.dayHead} ${sameDay(date, today) ? styles.dayHeadToday : ''}`}
            onClick={() => onPickDay(date)}
          >
            <span className={styles.dayHeadName}>{t(`schedule:days.${DAY_KEYS[date.getDay()]}`)}</span>
            <span className={styles.dayHeadNum}>{formatDayNumber(date, locale)}</span>
          </button>
        ))}

        <div className={styles.timeCol}>
          {hourMarks.map((hour) => (
            <div key={hour.getTime()} className={styles.timeCell}>
              {formatTime(hour, locale)}
            </div>
          ))}
        </div>

        {columns.map(({ date, items }) => {
          const isToday = sameDay(date, today)
          const dayLabel = `${t(`schedule:days.${DAY_KEYS[date.getDay()]}`)} ${formatDayNumber(date, locale)}`
          return (
            <div key={date.getTime()} className={`${styles.dayCol} ${isToday ? styles.dayColToday : ''}`}>
              {hourMarks.map((hour) => (
                <div key={hour.getTime()} className={styles.hourCell} />
              ))}

              {isToday && nowOffset !== null && (
                <div className={styles.nowLine} style={{ top: `calc(${Math.round(nowOffset)} * var(--u))` }}>
                  <span className={styles.nowDot} aria-hidden="true" />
                </div>
              )}

              {layoutDay(items).map((placed) => (
                <SessionBlockView
                  key={placed.item.id}
                  placed={placed}
                  dayLabel={dayLabel}
                  showTeacher={showTeacher}
                  locale={locale}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type SessionListProps = {
  items: ScheduleItem[]
  showTeacher: boolean
  onOpen: (id: number) => void
}

/** قائمة الحصص — للعرض اليومي وللوحة الشاشات الصغيرة */
function SessionList({ items, showTeacher, onOpen }: SessionListProps) {
  const { t } = useTranslation()
  const locale = useLocale()

  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const endsAt = new Date(item.startsAt.getTime() + item.durationMin * MINUTE_MS)
        return (
          <li key={item.id} className={styles.listItem}>
            <button type="button" className={styles.listRow} onClick={() => onOpen(item.id)}>
              <span className={styles.listTime}>
                {t('schedule:timeRange', { from: formatTime(item.startsAt, locale), to: formatTime(endsAt, locale) })}
              </span>

              <SubjectMark subject={item.subject} />

              <span className={styles.listMain}>
                <span className={styles.listTitle}>{item.studentName}</span>
                <span className={styles.listMeta}>
                  {subjectDisplayName(item, t, 'dashboard:subjects')}
                  {showTeacher ? ` · ${item.teacherName}` : ''}
                  {item.studentGrade ? ` · ${t(`schedule:grades.${item.studentGrade}`)}` : ''}
                  {` · ${t('schedule:durationMinutes', { n: item.durationMin })}`}
                </span>
              </span>

              <span className={styles.listExtra}>
                {item.makeupCode && (
                  <span className={styles.makeupChip}>{t('schedule:makeupOf', { code: item.makeupCode })}</span>
                )}
                <StatusChip status={item.status} />
                <span className={styles.listCode}>{item.code}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ============================================================
// تفاصيل الحصة + الحوارات
// ============================================================

type DetailsDrawerProps = {
  item: ScheduleItem
  canManage: boolean
  onClose: () => void
  onCancel: (id: number) => void
  onReschedule: (id: number) => void
  onFinish: (id: number) => void
}

function DetailsDrawer({ item, canManage, onClose, onCancel, onReschedule, onFinish }: DetailsDrawerProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const endsAt = new Date(item.startsAt.getTime() + item.durationMin * MINUTE_MS)
  const isDone = item.status === 'completed'
  const isOpen = item.status === 'scheduled' || item.status === 'live'

  return (
    <Dialog variant="drawer" title={t('schedule:details.title')} onClose={onClose}>
      <div className={styles.panelBody}>
        <div className={styles.panelActions}>
          <StatusChip status={item.status} />
        </div>

        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.code')}</span>
            <span className={styles.rowValue}>{item.code}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.student')}</span>
            <span className={styles.rowValue}>{item.studentName}</span>
          </div>
          {item.studentGrade && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>{t('schedule:labels.grade')}</span>
              <span className={styles.rowValue}>{t(`schedule:grades.${item.studentGrade}`)}</span>
            </div>
          )}
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.teacher')}</span>
            <span className={styles.rowValue}>{item.teacherName}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.subject')}</span>
            <span className={styles.rowValue}>{subjectDisplayName(item, t, 'dashboard:subjects')}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.date')}</span>
            <span className={styles.rowValue}>
              {`${t(`schedule:days.${DAY_KEYS[item.startsAt.getDay()]}`)} · ${formatDate(item.startsAt, locale)}`}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.time')}</span>
            <span className={styles.rowValue}>
              {t('schedule:timeRange', { from: formatTime(item.startsAt, locale), to: formatTime(endsAt, locale) })}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('schedule:labels.duration')}</span>
            <span className={styles.rowValue}>{t('schedule:durationMinutes', { n: item.durationMin })}</span>
          </div>
        </div>

        {item.makeupCode && <p className={styles.note}>{t('schedule:makeupOf', { code: item.makeupCode })}</p>}
        {item.cancelReason && (
          <p className={styles.note}>{t('schedule:cancelReason', { reason: item.cancelReason })}</p>
        )}

        {canManage && (
          <div className={styles.panelActions}>
            {isOpen && (
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} onClick={() => onCancel(item.id)}>
                <Ban size={16} aria-hidden="true" />
                {t('schedule:actions.cancel')}
              </button>
            )}
            {!isDone && (
              <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={() => onReschedule(item.id)}>
                <CalendarClock size={16} aria-hidden="true" />
                {t('schedule:actions.reschedule')}
              </button>
            )}
            {isOpen && (
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => onFinish(item.id)}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {t('schedule:actions.finish')}
              </button>
            )}
          </div>
        )}

      </div>
    </Dialog>
  )
}

type CancelDialogProps = {
  item: ScheduleItem
  onClose: () => void
  onBack: () => void
  onConfirm: (id: number, reason: string) => void
}

function CancelDialog({ item, onClose, onBack, onConfirm }: CancelDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const reasonId = useId()
  const [reason, setReason] = useState('')

  return (
    <Dialog variant="center" title={t('schedule:cancelDialog.title')} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          onConfirm(item.id, reason.trim())
        }}
      >
        <p className={styles.hint}>
          {`${item.code} · ${subjectDisplayName(item, t, 'dashboard:subjects')} · ${item.studentName}`}
        </p>
        <p className={styles.hint}>{formatDateTime(item.startsAt, locale)}</p>
        <p className={styles.hint}>{t('schedule:cancelDialog.hint')}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={reasonId}>
            {t('schedule:labels.reason')}
          </label>
          <textarea
            id={reasonId}
            className={styles.textarea}
            value={reason}
            placeholder={t('schedule:cancelDialog.reasonPlaceholder')}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        <div className={styles.panelActions}>
          <button type="submit" className={`${styles.btn} ${styles.btnDanger}`}>
            <Ban size={16} aria-hidden="true" />
            {t('schedule:actions.confirmCancel')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack}>
            {t('schedule:actions.back')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

type RescheduleDialogProps = {
  item: ScheduleItem
  checkSlot: SlotChecker
  onClose: () => void
  onBack: () => void
  onConfirm: (id: number, startsAt: Date) => void
}

function RescheduleDialog({ item, checkSlot, onClose, onBack, onConfirm }: RescheduleDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const dateId = useId()
  const timeId = useId()

  const [dateValue, setDateValue] = useState(() => toDateInputValue(item.startsAt))
  const [timeValue, setTimeValue] = useState(() => `${pad2(item.startsAt.getHours())}:${pad2(item.startsAt.getMinutes())}`)
  const [error, setError] = useState<FormProblem | null>(null)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dateValue) {
      setError('dateRequired')
      return
    }
    if (!timeValue) {
      setError('timeRequired')
      return
    }
    const startsAt = fromDateInputs(dateValue, timeValue)
    if (!startsAt) {
      setError('timeRequired')
      return
    }
    const problem = checkSlot({
      startsAt,
      durationMin: item.durationMin,
      teacherId: item.teacherId,
      studentId: item.studentId,
      ignoreId: item.id,
    })
    setError(problem)
    if (problem) return
    onConfirm(item.id, startsAt)
  }

  const timeValueIsValid = TIME_SLOTS.includes(timeValue)

  return (
    <Dialog variant="center" title={t('schedule:rescheduleDialog.title')} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className={styles.hint}>
          {`${item.code} · ${subjectDisplayName(item, t, 'dashboard:subjects')} · ${item.studentName}`}
        </p>
        <p className={styles.hint}>
          {t('schedule:rescheduleDialog.current', { when: formatDateTime(item.startsAt, locale) })}
        </p>
        <p className={styles.hint}>{t('schedule:rescheduleDialog.hint')}</p>

        {error && (
          <p className={styles.formError} role="alert">
            {t(`schedule:errors.${error}`)}
          </p>
        )}

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={dateId}>
              {t('schedule:labels.date')}
            </label>
            <input
              id={dateId}
              className={styles.input}
              type="date"
              value={dateValue}
              min={toDateInputValue(startOfDay(new Date()))}
              data-invalid={error === 'pastSlot' || error === 'dateRequired' ? 'true' : 'false'}
              onChange={(event) => {
                setDateValue(event.target.value)
                setError(null)
              }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={timeId}>
              {t('schedule:labels.time')}
            </label>
            <select
              id={timeId}
              className={styles.select}
              value={timeValueIsValid ? timeValue : ''}
              onChange={(event) => {
                setTimeValue(event.target.value)
                setError(null)
              }}
            >
              <option value="">{t('schedule:labels.pickTime')}</option>
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slotLabel(slot, locale)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.panelActions}>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            <CalendarClock size={16} aria-hidden="true" />
            {t('schedule:actions.confirmReschedule')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onBack}>
            {t('schedule:actions.back')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

type CreateDialogProps = {
  /** null حين لا يوجد مدرس بعد — الحقل يبقى فارغًا ويُتحقق عند الإرسال */
  defaultTeacherId: number | null
  checkSlot: SlotChecker
  onClose: () => void
  onCreate: (input: NewSessionInput) => void
}

function CreateDialog({ defaultTeacherId, checkSlot, onClose, onCreate }: CreateDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const teacherFieldId = useId()
  const studentFieldId = useId()
  const dateId = useId()
  const timeId = useId()
  const durationId = useId()

  const [teacherValue, setTeacherValue] = useState(defaultTeacherId === null ? '' : String(defaultTeacherId))
  const [studentValue, setStudentValue] = useState('')
  const [subjectValue, setSubjectValue] = useState(
    () => (defaultTeacherId === null ? '' : (teacherById(defaultTeacherId)?.subjectText ?? '')),
  )
  const [gradeValue, setGradeValue] = useState<string>('g7')
  const [dateValue, setDateValue] = useState(() => toDateInputValue(new Date()))
  const [timeValue, setTimeValue] = useState(TIME_SLOTS[0])
  const [durationValue, setDurationValue] = useState(String(DURATIONS[1]))
  const [error, setError] = useState<FormProblem | 'teacherRequired' | 'studentRequired' | 'subjectRequired' | null>(null)

  const teacherId = Number(teacherValue)
  // الطالب يدرس لمدرسين متعددين حسب المادة — القائمة لا تُصفَّى بالمدرس
  const store = useStoreSnapshot()
  const options = useMemo(
    () => store.students.filter((student) => student.active).sort((a, b) => a.name.localeCompare(b.name)),
    [store],
  )
  /** اقتراحات المادة من حصص الخادم فعلًا — لا قائمة مواد ثابتة تُفرض على مؤسسة */
  const subjectSuggestions = useMemo(() => subjectOptionsFrom(store.sessions), [store])
  const subjectId = useId()
  const gradeId = useId()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!teacherValue) {
      setError('teacherRequired')
      return
    }
    if (!studentValue) {
      setError('studentRequired')
      return
    }
    if (!dateValue) {
      setError('dateRequired')
      return
    }
    if (!timeValue) {
      setError('timeRequired')
      return
    }
    if (!subjectValue.trim()) {
      setError('subjectRequired')
      return
    }
    const startsAt = fromDateInputs(dateValue, timeValue)
    if (!startsAt) {
      setError('dateRequired')
      return
    }

    const durationMin = Number(durationValue)
    const problem = checkSlot({
      startsAt,
      durationMin,
      teacherId,
      studentId: Number(studentValue),
      ignoreId: -1,
    })
    setError(problem)
    if (problem) return

    onCreate({
      teacherId,
      studentId: Number(studentValue),
      subject: subjectValue.trim(),
      gradeKey: gradeValue,
      startsAt,
      durationMin,
    })
  }

  return (
    <Dialog variant="center" title={t('schedule:createDialog.title')} onClose={onClose}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <p className={styles.hint}>{t('schedule:createDialog.hint')}</p>

        {error && (
          <p className={styles.formError} role="alert">
            {t(`schedule:errors.${error}`)}
          </p>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={teacherFieldId}>
            {t('schedule:labels.teacher')}
          </label>
          <select
            id={teacherFieldId}
            className={styles.select}
            value={teacherValue}
            onChange={(event) => {
              setTeacherValue(event.target.value)
              setStudentValue('')
              setError(null)
            }}
          >
            <option value="">{t('schedule:createDialog.teacherPlaceholder')}</option>
            {teachers
              .filter((teacher) => teacher.active)
              .map((teacher) => (
                <option key={teacher.id} value={teacher.id}>
                  {teacher.name}
                </option>
              ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={studentFieldId}>
            {t('schedule:labels.student')}
          </label>
          <select
            id={studentFieldId}
            className={styles.select}
            value={studentValue}
            disabled={options.length === 0}
            onChange={(event) => {
              setStudentValue(event.target.value)
              const picked = studentById(Number(event.target.value))
              if (picked?.grade) setGradeValue(picked.grade)
              setError(null)
            }}
          >
            <option value="">
              {options.length === 0 ? t('schedule:empty.noStudents') : t('schedule:createDialog.studentPlaceholder')}
            </option>
            {options.map((student) => (
              <option key={student.id} value={student.id}>
                {student.grade ? `${student.name} · ${t(`schedule:grades.${student.grade}`)}` : student.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={subjectId}>
              {t('schedule:labels.subject')}
            </label>
            <input
              id={subjectId}
              className={styles.input}
              type="text"
              value={subjectValue}
              list="schedule-subject-suggestions"
              placeholder={t('schedule:createDialog.subjectPlaceholder')}
              data-invalid={error === 'subjectRequired' ? 'true' : 'false'}
              onChange={(event) => {
                setSubjectValue(event.target.value)
                setError(null)
              }}
            />
            <datalist id="schedule-subject-suggestions">
              {subjectSuggestions.map((option) => (
                <option
                  key={option.key}
                  value={option.subject === 'other' ? (option.subjectText ?? option.key) : t(`dashboard:subjects.${option.subject}`)}
                />
              ))}
            </datalist>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={gradeId}>
              {t('schedule:labels.grade')}
            </label>
            <select
              id={gradeId}
              className={styles.select}
              value={gradeValue}
              onChange={(event) => setGradeValue(event.target.value)}
            >
              {GRADES.map((key) => (
                <option key={key} value={key}>
                  {t(`schedule:grades.${key}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={dateId}>
              {t('schedule:labels.date')}
            </label>
            <input
              id={dateId}
              className={styles.input}
              type="date"
              value={dateValue}
              min={toDateInputValue(startOfDay(new Date()))}
              data-invalid={error === 'pastSlot' || error === 'dateRequired' ? 'true' : 'false'}
              onChange={(event) => {
                setDateValue(event.target.value)
                setError(null)
              }}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={timeId}>
              {t('schedule:labels.time')}
            </label>
            <select
              id={timeId}
              className={styles.select}
              value={TIME_SLOTS.includes(timeValue) ? timeValue : ''}
              onChange={(event) => {
                setTimeValue(event.target.value)
                setError(null)
              }}
            >
              <option value="">{t('schedule:labels.pickTime')}</option>
              {TIME_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {slotLabel(slot, locale)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={durationId}>
            {t('schedule:labels.duration')}
          </label>
          <select
            id={durationId}
            className={styles.select}
            value={durationValue}
            onChange={(event) => {
              setDurationValue(event.target.value)
              setError(null)
            }}
          >
            {DURATIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t('schedule:durationMinutes', { n: minutes })}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.panelActions}>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
            <CalendarPlus size={16} aria-hidden="true" />
            {t('schedule:actions.create')}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            {t('schedule:actions.close')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

// ============================================================
// الصفحة
// ============================================================

/** على الشاشات الضيقة تتحول الشبكة إلى قائمة قابلة للتمرير */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 720px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 720px)')
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return narrow
}

/** المسار: /schedule */
export function SchedulePage() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const locale = useLocale()
  const isNarrow = useIsNarrow()

  const role = effectiveRoleFor(user)
  const seesAll = seesAllSchedule(role)
  /** الجدولة قرار إداري (مشرف فأعلى) — المدرس يُنفّذ حصصه فقط */
  const canManage = seesAll

  const [view, setView] = useState<ViewMode>('week')
  const [cursor, setCursor] = useState<Date>(() => new Date())
  const [showSaturday, setShowSaturday] = useState(false)
  const [teacherFilter, setTeacherFilter] = useState('all')
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })
  const [notice, setNotice] = useState<string | null>(null)

  const { addSession, cancelSessionAction, endSessionAction, rescheduleSessionAction } = useAppData()
  const [busy, setBusy] = useState(false)

  /** لقطة المخزن تتغير عند وصول بيانات الخادم — بلا إعادة تركيب للصفحة */
  const store = useStoreSnapshot()

  const scopedSeed = useMemo((): ClassSession[] => {
    const self = getSelfScope()
    if (role === 'teacher')
      return self.teacherId === null ? [] : store.sessions.filter((session) => session.teacherId === self.teacherId)
    if (role === 'student')
      return self.studentId === null ? [] : store.sessions.filter((session) => session.studentId === self.studentId)
    if (role === 'parent') {
      const children = new Set(
        self.parentId === null ? [] : (store.parents.find((parent) => parent.id === self.parentId)?.studentIds ?? []),
      )
      return store.sessions.filter((session) => children.has(session.studentId))
    }
    return store.sessions
  }, [store, role])

  /** كل الحصص بعد التعديلات — لفحص التعارضات (قد يطال الطالب مدرسًا خارج النطاق) */
  const allResolved = sessions

  const activeFilter = seesAll ? teacherFilter : 'all'

  const items = useMemo<ScheduleItem[]>(() => {
    const list = scopedSeed
      .filter((session) => activeFilter === 'all' || session.teacherId === Number(activeFilter))
      .map(toScheduleItem)
    return list.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
  }, [scopedSeed, activeFilter])

  const weekStart = useMemo(() => startOfWeek(cursor), [cursor])
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])

  const columns = useMemo<DayColumn[]>(() => {
    const dayCount = showSaturday ? 7 : 6
    return Array.from({ length: dayCount }, (_, index) => {
      const date = addDays(weekStart, index)
      return { date, items: items.filter((item) => sameDay(item.startsAt, date)) }
    })
  }, [weekStart, showSaturday, items])

  const inWeek = useMemo(
    () => items.filter((item) => item.startsAt >= weekStart && item.startsAt < weekEnd),
    [items, weekStart, weekEnd],
  )

  const dayItems = useMemo(() => items.filter((item) => sameDay(item.startsAt, cursor)), [items, cursor])

  const stats = useMemo(() => {
    const today = startOfDay(new Date())
    return {
      today: items.filter((item) => sameDay(item.startsAt, today)).length,
      week: inWeek.length,
      cancelled: inWeek.filter((item) => item.status === 'cancelled').length,
      completed: inWeek.filter((item) => item.status === 'completed').length,
    }
  }, [items, inWeek])

  const checkSlot = useCallback<SlotChecker>(
    ({ startsAt, durationMin, teacherId, studentId, ignoreId }) => {
      const start = startsAt.getTime()
      const end = start + durationMin * MINUTE_MS
      if (start < Date.now()) return 'pastSlot'

      const endDate = new Date(end)
      const endMinutes = sameDay(endDate, startsAt) ? endDate.getHours() * 60 + endDate.getMinutes() : 0
      if (endMinutes === 0 || endMinutes > GRID_END_HOUR * 60) return 'endsLate'

      const overlaps = (session: ClassSession) => {
        if (session.id === ignoreId || session.status === 'cancelled') return false
        const otherStart = session.startsAt.getTime()
        return otherStart < end && start < otherStart + session.durationMin * MINUTE_MS
      }

      if (allResolved.some((session) => overlaps(session) && session.teacherId === teacherId)) return 'teacherBusy'
      if (allResolved.some((session) => overlaps(session) && session.studentId === studentId)) return 'studentBusy'
      return null
    },
    [allResolved],
  )

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 7000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const closeDialog = useCallback(() => setDialog({ kind: 'none' }), [])
  const openSession = useCallback((id: number) => setDialog({ kind: 'details', id }), [])

  const move = useCallback(
    (direction: 1 | -1) => setCursor((current) => addDays(current, direction * (view === 'week' ? 7 : 1))),
    [view],
  )

  const runAction = useCallback(
    async (done: string, action: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await action()
        setNotice(done)
        setDialog({ kind: 'none' })
      } catch (e) {
        setNotice(e instanceof ApiError ? e.message : t('schedule:actionFailed'))
      } finally {
        setBusy(false)
      }
    },
    [t],
  )

  const handleCancel = useCallback(
    (id: number, reason: string) => {
      const target = items.find((item) => item.id === id)
      void runAction(t('schedule:results.cancelled', { code: target?.code ?? '' }), () =>
        cancelSessionAction(id, reason),
      )
    },
    [cancelSessionAction, items, runAction, t],
  )

  const handleFinish = useCallback(
    (id: number) => {
      const target = items.find((item) => item.id === id)
      void runAction(t('schedule:results.finished', { code: target?.code ?? '' }), () =>
        endSessionAction(id, target?.durationMin ?? 45),
      )
    },
    [endSessionAction, items, runAction, t],
  )

  const handleReschedule = useCallback(
    (id: number, startsAt: Date) => {
      const target = items.find((item) => item.id === id)
      void runAction(
        t('schedule:results.rescheduled', { code: target?.code ?? '', when: formatDateTime(startsAt, locale) }),
        () => rescheduleSessionAction(id, startsAt),
      )
      setCursor(startsAt)
    },
    [items, locale, rescheduleSessionAction, runAction, t],
  )

  const handleCreate = useCallback(
    (input: NewSessionInput) => {
      void runAction('', async () => {
        const created = await addSession(input)
        setCursor(created.startsAt)
        setNotice(t('schedule:results.created', { code: created.code }))
      })
    },
    [addSession, runAction, t],
  )

  const dialogItem =
    dialog.kind === 'details' || dialog.kind === 'cancel' || dialog.kind === 'reschedule'
      ? (items.find((item) => item.id === dialog.id) ?? null)
      : null

  const weekEndLabel = addDays(weekStart, showSaturday ? 6 : 5)
  const rangeLabel =
    view === 'week'
      ? t('schedule:timeRange', { from: formatMonthDay(weekStart, locale), to: formatMonthDay(weekEndLabel, locale) })
      : `${t(`schedule:days.${DAY_KEYS[cursor.getDay()]}`)} · ${formatDate(cursor, locale)}`

  const statCards = [
    { key: 'today', value: stats.today, Icon: CalendarDays, tint: 'blue' as Tint },
    { key: 'week', value: stats.week, Icon: Clock, tint: 'purple' as Tint },
    { key: 'cancelled', value: stats.cancelled, Icon: Ban, tint: 'pink' as Tint },
    { key: 'completed', value: stats.completed, Icon: CheckCircle2, tint: 'green' as Tint },
  ]

  const weekGroups = columns.filter((column) => column.items.length > 0)

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.pageTitle}>
            <CalendarDays size={22} aria-hidden="true" />
            <span>{t('schedule:pageTitle')}</span>
          </h1>
          <p className={styles.pageSub}>
            {canManage
              ? t('schedule:pageSubtitle')
              : role === 'teacher'
                ? t('schedule:pageSubtitleTeacher')
                : t('schedule:pageSubtitleFamily')}
          </p>
          <span className={styles.scopePill}>
            <Users size={14} aria-hidden="true" />
            <span>{t(SCOPE_KEY[role])}</span>
          </span>
        </div>

        {canManage && (
          <div className={styles.headActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setDialog({ kind: 'create' })}
            >
              <CalendarPlus size={17} aria-hidden="true" />
              <span>{t('schedule:add')}</span>
            </button>
          </div>
        )}
      </header>

      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup} role="group" aria-label={t('schedule:aria.nav')}>
          <div className={styles.navGroup}>
            <button type="button" className={styles.navBtn} onClick={() => move(-1)}>
              <ChevronIcon to="prev" />
              <span>{t('schedule:nav.prev')}</span>
            </button>
            <button type="button" className={styles.navBtn} onClick={() => setCursor(new Date())}>
              <span>{t('schedule:nav.today')}</span>
            </button>
            <button type="button" className={styles.navBtn} onClick={() => move(1)}>
              <span>{t('schedule:nav.next')}</span>
              <ChevronIcon to="next" />
            </button>
          </div>

          <p className={styles.rangeLabel}>{rangeLabel}</p>
        </div>

        <div className={styles.toolbarGroup}>
          {seesAll && (
            <div className={styles.selectWrap}>
              <span className={styles.fieldLabel}>{t('schedule:filters.teacher')}</span>
              <select
                className={styles.select}
                value={teacherFilter}
                aria-label={t('schedule:filters.teacher')}
                onChange={(event) => setTeacherFilter(event.target.value)}
              >
                <option value="all">{t('schedule:filters.allTeachers')}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.seg} role="group" aria-label={t('schedule:view.group')}>
            <button
              type="button"
              className={`${styles.segBtn} ${view === 'week' ? styles.segBtnActive : ''}`}
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
            >
              {t('schedule:view.week')}
            </button>
            <button
              type="button"
              className={`${styles.segBtn} ${view === 'day' ? styles.segBtnActive : ''}`}
              aria-pressed={view === 'day'}
              onClick={() => setView('day')}
            >
              {t('schedule:view.day')}
            </button>
          </div>

          {view === 'week' && (
            <button
              type="button"
              className={`${styles.toggle} ${showSaturday ? styles.toggleActive : ''}`}
              aria-pressed={showSaturday}
              onClick={() => setShowSaturday((current) => !current)}
            >
              {t('schedule:filters.showSaturday')}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {busy && (
        <p className={styles.hint} role="status">
          {t('common:loading')}
        </p>
      )}

      <section className={styles.stats} aria-label={t('schedule:statsTitle')}>
        {statCards.map(({ key, value, Icon, tint }) => (
          <div key={key} className={`${styles.statCard} ${TINT_BG[tint]}`}>
            <span className={`${styles.statIcon} ${TINT_FG[tint]}`} aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className={styles.statText}>
              <span className={styles.statValue}>{value}</span>
              <span className={styles.statLabel}>{t(`schedule:stats.${key}`)}</span>
            </span>
          </div>
        ))}
      </section>

      {items.length === 0 ? (
        <section className={`${styles.card} ${styles.calendar}`}>
          <EmptyState title={t('schedule:empty.none')} hint={t('schedule:emptyHint.week')} />
        </section>
      ) : view === 'day' ? (
        <section className={`${styles.card} ${styles.calendar}`}>
          <div className={styles.calendarHead}>
            <h2 className={styles.pageSub}>{rangeLabel}</h2>
          </div>
          {dayItems.length === 0 ? (
            <EmptyState title={t('schedule:empty.day')} hint={t('schedule:emptyHint.day')} />
          ) : (
            <SessionList items={dayItems} showTeacher={seesAll} onOpen={openSession} />
          )}
        </section>
      ) : (
        <section className={`${styles.card} ${styles.calendar}`}>
          {!isNarrow && inWeek.length === 0 && (
            <p className={styles.banner}>
              <CalendarDays size={16} aria-hidden="true" />
              <span>{t('schedule:empty.week')}</span>
            </p>
          )}

          {isNarrow ? (
            weekGroups.length === 0 ? (
              <EmptyState title={t('schedule:empty.week')} hint={t('schedule:emptyHint.week')} />
            ) : (
              <div className={styles.weekGroups} role="group" aria-label={t('schedule:aria.dayList')}>
                {weekGroups.map((column) => (
                  <div key={column.date.getTime()} className={styles.dayGroup}>
                    <h3
                      className={`${styles.dayGroupHead} ${
                        sameDay(column.date, startOfDay(new Date())) ? styles.dayGroupToday : ''
                      }`}
                    >
                      <span>{`${t(`schedule:days.${DAY_KEYS[column.date.getDay()]}`)} · ${formatDate(column.date, locale)}`}</span>
                      <span className={styles.dayGroupCount}>{column.items.length}</span>
                    </h3>
                    <SessionList items={column.items} showTeacher={seesAll} onOpen={openSession} />
                  </div>
                ))}
              </div>
            )
          ) : (
            <WeekGrid
              columns={columns}
              showTeacher={seesAll}
              onOpen={openSession}
              onPickDay={(date) => {
                setCursor(date)
                setView('day')
              }}
            />
          )}

        </section>
      )}

      {dialog.kind === 'details' && dialogItem && (
        <DetailsDrawer
          item={dialogItem}
          canManage={canManage}
          onClose={closeDialog}
          onCancel={(id) => setDialog({ kind: 'cancel', id })}
          onReschedule={(id) => setDialog({ kind: 'reschedule', id })}
          onFinish={handleFinish}
        />
      )}

      {dialog.kind === 'cancel' && dialogItem && (
        <CancelDialog
          item={dialogItem}
          onClose={closeDialog}
          onBack={() => setDialog({ kind: 'details', id: dialogItem.id })}
          onConfirm={handleCancel}
        />
      )}

      {dialog.kind === 'reschedule' && dialogItem && (
        <RescheduleDialog
          item={dialogItem}
          checkSlot={checkSlot}
          onClose={closeDialog}
          onBack={() => setDialog({ kind: 'details', id: dialogItem.id })}
          onConfirm={handleReschedule}
        />
      )}

      {dialog.kind === 'create' && (
        <CreateDialog
          defaultTeacherId={
            role === 'teacher' ? getSelfScope().teacherId : (teachers.find((teacher) => teacher.active)?.id ?? teachers[0]?.id ?? null)
          }
          checkSlot={checkSlot}
          onClose={closeDialog}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
