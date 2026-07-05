import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Glyph from './Glyph';
import UserMenu from './UserMenu';
import { useIsMobile } from '../hooks/useMediaQuery';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_SIGNAL, LS_SOFT, LS_FONT } from '../theme';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'layout-grid', exact: true },
  { to: '/dashboard/content-route', label: 'Content Route', icon: 'share-2' },
  { to: '/dashboard/brand-dna', label: 'Brand DNA', icon: 'fingerprint' },
  { to: '/dashboard/settings', label: 'Settings', icon: 'settings' },
];

export default function Sidebar({ open = false, onClose }) {
  const { pathname } = useLocation();
  const isMobile = useIsMobile();

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
          width: 240,
          flexShrink: 0,
          minHeight: '100vh',
          background: LS_SURFACE,
          borderRight: `1px solid ${LS_BORDER}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '22px 16px',
          ...(isMobile
            ? {
                position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
                transform: open ? 'translateX(0)' : 'translateX(-100%)',
                transition: 'transform 220ms ease', boxShadow: open ? '0 0 0 100vw rgba(0,0,0,0)' : 'none',
              }
            : { position: 'sticky', top: 0 }),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 28 }}>
          <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 18, letterSpacing: '-0.03em' }}>
            <span style={{ color: LS_INK }}>wide</span><span style={{ color: LS_SIGNAL }}>signals</span>
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

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map((item) => {
            const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                style={{
                  display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 8,
                  textDecoration: 'none', fontFamily: LS_FONT, fontSize: 14, fontWeight: 600,
                  color: active ? LS_SIGNAL : LS_INK, background: active ? LS_SOFT : 'transparent',
                }}
              >
                <Glyph name={item.icon} size={18} color={active ? LS_SIGNAL : LS_T2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ flex: 1 }} />

        <UserMenu />
      </div>
    </>
  );
}
