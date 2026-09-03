import React from 'react';
import { NavLink } from 'react-router-dom';
import Glyph from './Glyph';
import AccountSwitcher from './AccountSwitcher';

// Settings, Business memory and Competitor overview live in the header user
// menu. The sidebar footer is the Instagram account switcher.
export const NAV_ITEMS = [
  { to: '/dashboard', label: 'Your plans', icon: 'route', exact: true },
  { to: '/dashboard/projects', label: 'Projects', icon: 'folder' },
  { to: '/dashboard/visual-library', label: 'Visual Library', icon: 'layout-grid' },
];

export default function Sidebar() {
  return (
    <aside className="sb">
      <nav className="sb__nav" aria-label="Main">
        {NAV_ITEMS.map((item) => (
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
