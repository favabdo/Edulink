import { ROUTES, type RoutePath } from '../app/router/paths'
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
import { NavLink, Outlet } from 'react-router-dom'
import styles from './DashboardLayout.module.css'

type NavItem = {
  to: RoutePath
  icon: typeof LayoutDashboard
  labelKey: string
  end?: boolean
}

/** عناصر الشريط الجانبي — المسار من `paths.ts` والاسم من ترجمات الوحدة `dashboard` */
const NAV_ITEMS: NavItem[] = [
  { to: ROUTES.home, icon: LayoutDashboard, labelKey: 'dashboard:nav.home', end: true },
  { to: ROUTES.schedule, icon: CalendarDays, labelKey: 'dashboard:nav.schedule' },
  { to: ROUTES.sessions, icon: Video, labelKey: 'dashboard:nav.sessions' },
  { to: ROUTES.students, icon: Users, labelKey: 'dashboard:nav.students' },
  { to: ROUTES.reports, icon: BarChart3, labelKey: 'dashboard:nav.reports' },
  { to: ROUTES.messages, icon: MessageSquare, labelKey: 'dashboard:nav.messages' },
  { to: ROUTES.settings, icon: Settings, labelKey: 'dashboard:nav.settings' },
]

function initialsOf(name: string | null, email: string) {
  const source = (name ?? email).trim()
  const parts = source.split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0)).join('') || '؟'
}

/** هيكل كل الصفحات الداخلية: شريط علوي + شريط جانبي + منطقة المحتوى */
export function DashboardLayout() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const { language, toggleLanguage } = useLanguage()
  const { theme, toggleTheme } = useTheme()

  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const displayName = user?.name ?? user?.email ?? ''
  const themeLabel = theme === 'dark' ? t('common:theme.switchToLight') : t('common:theme.switchToDark')
  const languageLabel = language === 'ar' ? t('common:switchToEnglish') : t('common:switchToArabic')

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
                <span className={styles.accountRole}>{user?.roleName}</span>
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

          <button
            type="button"
            className={`${styles.iconButton} ${styles.bell}`}
            aria-label={t('dashboard:topbar.notifications')}
          >
            <Bell size={20} aria-hidden="true" />
            <span className={styles.badge} aria-hidden="true" />
          </button>

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
            {NAV_ITEMS.map(({ to, icon: Icon, labelKey, end }) => (
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
            ))}
          </nav>

          <div className={styles.quoteCard}>
            <BookOpen size={28} aria-hidden="true" className={styles.quoteIcon} />
            <p>{t('dashboard:quote')}</p>
          </div>
        </aside>

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
