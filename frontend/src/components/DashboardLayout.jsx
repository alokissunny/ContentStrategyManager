import React, { useState } from 'react';
import Sidebar from './Sidebar';
import UserMenu from './UserMenu';
import Glyph from './Glyph';
import { useIsMobile } from '../hooks/useMediaQuery';
import { LS_BG, LS_SURFACE, LS_BORDER, LS_INK, LS_SIGNAL, LS_FONT } from '../theme';

export default function DashboardLayout({ children }) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100vh', background: LS_BG }}>
      {isMobile && (
        <div
          style={{
            position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            height: 56, padding: '0 16px', background: LS_SURFACE, borderBottom: `1px solid ${LS_BORDER}`,
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 6, display: 'flex' }}
          >
            <Glyph name="menu" size={22} color={LS_INK} />
          </button>
          <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 16, letterSpacing: '-0.03em' }}>
            <span style={{ color: LS_INK }}>wide</span><span style={{ color: LS_SIGNAL }}>signals</span>
          </span>
          <UserMenu compact />
        </div>
      )}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
