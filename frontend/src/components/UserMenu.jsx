import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Glyph from './Glyph';
import { useAuth } from '../context/AuthContext';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_FONT } from '../theme';

function UserAvatar({ user, size = 32 }) {
  const initial = (user?.name || 'U').slice(0, 1).toUpperCase();

  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.name || 'User'}
        referrerPolicy="no-referrer"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          border: `1px solid ${LS_BORDER}`,
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: LS_INK,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: LS_FONT,
        fontWeight: 700,
        fontSize: Math.round(size * 0.4),
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClick(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate('/auth');
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 0 : 10,
          padding: compact ? 4 : '10px 12px',
          borderRadius: compact ? '50%' : 8,
          border: compact ? 'none' : `1px solid ${LS_BORDER}`,
          background: compact ? 'none' : 'none',
          cursor: 'pointer',
          textAlign: 'left',
          width: compact ? 'auto' : '100%',
        }}
      >
        <UserAvatar user={user} size={compact ? 34 : 32} />
        {!compact && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: LS_FONT,
                  fontSize: 13,
                  fontWeight: 600,
                  color: LS_INK,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.name}
              </div>
              <div
                style={{
                  fontFamily: LS_FONT,
                  fontSize: 11,
                  color: LS_MUTED,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user.email}
              </div>
            </div>
            <Glyph name={open ? 'chevron-up' : 'chevron-down'} size={16} color={LS_T2} />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: compact ? 'auto' : 'calc(100% + 8px)',
            top: compact ? 'calc(100% + 8px)' : 'auto',
            right: compact ? 0 : 0,
            left: compact ? 'auto' : 0,
            minWidth: compact ? 220 : undefined,
            background: LS_SURFACE,
            border: `1px solid ${LS_BORDER}`,
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(17,24,39,0.12)',
            padding: 6,
            zIndex: 60,
          }}
        >
          {compact && (
            <div style={{ padding: '8px 10px 10px', borderBottom: `1px solid ${LS_BORDER}`, marginBottom: 4 }}>
              <div style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_INK }}>{user.name}</div>
              <div style={{ fontFamily: LS_FONT, fontSize: 11, color: LS_MUTED, marginTop: 2 }}>{user.email}</div>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '10px 12px',
              border: 'none',
              borderRadius: 8,
              background: 'transparent',
              cursor: 'pointer',
              fontFamily: LS_FONT,
              fontSize: 13,
              fontWeight: 600,
              color: LS_SIGNAL,
              textAlign: 'left',
            }}
          >
            <Glyph name="log-out" size={16} color={LS_SIGNAL} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
