import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import Glyph from './Glyph';
import { useAuth } from '../context/AuthContext';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT } from '../theme';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: 'layout-grid', exact: true },
  { to: '/dashboard/content-route', label: 'Content Route', icon: 'share-2' },
  { to: '/dashboard/brand-dna', label: 'Brand DNA', icon: 'fingerprint' },
  { to: '/dashboard/settings', label: 'Settings', icon: 'settings' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  return (
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
        position: 'sticky',
        top: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 28 }}>
        <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 18, letterSpacing: '-0.03em' }}>
          <span style={{ color: LS_INK }}>wide</span><span style={{ color: LS_SIGNAL }}>signals</span>
        </span>
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {NAV_ITEMS.map((item) => {
          const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
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

      <button
        onClick={logout}
        title="Log out"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
          border: `1px solid ${LS_BORDER}`, background: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%', background: LS_INK, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: LS_FONT, fontWeight: 700, fontSize: 13,
        }}>
          {(user?.name || 'U').slice(0, 1).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user?.name || 'Your'}
          </div>
          <div style={{ fontFamily: LS_FONT, fontSize: 11, color: LS_MUTED }}>Log out</div>
        </div>
      </button>
    </div>
  );
}
