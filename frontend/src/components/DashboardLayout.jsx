import React, { Suspense } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import Sidebar, { useNavItems } from './Sidebar';
import UserMenu from './UserMenu';
import AccountSwitcher from './AccountSwitcher';
import MobileNav from './MobileNav';
import AiDebugPanel from './AiDebugPanel';
import GenerationToast from './GenerationToast';
import CaptureHost from './CaptureHost';
import { Logo } from '../brand/Logo';
import { useScrollHide } from '../hooks/useScrollHide';
import { useActiveHandle } from '../lib/store';
import { openCaptureIdea } from '../lib/captureUi';

// the phone's tab bar draws the brand marks, solid on the destination you are
// on (bauhly-v3 AppShell `${icon}-fill`); other nav items keep their glyph
const TAB_MARK = { calendar: 'calendar', 'notebook-text': 'brief' };

function PageFallback() {
  return (
    <div className="ph" role="status">
      <p className="ph__sub">Loading…</p>
    </div>
  );
}

// Code-split routes suspend on their first visit. This boundary has to sit
// inside the shell: one above <Routes> replaces the sidebar and header with
// the fallback, which looks like a full page refresh.
function PageSlot({ handle, children }) {
  return (
    <Suspense fallback={<PageFallback />}>
      <React.Fragment key={handle || 'no-account'}>{children}</React.Fragment>
    </Suspense>
  );
}

export default function DashboardLayout({ children }) {
  const { pathname } = useLocation();
  // The active Instagram handle scopes almost every page's data. Switching it
  // (AccountSwitcher) re-keys the routed content below, remounting the current
  // page so its mount fetches re-run for the new account — a React remount, not
  // a full browser reload (no JS re-download, no asset waterfall).
  const activeHandle = useActiveHandle();
  const navItems = useNavItems();
  // keyed on the destinations: useNavItems() is a fresh array every render,
  // and MobileNav re-measures whenever its list changes identity
  const navKey = navItems.map((n) => n.to).join('|');
  const mobileItems = React.useMemo(() => navItems.map((n) => (TAB_MARK[n.icon]
    ? { to: n.to, end: n.exact, label: n.label, icon: TAB_MARK[n.icon] }
    : { to: n.to, end: n.exact, label: n.label, glyph: n.icon })), [navKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Onboarding is a focused, full-screen flow — hide the app chrome so nothing
  // distracts from it, and skip `.app` so it keeps the marketing typefaces.
  const hideNav = pathname.startsWith('/onboarding');
  const navHidden = useScrollHide();
  const content = children ?? <Outlet />;

  if (hideNav) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--canvas)' }}>
        <PageSlot handle={activeHandle}>{content}</PageSlot>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Mark left. Account chip + Bauhly user on the right (phone / tablet).
        * Desktop hides this bar — profile + accounts live in the sidebar foot. */}
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
      {/* Phone: the floating bar with Capture in its middle (bauhly-v3 MobileNav) */}
      <MobileNav items={mobileItems} hidden={navHidden} onCapture={() => openCaptureIdea()} />

      <div className="app__body">
        <Sidebar />
        <main className="app__main">
          <PageSlot handle={activeHandle}>{content}</PageSlot>
        </main>
      </div>
      <CaptureHost />
      <AiDebugPanel />
      <GenerationToast />
    </div>
  );
}
