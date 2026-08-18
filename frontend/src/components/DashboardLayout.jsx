import React from 'react';
import { Outlet, useLocation, NavLink, Link } from 'react-router-dom';
import Sidebar, { NAV_ITEMS } from './Sidebar';
import UserMenu from './UserMenu';
import AccountSwitcher from './AccountSwitcher';
import Glyph from './Glyph';
import AiDebugPanel from './AiDebugPanel';
import { Logo } from '../brand/Logo';
import { useScrollHide } from '../hooks/useScrollHide';

export default function DashboardLayout({ children }) {
  const { pathname } = useLocation();
  // Onboarding is a focused, full-screen flow — hide the app chrome so nothing
  // distracts from it, and skip `.app` so it keeps the marketing typefaces.
  const hideNav = pathname.startsWith('/onboarding');
  const navHidden = useScrollHide();
  const content = children ?? <Outlet />;

  if (hideNav) {
    return <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>{content}</div>;
  }

  return (
    <div className="app">
      {/* One header, every width: mark left, account right. The sidebar's only
        * job is navigation. On tablet and phone the user menu joins this bar
        * so Settings stays reachable when the sidebar is a rail or gone. */}
      <header className="apptop">
        <Logo size={22} as={Link} to="/dashboard" />
        <div className="apptop__end">
          <AccountSwitcher />
          <span className="apptop__user">
            <UserMenu compact />
          </span>
        </div>
      </header>
      <nav
        className="mtabs"
        aria-label="Main"
        style={{ transform: `translateY(${navHidden * 175}%)`, opacity: 1 - navHidden }}
      >
        {NAV_ITEMS.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.exact}
            className={({ isActive }) => (isActive ? 'is-active' : undefined)}
          >
            <Glyph name={n.icon} size={20} strokeWidth={1.6} />
            {n.label.replace('Your plans', 'Plans')}
          </NavLink>
        ))}
      </nav>

      <div className="app__body">
        <Sidebar />
        <main className="app__main">{content}</main>
      </div>
      <AiDebugPanel />
    </div>
  );
}
