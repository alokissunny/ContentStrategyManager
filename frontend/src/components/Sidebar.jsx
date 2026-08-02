import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Glyph from './Glyph';
import UserMenu from './UserMenu';
import { useIsMobile } from '../hooks/useMediaQuery';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_SIGNAL, LS_SIGNAL_TEXT, LS_SOFT, LS_INK_MENU, LS_HOVER, LS_FONT, LS_DISPLAY } from '../theme';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Your plans', icon: 'route', exact: true },
  { to: '/dashboard/projects', label: 'Projects', icon: 'folder' },
  { to: '/dashboard/brand-dna', label: 'Brand profile', icon: 'fingerprint' },
  { to: '/dashboard/competitors', label: 'Competitors', icon: 'radar' },
  { to: '/dashboard/competitor-strategy', label: 'Competitor strategy', icon: 'swords' },
  { to: '/dashboard/settings', label: 'Settings', icon: 'settings' },
];

export default function Sidebar({ open = false, onClose }) {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();
  const [hovered, setHovered] = React.useState(null);

  return (
    <>
      {isMobile && open && (
        <div
          onClick={onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(17,24,39,0.35)', zIndex: 49 }}
        />
      )}
      <div
        style={{
          width: 232,
          flexShrink: 0,
          background: LS_SURFACE,
          borderRight: `1px solid ${LS_BORDER}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 16px',
          ...(isMobile
            ? {
                position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
                minHeight: '100vh',
                transform: open ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 220ms ease', boxShadow: open ? '0 0 0 100vw rgba(0,0,0,0)' : 'none',
              }
            : {
                position: 'sticky',
                top: 0,
                alignSelf: 'flex-start',
                height: '100vh',
                maxHeight: '100vh',
              }),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 28 }}>
          <span style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1, color: LS_INK }}>
            Bauhly<span style={{ color: LS_SIGNAL }}>.</span>
          </span>
          {isMobile && (
            <button
              onClick={onClose}
              aria-label="Close menu"
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, display: 'flex' }}
            >
              <Glyph name="x" size={20} color={LS_T2} />
            </button>
          )}
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {NAV_ITEMS.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            const hot = !active && hovered === item.to;
            // color follows the label (icons render with currentColor): accent-as-text
            // when selected, ink-800 at rest, ink-900 on hover — per bauhly-v3 .sb__link
            const tone = active ? LS_SIGNAL_TEXT : hot ? LS_INK : LS_INK_MENU;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                onMouseEnter={() => setHovered(item.to)}
                onMouseLeave={() => setHovered((h) => (h === item.to ? null : h))}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', borderRadius: 10,
                  textDecoration: 'none', fontFamily: LS_FONT, fontSize: 13,
                  fontWeight: active ? 600 : 500, color: tone,
                  background: active ? LS_SOFT : hot ? LS_HOVER : 'transparent',
                  transition: 'background 140ms ease, color 140ms ease',
                }}
              >
                <Glyph name={item.icon} size={18} strokeWidth={1.6} color={tone} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ flexShrink: 0, marginTop: 12 }}>
          <UserMenu />
        </div>
      </div>
    </>
  );
}
