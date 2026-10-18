import { Languages, MonitorSmartphone, Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supportedLanguages } from '../../i18n'
import { useLanguage } from '../../i18n/useLanguage'
import { useTheme } from '../../theme/themeContext'
import { OptionGroup, SettingSection, Toggle, type Option } from './Fields'
import {
  readNotificationPrefs,
  readThemeMode,
  writeNotificationPrefs,
  writeThemeMode,
  type NotificationPrefs,
  type ThemeMode,
} from './settingsData'
import styles from './SettingsPage.module.css'

/** 3) التفضيلات — اللغة والمظهر والإشعارات (تُحفظ على الجهاز) */
export function PreferencesTab() {
  const { t } = useTranslation()
  const { language, setLanguage } = useLanguage()
  const { theme, setTheme } = useTheme()

  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode(theme))
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => readNotificationPrefs())

  // في وضع «تلقائي» نتابع تفضيل النظام ونحدّث المظهر الفعلي
  useEffect(() => {
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => setTheme(media.matches ? 'dark' : 'light')
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode, setTheme])

  const languageOptions: Option[] = supportedLanguages.map((code) => ({
    value: code,
    label: t(`settings:preferences.languages.${code}`),
    icon: <Languages size={16} aria-hidden="true" />,
  }))

  const themeOptions: Option[] = [
    { value: 'light', label: t('settings:preferences.themes.light'), icon: <Sun size={16} aria-hidden="true" /> },
    { value: 'dark', label: t('settings:preferences.themes.dark'), icon: <Moon size={16} aria-hidden="true" /> },
    {
      value: 'system',
      label: t('settings:preferences.themes.system'),
      icon: <MonitorSmartphone size={16} aria-hidden="true" />,
    },
  ]

  function chooseLanguage(value: string) {
    setLanguage(value === 'en' ? 'en' : 'ar')
  }

  function chooseThemeMode(value: string) {
    const nextMode: ThemeMode = value === 'system' ? 'system' : value === 'dark' ? 'dark' : 'light'
    setMode(nextMode)
    writeThemeMode(nextMode)
    if (nextMode !== 'system') setTheme(nextMode)
  }

  function updatePreference(key: keyof NotificationPrefs, value: boolean) {
    const updated = { ...prefs, [key]: value }
    setPrefs(updated)
    writeNotificationPrefs(updated)
  }

  return (
    <>
      <SettingSection title={t('settings:preferences.languageTitle')} description={t('settings:preferences.languageDesc')}>
        <OptionGroup
          name="settings-language"
          label={t('settings:preferences.languageTitle')}
          value={language}
          options={languageOptions}
          onChange={chooseLanguage}
        />
      </SettingSection>

      <SettingSection title={t('settings:preferences.themeTitle')} description={t('settings:preferences.themeDesc')}>
        <OptionGroup
          name="settings-theme"
          label={t('settings:preferences.themeTitle')}
          value={mode}
          options={themeOptions}
          onChange={chooseThemeMode}
        />
      </SettingSection>

      <SettingSection
        title={t('settings:preferences.notificationsTitle')}
        description={t('settings:preferences.notificationsDesc')}
      >
        <div className={styles.toggles}>
          <Toggle
            checked={prefs.sessionReminders}
            onChange={(value) => updatePreference('sessionReminders', value)}
            label={t('settings:preferences.notifications.sessionReminders')}
            hint={t('settings:preferences.notificationsHint.sessionReminders')}
          />
          <Toggle
            checked={prefs.newMessages}
            onChange={(value) => updatePreference('newMessages', value)}
            label={t('settings:preferences.notifications.newMessages')}
            hint={t('settings:preferences.notificationsHint.newMessages')}
          />
          <Toggle
            checked={prefs.weeklyReport}
            onChange={(value) => updatePreference('weeklyReport', value)}
            label={t('settings:preferences.notifications.weeklyReport')}
            hint={t('settings:preferences.notificationsHint.weeklyReport')}
          />
        </div>
        <p className={styles.note}>{t('settings:preferences.autoSavedNote')}</p>
      </SettingSection>
    </>
  )
}
