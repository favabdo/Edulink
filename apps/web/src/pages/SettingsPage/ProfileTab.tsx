import { Camera } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/authContext'
import { effectiveRoleFor } from '../../lib/roles'
import { SettingSection, TextField } from './Fields'
import styles from './SettingsPage.module.css'

function initialsOf(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => !(part.length <= 2 && part.endsWith('.')))
  return parts.slice(0, 2).map((part) => part.charAt(0)).join('') || '؟'
}

/**
 * 1) الملف الشخصي — بيانات الحساب كما أرسلها الخادم، **للقراءة فقط**.
 *
 * لا زر «حفظ» بلا نداء شبكة: تعديل الاسم/البريد يتمّ عند الخادم عبر `/api/users`
 * (إدارة من مشرف فأعلى) أو `/api/students` و`/api/parents` — وهي شاشات الإدارة
 * «إدارة الحسابات». البريد لا يُغيَّر من أي نقطة نهاية حاليًا، فيُعرض ثابتًا.
 */
export function ProfileTab() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const displayName = user?.name ?? user?.email ?? 'EduLink'
  const role = effectiveRoleFor(user)
  const mayEditSelf = role === 'owner' || role === 'manager'

  return (
    <SettingSection title={t('settings:profile.title')} description={t('settings:profile.desc')}>
      <div className={styles.profileHead}>
        <span className={styles.bigAvatar} aria-hidden="true">
          {initialsOf(displayName)}
        </span>
        <div className={styles.profileHeadText}>
          <span className={styles.profileName}>{displayName}</span>
          <span className={styles.profileMeta}>{user?.roleName ?? t('settings:profile.noRole')}</span>
          <button type="button" className={styles.avatarButton} disabled title={t('settings:profile.avatarSoon')}>
            <Camera size={15} aria-hidden="true" />
            <span>{t('settings:profile.avatarChange')}</span>
          </button>
        </div>
      </div>

      <div className={styles.form}>
        <TextField
          id="profile-name"
          label={t('settings:profile.name')}
          value={user?.name ?? ''}
          onChange={() => undefined}
          disabled
          placeholder={t('settings:profile.namePlaceholder')}
        />

        <TextField
          id="profile-email"
          label={t('settings:profile.email')}
          type="email"
          value={user?.email ?? ''}
          onChange={() => undefined}
          disabled
          hint={t('settings:profile.emailHint')}
        />
      </div>

      <p className={styles.note}>
        {mayEditSelf ? t('settings:profile.readOnlyStaff') : t('settings:profile.readOnly')}
      </p>
    </SettingSection>
  )
}
