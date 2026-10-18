import type { AuthUser } from '@eduspace/shared-types'
import { ROUTES, type RoutePath } from '../app/router/paths'

/**
 * الأدوار الفعّالة في الواجهة.
 *
 * أدوار الموظفين ترجع من الـ API كرقم (0 مدرس · 1 مشرف · 2 مدير · 3 أونر)،
 * والطالب وولي الأمر يرجعان بعلامة `aud` ودور سالب (-1 · -2).
 */
export type EffectiveRole = 'owner' | 'manager' | 'supervisor' | 'teacher' | 'student' | 'parent'

export const ALL_ROLES: EffectiveRole[] = ['owner', 'manager', 'supervisor', 'teacher', 'student', 'parent']

const ROLE_BY_NUMBER: Record<number, EffectiveRole> = {
  0: 'teacher',
  1: 'supervisor',
  2: 'manager',
  3: 'owner',
}

/** الدور الحقيقي للحساب كما جاء من الخادم — لا معاينة ولا تجاوز محلي */
export function realRoleFor(user: AuthUser | null): EffectiveRole {
  if (!user) return 'teacher'
  if (user.aud === 'student' || user.role === -1) return 'student'
  if (user.aud === 'parent' || user.role === -2) return 'parent'
  return ROLE_BY_NUMBER[user.role] ?? 'teacher'
}

/**
 * الدور الذي تُبنى عليه الواجهة = دور الحساب المُصادَق عليه من الخادم حصرًا.
 * كانت هناك «معاينة أدوار» تُخزَّن في localStorage وتتجاوز دورك الحقيقي،
 * وهي تزيّف كل شاشة (قوائم وصلاحيات وأزرار) فأُزيلت.
 */
export function effectiveRoleFor(user: AuthUser | null): EffectiveRole {
  return realRoleFor(user)
}

/** مفتاح ترجمة اسم الدور داخل common.json */
export function roleLabelKey(role: EffectiveRole): string {
  return `roles.${role}`
}

export type NavItemDef = {
  to: RoutePath
  icon: 'home' | 'schedule' | 'sessions' | 'students' | 'teachers' | 'parents' | 'reports' | 'messages' | 'settings'
  labelKey: string
  end?: boolean
}

const item = (
  to: RoutePath,
  icon: NavItemDef['icon'],
  labelKey: string,
  end = false,
): NavItemDef => ({ to, icon, labelKey, end })

/** عناصر الشريط الجانبي لكل دور — الصلاحيات مطابقة لمتطلبات docs/01-requirements.md */
export const NAV_BY_ROLE: Record<EffectiveRole, NavItemDef[]> = {
  teacher: [
    item(ROUTES.home, 'home', 'dashboard:nav.home', true),
    item(ROUTES.schedule, 'schedule', 'dashboard:nav.schedule'),
    item(ROUTES.sessions, 'sessions', 'dashboard:nav.sessions'),
    item(ROUTES.students, 'students', 'dashboard:nav.students'),
    item(ROUTES.reports, 'reports', 'dashboard:nav.reports'),
    item(ROUTES.messages, 'messages', 'dashboard:nav.messages'),
    item(ROUTES.settings, 'settings', 'dashboard:nav.settings'),
  ],
  supervisor: [
    item(ROUTES.home, 'home', 'dashboard:nav.home', true),
    item(ROUTES.schedule, 'schedule', 'dashboard:nav.schedule'),
    item(ROUTES.sessions, 'sessions', 'dashboard:nav.sessions'),
    item(ROUTES.students, 'students', 'dashboard:nav.students'),
    item(ROUTES.teachers, 'teachers', 'dashboard:nav.teachers'),
    item(ROUTES.parents, 'parents', 'dashboard:nav.parents'),
    item(ROUTES.reports, 'reports', 'dashboard:nav.reports'),
    item(ROUTES.messages, 'messages', 'dashboard:nav.messages'),
    item(ROUTES.settings, 'settings', 'dashboard:nav.settings'),
  ],
  manager: [
    item(ROUTES.home, 'home', 'dashboard:nav.home', true),
    item(ROUTES.schedule, 'schedule', 'dashboard:nav.schedule'),
    item(ROUTES.sessions, 'sessions', 'dashboard:nav.sessions'),
    item(ROUTES.students, 'students', 'dashboard:nav.students'),
    item(ROUTES.teachers, 'teachers', 'dashboard:nav.teachers'),
    item(ROUTES.parents, 'parents', 'dashboard:nav.parents'),
    item(ROUTES.reports, 'reports', 'dashboard:nav.reports'),
    item(ROUTES.messages, 'messages', 'dashboard:nav.messages'),
    item(ROUTES.settings, 'settings', 'dashboard:nav.settings'),
  ],
  owner: [
    item(ROUTES.home, 'home', 'dashboard:nav.home', true),
    item(ROUTES.schedule, 'schedule', 'dashboard:nav.schedule'),
    item(ROUTES.sessions, 'sessions', 'dashboard:nav.sessions'),
    item(ROUTES.students, 'students', 'dashboard:nav.students'),
    item(ROUTES.teachers, 'teachers', 'dashboard:nav.teachers'),
    item(ROUTES.parents, 'parents', 'dashboard:nav.parents'),
    item(ROUTES.reports, 'reports', 'dashboard:nav.reports'),
    item(ROUTES.messages, 'messages', 'dashboard:nav.messages'),
    item(ROUTES.settings, 'settings', 'dashboard:nav.settings'),
  ],
  student: [
    item(ROUTES.home, 'home', 'dashboard:nav.home', true),
    item(ROUTES.schedule, 'schedule', 'dashboard:nav.mySchedule'),
    item(ROUTES.sessions, 'sessions', 'dashboard:nav.mySessions'),
    item(ROUTES.messages, 'messages', 'dashboard:nav.messages'),
    item(ROUTES.settings, 'settings', 'dashboard:nav.settings'),
  ],
  parent: [
    item(ROUTES.home, 'home', 'dashboard:nav.home', true),
    item(ROUTES.students, 'students', 'dashboard:nav.myChildren'),
    item(ROUTES.sessions, 'sessions', 'dashboard:nav.mySessions'),
    item(ROUTES.reports, 'reports', 'dashboard:nav.reports'),
    item(ROUTES.messages, 'messages', 'dashboard:nav.messages'),
    item(ROUTES.settings, 'settings', 'dashboard:nav.settings'),
  ],
}

/** إدارة الحسابات (إنشاء/تعديل/إيقاف) للإدارة من مشرف فأعلى — نفس حارس /api/users */
export function canManageStaff(role: EffectiveRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'supervisor'
}

export function canObserveSessions(role: EffectiveRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'supervisor'
}

export function seesAllSchedule(role: EffectiveRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'supervisor'
}

export function isStudentRole(role: EffectiveRole): boolean {
  return role === 'student'
}

/** دور المشارك داخل غرفة الاجتماعات الحقيقية (WebRTC) */
export type ParticipantRole = 'teacher' | 'student' | 'observer'

export function participantRoleFor(role: EffectiveRole): ParticipantRole {
  if (role === 'teacher') return 'teacher'
  if (role === 'student') return 'student'
  return 'observer' // مشرف/مدير/أونر/ولي أمر — مراقبة فقط
}
