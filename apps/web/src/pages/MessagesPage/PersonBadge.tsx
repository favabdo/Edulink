import { useTranslation } from 'react-i18next'
import type { AccountKind } from '../../features/messages/api'
import { initialsOf } from './format'
import styles from './MessagesPage.module.css'

/**
 * نوع الحساب (staff/student/parent) إلى مفتاح كلاس التلوين الموجود في CSS.
 * لا كلاس مستقل لـ staff — يستخدم نفس أزرق المدرس لأن أغلب أطراف «staff» مدرّسون.
 */
const STYLE_BY_KIND: Record<AccountKind, string> = {
  staff: 'teacher',
  student: 'student',
  parent: 'parent',
}

/** صورة حرفية من الاسم — نفس أسلوب الهيدر في لوحة التحكم */
export function Avatar({
  kind,
  name,
  small = false,
}: {
  kind: AccountKind
  name: string
  small?: boolean
}) {
  const styleKey = STYLE_BY_KIND[kind]
  return (
    <span
      className={`${styles.avatar} ${small ? styles.avatarSmall : ''} ${styles[`avatar_${styleKey}`]}`}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

/** شارة نوع الحساب كما يعرفه الخادم (موظف / طالب / ولي أمر) */
export function KindChip({ kind }: { kind: AccountKind }) {
  const { t } = useTranslation()
  const styleKey = STYLE_BY_KIND[kind]
  return <span className={`${styles.roleChip} ${styles[`chip_${styleKey}`]}`}>{t(`messages:kinds.${kind}`)}</span>
}
