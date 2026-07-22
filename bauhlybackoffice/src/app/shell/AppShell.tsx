import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import {
  BrandMark,
  ChevronLeftIcon,
  CloseIcon,
  CompetitorsIcon,
  LogoutIcon,
  MenuIcon,
} from '../../components/icons'
import { PageActionsProvider, PageActionsSlot } from './pageActions'
import './shell.css'

// Phase 1 of the backoffice ships the Competitors tab only. The remaining
// sections (Signals, Intelligence, Customers, Integrations) are already ported
// under src/features — add them back here as each one is taken live.
const primaryNav = [
  // The competitors section spans two tab URLs, so it stays active on both.
  { to: '/', label: 'Competitors', icon: CompetitorsIcon, alsoActiveOn: ['/competitors'] as string[] },
]

const operationsNav: { to: string; label: string; icon: typeof CompetitorsIcon }[] = []

const COMPETITORS_TITLE = {
  title: 'Competitors',
  subtitle: 'Competitor intelligence, segmentation and managed accounts',
}

const titles: Record<string, { title: string; subtitle: string }> = {
  '/': COMPETITORS_TITLE,
  '/competitors-overview': COMPETITORS_TITLE,
  '/competitors': COMPETITORS_TITLE,
}

export function AppShell() {
  const { session, signOut } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const { title, subtitle } = titles[location.pathname] ?? {
    title: 'Bauhly Backoffice',
    subtitle: '',
  }

  const nav = (
    <nav className="nav" aria-label="Primary">
      <ul>
        {primaryNav.map(({ to, label, icon: NavIcon, alsoActiveOn }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={to === '/'}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                isActive || alsoActiveOn?.some((p) => location.pathname.startsWith(p))
                  ? 'active'
                  : undefined
              }
            >
              <NavIcon />
              <span className="nav-label">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      {operationsNav.length > 0 && (
        <>
          <p className="nav-section-title" id="nav-operations">
            <span className="nav-label">Operations</span>
          </p>
          <ul aria-labelledby="nav-operations">
            {operationsNav.map(({ to, label, icon: NavIcon }) => (
              <li key={to}>
                <NavLink to={to} title={collapsed ? label : undefined}>
                  <NavIcon />
                  <span className="nav-label">{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  )

  return (
    <PageActionsProvider>
    <div className={`shell${collapsed ? ' shell--collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Application navigation">
        <div className="sidebar-brand">
          <BrandMark />
          <div className="nav-label sidebar-brand-text">
            <span className="sidebar-brand-name">bauhly</span>
            <span className="sidebar-brand-sub">BACKOFFICE</span>
          </div>
        </div>
        {nav}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-avatar" aria-hidden="true">
              {(session?.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="nav-label sidebar-user-text">
              <span className="sidebar-user-name">{session?.name}</span>
              <span className="sidebar-user-role">Admin</span>
            </div>
            <button
              type="button"
              className="icon-button icon-button--nav nav-label"
              onClick={signOut}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogoutIcon />
            </button>
          </div>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            <ChevronLeftIcon className={collapsed ? 'flip-x' : undefined} />
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>

      {/* Tablet/mobile drawer */}
      {drawerOpen && (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <aside
            className="drawer"
            aria-label="Application navigation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-head">
              <div className="sidebar-brand">
                <BrandMark />
                <div className="sidebar-brand-text">
                  <span className="sidebar-brand-name">bauhly</span>
                  <span className="sidebar-brand-sub">BACKOFFICE</span>
                </div>
              </div>
              <button
                type="button"
                className="icon-button icon-button--nav"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
              >
                <CloseIcon />
              </button>
            </div>
            {nav}
            <button type="button" className="drawer-signout" onClick={signOut}>
              <LogoutIcon /> Sign out
            </button>
          </aside>
        </div>
      )}

      <div className="shell-main">
        <header className="topbar">
          <button
            type="button"
            className="icon-button topbar-menu"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <MenuIcon />
          </button>
          <div className="topbar-heading">
            <h1 className="topbar-title">{title}</h1>
            {subtitle && <p className="topbar-subtitle">{subtitle}</p>}
          </div>
          <PageActionsSlot />
        </header>
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
    </div>
    </PageActionsProvider>
  )
}
