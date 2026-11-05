import type { TFunction } from 'i18next'
import type { ClassSession } from '../../lib/data/eduStore'

/**
 * هل تُفتح هذه الحصة الآن؟ الجواب **من الخادم لا من الشاشة**:
 * `session.joinState` يحسبه `SessionWindow` بساعة السيرفر، فساعة جهاز الطالب
 * (وقد تكون wrong ساعة كاملة) لا تقرر ميعاد دخول امتحنه المدرسة.
 *
 * قبل هذا كان `canJoin` في `SessionsPage` يرجع `true` لأي حصة `scheduled`
 * مهما كان موعدها — فالزرار مفتوح طول اليوم.
 */
export function canJoin(session: ClassSession): boolean {
  return session.joinState === 'open'
}

/**
 * سبب البهات، حرفيًا لكل حالة. المفاتيح مكتوبة ثابتة لا متغيّرة لأن
 * `npm run check:i18n` يُمسك المفتاح الناقص من النص الحرفي فقط — ومتغيّر
 * مكسور يطبع اسمه الخام على الشاشة.
 */
export function joinHint(t: TFunction, session: ClassSession): string {
  switch (session.joinState) {
    case 'open':
      return t('sessions:actions.joinHint')
    case 'tooEarly':
      return t('sessions:actions.lockTooEarly', { minutes: session.minutesUntilOpen ?? 0 })
    case 'windowClosed':
      return t('sessions:actions.lockWindowClosed')
    default:
      return t('sessions:actions.lockFinished')
  }
}
