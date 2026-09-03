import React from 'react';
import { Outlet, useLocation, NavLink, Link } from 'react-router-dom';
import Sidebar, { NAV_ITEMS } from './Sidebar';
import UserMenu from './UserMenu';
import AccountSwitcher from './AccountSwitcher';
import Glyph from './Glyph';
import AiDebugPanel from './AiDebugPanel';
import GenerationToast from './GenerationToast';
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
      {/* Mark left. Bauhly user (Settings / sign out) right. The Instagram
        * handle lives in the sidebar footer on desktop and joins this bar
        * when the sidebar is a rail or gone. */}
      <header className="apptop">
        <Logo size={22} as={Link} to="/dashboard" />
        <div className="apptop__end">
          <span className="apptop__acct">
            <AccountSwitcher />
          </span>
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
      <GenerationToast />
    </div>
  );
}
