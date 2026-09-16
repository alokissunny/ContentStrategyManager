import React from 'react';
import { NavLink } from 'react-router-dom';
import Glyph from './Glyph';
import AccountSwitcher from './AccountSwitcher';
import { useFeatureFlags } from '../lib/featureFlags';

// Settings, Visual Library, Business memory and Competitor overview live in the
// header user menu. The sidebar footer is the Instagram account switcher.
export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Calendar', icon: 'calendar', exact: true },
  { to: '/dashboard/projects', label: 'Projects', icon: 'folder' },
];

// Nav items that only appear when their experimental feature flag is on.
const FLAGGED_NAV_ITEMS = [
  { to: '/dashboard/reel-editor', label: 'Reel editor', icon: 'clapperboard', flag: 'reelEditor' },
];

// The nav the current browser should see — base items plus any enabled
// experimental pages. Used by both the desktop sidebar and the mobile tabs so
// they stay in sync.
export function useNavItems() {
  const flags = useFeatureFlags();
  return [...NAV_ITEMS, ...FLAGGED_NAV_ITEMS.filter((item) => flags[item.flag])];
}

export default function Sidebar() {
  const navItems = useNavItems();
  return (
    <aside className="sb">
      <nav className="sb__nav" aria-label="Main">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) => `sb__link${isActive ? ' is-active' : ''}`}
          >
            <Glyph name={item.icon} size={18} strokeWidth={1.6} />
            {/* hidden on the tablet rail; `title` keeps the name on hover */}
            <span className="sb__label" title={item.label}>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sb__foot">
        <AccountSwitcher variant="sidebar" />
      </div>
    </aside>
  );
}
