/**
 * طبقة الأنواع والنداءات الحقيقية للمراسلة — `/api/messages`.
 *
 * قواعد الاتصال يفرضها الخادم (الموظف يبادر بأي حساب، الطالب بمدرّسه، ولي الأمر بمدرّسي أبنائه)؛
 * الواجهة لا تكرّر شيئًا من هذه القواعد — فقط تعرض ما يرجع وتُظهر رسالة خطأ الخادم عند 403.
 */
import { apiFetch } from '../../lib/apiClient'
import type { AuthUser } from '@eduspace/shared-types'

// ─────────────────────────────── الأنواع ───────────────────────────────

/** نوع الحساب كما يعرفه الخادم (`Edu_Users` = staff · `Edu_Students` · `Edu_Parents`) */
export type AccountKind = 'staff' | 'student' | 'parent'

/** الطرف الآخر في المحادثة (قد يكون أكثر من شخص إذا كان الخيط مشتركًا) */
export type ConversationCounterpart = {
  kind: AccountKind
  id: number
  name: string
}

/** صف صندوق الوارد كما يرجعه `/api/messages/conversations` */
export type ConversationSummary = {
  conversationId: number
  with: ConversationCounterpart[]
  lastBody: string
  lastAt: string
  lastSenderName: string
  lastSenderKind: AccountKind
  lastSenderId: number
  unread: number
}

/** رسالة داخل خيط واحد — `/api/messages/conversations/{id}` */
export type ThreadMessage = {
  id: number
  body: string
  senderKind: AccountKind
  senderId: number
  senderName: string
  mine: boolean
  /** ISO من الخادم — تُحوَّل إلى epoch ms عند العرض */
  at: string
}

/** رد `/api/messages/send` */
export type SendResponse = {
  id: number
  conversationId: number
  at: string
}

/** حساب يمكن بدء محادثة معه (يُبنى من قوائم الأدلة الحقيقية) */
export type MessageContact = {
  kind: AccountKind
  id: number
  name: string
}

// ─────────────────────────────── النداءات ───────────────────────────────

export function fetchConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>('/api/messages/conversations')
}

export function fetchThread(conversationId: number): Promise<ThreadMessage[]> {
  return apiFetch<ThreadMessage[]>(`/api/messages/conversations/${conversationId}`)
}

/** الرد داخل خيط موجود */
export function replyInConversation(conversationId: number, body: string): Promise<SendResponse> {
  return apiFetch<SendResponse>('/api/messages/send', { method: 'POST', body: { conversationId, body } })
}

/** بدء خيط جديد مع حساب — الخادم يرفض 403 لو لم تُسمح المباشرة */
export function startConversation(
  recipientKind: AccountKind,
  recipientId: number,
  body: string,
): Promise<SendResponse> {
  return apiFetch<SendResponse>('/api/messages/send', {
    method: 'POST',
    body: { recipientKind, recipientId, body },
  })
}

// ─────────────────────────────── أدوات مساعدة ───────────────────────────────

/**
 * نوع الحساب الحالي من التوكن. `AuthUser.aud` في shared-types لا يتضمن 'parent' بعد،
 * لذلك تُقرأ القيمة كسلسلة ثم تُضبط — لا اعتماد على نوع قديم هنا.
 */
export function accountKindOf(user: AuthUser | null): AccountKind {
  const aud: string = user?.aud ?? 'staff'
  return aud === 'student' || aud === 'parent' ? aud : 'staff'
}

/** أسماء الطرف الآخر في المحادثة (قد يكون أكثر من شخص إذا كان الخيط مشتركًا) */
export function counterpartNames(withList: ConversationCounterpart[]): string[] {
  return withList.map((person) => person.name).filter((name) => name.trim().length > 0)
}

export function toEpoch(iso: string): number {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? Date.now() : value
}

// ─────────────────────────────── دليل الحسابات ───────────────────────────────

/** صفوف `/api/users` و`/api/students` و`/api/parents` — الحقول التي نحتاجها فقط */
type DirectoryRow = {
  id: number
  name: string | null
  email?: string
  states?: number
  access?: number
}

/** صفوف `/api/sessions` — مدرّسو الحساب الحالي فقط (للطالب وولي الأمر) */
type SessionRow = {
  teacherId: number
  teacherName: string | null
}

function displayNameOf(row: { id: number; name: string | null; email?: string }): string {
  const name = row.name?.trim()
  if (name) return name
  const fromEmail = row.email?.split('@')[0]?.trim()
  return fromEmail && fromEmail.length > 0 ? fromEmail : String(row.id)
}

function isActive(row: DirectoryRow): boolean {
  return row.states !== 0 && row.access !== 0
}

async function directory(path: string): Promise<DirectoryRow[]> {
  try {
    return await apiFetch<DirectoryRow[]>(path)
  } catch {
    // قوائم الإدارة محجوبة على بعض الأدوار — تُتجاهل بصمت ويُبنى الدليل من المتاح
    return []
  }
}

/**
 * من يمكن مراسلته؟
 * - الموظف: بقية الموظفين + الطلاب + أولياء الأمور (القوائم تُقرأ حسب الصلاحيات).
 * - الطالب وولي الأمر: مدرّسو الحصص المعروضة لهم (لا وصول إلى قوائم الإدارة).
 */
export async function fetchContacts(kind: AccountKind, selfId: number): Promise<MessageContact[]> {
  const contacts: MessageContact[] = []

  if (kind === 'staff') {
    const [users, students, parents] = await Promise.all([
      directory('/api/users'),
      directory('/api/students'),
      directory('/api/parents'),
    ])

    users
      .filter((row) => isActive(row) && row.id !== selfId)
      .forEach((row) => contacts.push({ kind: 'staff', id: row.id, name: displayNameOf(row) }))
    students
      .filter(isActive)
      .forEach((row) => contacts.push({ kind: 'student', id: row.id, name: displayNameOf(row) }))
    parents
      .filter(isActive)
      .forEach((row) => contacts.push({ kind: 'parent', id: row.id, name: displayNameOf(row) }))

    return contacts
  }

  let sessions: SessionRow[] = []
  try {
    sessions = await apiFetch<SessionRow[]>('/api/sessions')
  } catch {
    sessions = []
  }

  const seen = new Set<number>()
  for (const session of sessions) {
    if (!session.teacherId || seen.has(session.teacherId)) continue
    seen.add(session.teacherId)
    contacts.push({
      kind: 'staff',
      id: session.teacherId,
      name: session.teacherName?.trim() || String(session.teacherId),
    })
  }
  return contacts
}
