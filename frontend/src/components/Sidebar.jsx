import React from 'react';
import { NavLink } from 'react-router-dom';
import Glyph from './Glyph';
import UserMenu from './UserMenu';

// Settings, Business memory (the brand profile) and Competitor overview live in
// the user menu at the bottom of the sidebar (see UserMenu), not in the main nav.
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
        <UserMenu />
      </div>
    </aside>
  );
}
