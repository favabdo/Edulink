import { Building2, ShieldCheck, SlidersHorizontal, User } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../features/auth/authContext'
import { canManageStaff, effectiveRoleFor, roleLabelKey } from '../../lib/roles'
import { BrandTab } from './BrandTab'
import { PreferencesTab } from './PreferencesTab'
import { ProfileTab } from './ProfileTab'
import { SecurityTab } from './SecurityTab'
import styles from './SettingsPage.module.css'

type TabKey = 'profile' | 'security' | 'preferences' | 'brand'

type TabDef = {
  readonly key: TabKey
  readonly labelKey: string
  readonly Icon: typeof User
  readonly staffOnly: boolean
}

const TABS: readonly TabDef[] = [
  { key: 'profile', labelKey: 'settings:tabs.profile', Icon: User, staffOnly: false },
  { key: 'security', labelKey: 'settings:tabs.security', Icon: ShieldCheck, staffOnly: false },
  { key: 'preferences', labelKey: 'settings:tabs.preferences', Icon: SlidersHorizontal, staffOnly: false },
  { key: 'brand', labelKey: 'settings:tabs.brand', Icon: Building2, staffOnly: true },
]

/** صفحة الإعدادات — المسار: /settings — قائمة تبويبات على البداية ولوحة على النهاية */
export function SettingsPage() {
  const { t } = useTranslation()
  const { user } = useAuth()

  const role = effectiveRoleFor(user)
  const canManage = canManageStaff(role)
  const [active, setActive] = useState<TabKey>('profile')

  const tabs = TABS.filter((tab) => !tab.staffOnly || canManage)
  const currentTab: TabKey = tabs.some((tab) => tab.key === active) ? active : 'profile'

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('settings:heading')}</h1>
          <p className={styles.subtitle}>{t('settings:subtitle')}</p>
        </div>
        <span className={styles.headerChip}>{t(roleLabelKey(role))}</span>
      </header>

      <div className={styles.layout}>
        <nav className={styles.tabs} aria-label={t('settings:tabsLabel')}>
          {tabs.map(({ key, labelKey, Icon }) => {
            const isActive = key === currentTab
            return (
              <button
                key={key}
                type="button"
                className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                onClick={() => setActive(key)}
                aria-current={isActive ? 'true' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </button>
            )
          })}
        </nav>

        <div className={styles.panel}>
          {currentTab === 'profile' && <ProfileTab />}
          {currentTab === 'security' && <SecurityTab />}
          {currentTab === 'preferences' && <PreferencesTab />}
          {currentTab === 'brand' && canManage && <BrandTab />}
        </div>
      </div>
    </div>
  )
}
