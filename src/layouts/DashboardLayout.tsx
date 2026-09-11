import { useState } from 'react'
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  Sun,
  Users,
  Video,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { useAuth } from '../auth/authContext'
import { useLanguage } from '../i18n/useLanguage'
import { useTheme } from '../theme/themeContext'
import styles from './DashboardLayout.module.css'

type NavItem = {
  to: string
  key: string
  Icon: typeof LayoutDashboard
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', key: 'home', Icon: LayoutDashboard, end: true },
  { to: '/schedule', key: 'schedule', Icon: CalendarDays },
  { to: '/sessions', key: 'sessions', Icon: Video },
  { to: '/students', key: 'students', Icon: Users },
  { to: '/reports', key: 'reports', Icon: BarChart3 },
  { to: '/messages', key: 'messages', Icon: MessageSquare },
  { to: '/settings', key: 'settings', Icon: Settings },
]

function initialsOf(name: string | null, email: string) {
  const source = (name ?? email).trim()
  const parts = source.split(/\s+/).slice(0, 2)
  return parts.map((p) => p.charAt(0)).join('') || '؟'
}

export function DashboardLayout() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const { language, toggleLanguage } = useLanguage()
  const { theme, toggleTheme } = useTheme()

  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const displayName = user?.name ?? user?.email ?? ''

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brandGroup}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => setNavOpen((open) => !open)}
            aria-label={t('topbar.menu')}
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
                <span className={styles.accountRole}>{user?.roleName}</span>
              </span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>

            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button type="button" className={styles.menuItem} onClick={() => void signOut()}>
                  <LogOut size={16} aria-hidden="true" />
                  {t('topbar.logout')}
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className={`${styles.iconButton} ${styles.bell}`}
            aria-label={t('topbar.notifications')}
          >
            <Bell size={20} aria-hidden="true" />
            <span className={styles.badge} aria-hidden="true" />
          </button>

          <button
            type="button"
            className={styles.iconButton}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('common.theme.switchToLight') : t('common.theme.switchToDark')}
          >
            {theme === 'dark' ? <Sun size={20} aria-hidden="true" /> : <Moon size={20} aria-hidden="true" />}
          </button>

          <button
            type="button"
            className={styles.languageButton}
            onClick={toggleLanguage}
            aria-label={language === 'ar' ? t('common.switchToEnglish') : t('common.switchToArabic')}
          >
            {language === 'ar' ? t('common.switchToEnglish') : t('common.switchToArabic')}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={`${styles.sidebar} ${navOpen ? styles.sidebarOpen : ''}`}>
          <nav className={styles.nav}>
            {NAV_ITEMS.map(({ to, key, Icon, end }) => (
              <NavLink
                key={key}
                to={to}
                end={end}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
                onClick={() => setNavOpen(false)}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{t(`nav.${key}`)}</span>
              </NavLink>
            ))}
          </nav>

          <div className={styles.quoteCard}>
            <BookOpen size={28} aria-hidden="true" className={styles.quoteIcon} />
            <p>{t('dashboard.quote')}</p>
          </div>
        </aside>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
