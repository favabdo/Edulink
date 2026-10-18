import { useAuth } from '../features/auth/authContext'
import { useLanguage } from '../i18n/useLanguage'
import { useTheme } from '../theme/themeContext'
import { BrandLogo } from '../components/BrandLogo'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  Sun,
  UserCheck,
  Users,
  Video,
  X,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { effectiveRoleFor, NAV_BY_ROLE, roleLabelKey, type NavItemDef } from '../lib/roles'
import { useAppData } from '../features/sessions/DataProvider'
import { notificationPath, useNotifications } from '../features/notifications/useNotifications'
import styles from './DashboardLayout.module.css'

/** خرائط أسماء الأيقونات في `roles.ts` إلى مكوّنات lucide */
const NAV_ICONS: Record<NavItemDef['icon'], typeof LayoutDashboard> = {
  home: LayoutDashboard,
  schedule: CalendarDays,
  sessions: Video,
  students: Users,
  teachers: GraduationCap,
  parents: UserCheck,
  reports: BarChart3,
  messages: MessageSquare,
  settings: Settings,
}

function initialsOf(name: string | null, email: string) {
  const source = (name ?? email).trim()
  const parts = source.split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0)).join('') || '؟'
}

function relativeTime(at: number, locale: string) {
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60_000))
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (minutes < 60) return fmt.format(-minutes, 'minute')
  if (minutes < 24 * 60) return fmt.format(-Math.round(minutes / 60), 'hour')
  return fmt.format(-Math.round(minutes / 1440), 'day')
}

/** هيكل كل الصفحات الداخلية: شريط علوي + شريط جانبي حسب الدور + منطقة المحتوى */
export function DashboardLayout() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const { loading: dataLoading, error: dataError, refresh: refreshData } = useAppData()
  const { language, toggleLanguage } = useLanguage()
  const { theme, toggleTheme } = useTheme()

  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const navigate = useNavigate()
  const {
    items: notificationsList,
    unread: unreadCount,
    loading: notificationsLoading,
    error: notificationsError,
    markRead,
    markAllRead,
  } = useNotifications()

  const role = effectiveRoleFor(user)
  const navItems = NAV_BY_ROLE[role]
  const displayName = user?.name ?? user?.email ?? ''
  const roleLabel = t(roleLabelKey(role))
  const themeLabel = theme === 'dark' ? t('common:theme.switchToLight') : t('common:theme.switchToDark')
  const languageLabel = language === 'ar' ? t('common:switchToEnglish') : t('common:switchToArabic')

  /** تعليم الإشعار كمقروء ثم الانتقال إلى مساره (الرابط من الخادم ويُمرَّر عبر notificationPath) */
  const openNotification = (id: number, link: string | null) => {
    void markRead(id)
    const path = notificationPath(link)
    if (!path) return
    setNotifOpen(false)
    navigate(path)
  }

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brandGroup}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setNavOpen((open) => !open)}
            aria-label={t('dashboard:topbar.menu')}
            aria-expanded={navOpen}
          >
            {navOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
          <BrandLogo variant="card" className={styles.brand} />
        </div>

        <div className={styles.actions}>
          <div className={styles.account}>
            <button
              type="button"
              className={styles.accountButton}
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className={styles.avatar} aria-hidden="true">
                {user?.imgUrl ? (
                  <img src={user.imgUrl} alt="" />
                ) : (
                  initialsOf(user?.name ?? null, user?.email ?? '')
                )}
              </span>
              <span className={styles.accountText}>
                <span className={styles.accountName}>{displayName}</span>
                <span className={styles.accountRole}>{user?.roleName ?? roleLabel}</span>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button type="button" className={styles.menuItem} onClick={() => void signOut()}>
                  <LogOut size={16} aria-hidden="true" />
                  {t('dashboard:topbar.logout')}
                </button>
              </div>
            )}
          </div>

          <div className={styles.notifWrap}>
            <button
              type="button"
              className={`${styles.iconButton} ${notifOpen ? '' : styles.bell}`}
              onClick={() => setNotifOpen((open) => !open)}
              aria-label={t('dashboard:topbar.notifications')}
              aria-expanded={notifOpen}
            >
              <Bell size={20} aria-hidden="true" />
              {unreadCount > 0 && <span className={styles.badge} aria-hidden="true" />}
            </button>

            {notifOpen && (
              <div className={styles.notifPanel} role="dialog" aria-label={t('dashboard:notifications.title')}>
                <div className={styles.notifHead}>
                  <strong>{t('dashboard:notifications.title')}</strong>
                  {unreadCount > 0 && (
                    <button type="button" className={styles.notifMarkAll} onClick={() => void markAllRead()}>
                      <Check size={14} aria-hidden="true" />
                      {t('dashboard:notifications.markAll')}
                    </button>
                  )}
                </div>
                {notificationsError && notificationsList.length === 0 ? (
                  <p className={styles.notifEmpty}>{notificationsError}</p>
                ) : notificationsList.length === 0 ? (
                  <p className={styles.notifEmpty}>
                    {t(notificationsLoading ? 'dashboard:notifications.loading' : 'dashboard:notifications.empty')}
                  </p>
                ) : (
                  <ul className={styles.notifList}>
                    {notificationsList.map((n) => {
                      const unread = n.readAt === null
                      return (
                        <li key={n.id} className={unread ? styles.notifItemUnread : styles.notifItem}>
                          <button
                            type="button"
                            className={styles.notifItemButton}
                            onClick={() => openNotification(n.id, n.link)}
                          >
                            <span>{n.body ? `${n.title} — ${n.body}` : n.title}</span>
                            <time className={styles.notifTime}>{relativeTime(n.at, language)}</time>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
          >
            {theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          </button>

          <button
            type="button"
            className={styles.languageButton}
            onClick={toggleLanguage}
            aria-label={languageLabel}
          >
            {languageLabel}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ''}`}>
          <nav className={styles.nav}>
            {navItems.map(({ to, icon, labelKey, end }) => {
              const Icon = NAV_ICONS[icon]
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                  onClick={() => setNavOpen(false)}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>{t(labelKey)}</span>
                </NavLink>
              )
            })}
          </nav>

          <div className={styles.quoteCard}>
            <BookOpen size={28} aria-hidden="true" className={styles.quoteIcon} />
            <p>{t('dashboard:quote')}</p>
          </div>
        </aside>

        <main className={styles.content}>
          {dataError && (
            <p className={`${styles.statusBanner} ${styles.statusBannerError}`} role="alert">
              <span>{dataError}</span>
              <button type="button" onClick={() => void refreshData()}>
                {t('common:retry')}
              </button>
            </p>
          )}
          {!dataError && dataLoading && <p className={styles.statusBanner}>{t('common:loadingFromServer')}</p>}
          <Outlet />
        </main>
      </div>
    </div>
  )
}
