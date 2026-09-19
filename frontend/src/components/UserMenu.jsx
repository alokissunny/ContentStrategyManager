/*
 * Sidebar / header profile control (bauhly-v3 + account flyout).
 *
 * Collapsed: avatar + name + chevron at the foot of the sidebar.
 * Open: menu with profile row (opens "Your Accounts" to the right),
 * Upgrade / Settings / Help / Log out — matching the Bauhly account panels.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Glyph from './Glyph';
import AccountsPanel from './AccountsPanel';
import { useAuth } from '../context/AuthContext';

function userInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  }
  return (parts[0] || 'U').slice(0, 2).toUpperCase();
}

function UserAvatar({ user, size = 32 }) {
  if (user?.avatar) {
    return (
      <img
        className="sb__avatar"
        src={user.avatar}
        alt=""
        referrerPolicy="no-referrer"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="sb__avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}>
      {userInitials(user?.name)}
    </span>
  );
}

const MENU_LINKS = [
  { label: 'Upgrade plan', icon: 'sparkles', to: '/#pricing', muted: true },
  { label: 'Settings', icon: 'sun', to: '/dashboard/settings' },
  { label: 'Visual Library', icon: 'layout-grid', to: '/dashboard/visual-library' },
  { label: 'Business memory', icon: 'file-text', to: '/dashboard/brand-dna' },
  { label: 'Competitor overview', icon: 'trending-up', to: '/dashboard/competitor-overview' },
];

export default function UserMenu({ compact = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    setOpen(false);
    setAccountsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onAway(e) {
      if (!menuRef.current?.contains(e.target)) {
        setOpen(false);
        setAccountsOpen(false);
      }
    }
    function onEsc(e) {
      if (e.key === 'Escape') {
        if (accountsOpen) setAccountsOpen(false);
        else setOpen(false);
      }
    }
    document.addEventListener('mousedown', onAway);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onAway);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open, accountsOpen]);

  if (!user) return null;

  function handleLogout() {
    logout();
    navigate('/auth');
  }

  function go(path) {
    setOpen(false);
    setAccountsOpen(false);
    if (path.startsWith('/#')) {
      navigate('/');
      return;
    }
    navigate(path);
  }

  function closeAll() {
    setOpen(false);
    setAccountsOpen(false);
  }

  return (
    <div ref={menuRef} className={`sb__userwrap${compact ? ' sb__userwrap--compact' : ''}`}>
      {open && (
        <div className="sb__menu" role="menu">
          {/* Profile row → opens Your Accounts beside this panel (desktop).
              On the compact header chip, account switching is the header acs. */}
          <button
            type="button"
            role="menuitem"
            className={`sb__menuitem sb__menuitem--profile${accountsOpen ? ' is-on' : ''}`}
            aria-haspopup={compact ? undefined : 'menu'}
            aria-expanded={compact ? undefined : accountsOpen}
            onClick={() => {
              if (compact) return;
              setAccountsOpen((v) => !v);
            }}
          >
            <UserAvatar user={user} size={32} />
            <span className="sb__menuitem__label">{user.name}</span>
            {!compact && <Glyph name="chevron-right" size={16} strokeWidth={2} />}
          </button>

          <span className="sb__menusep" />

          {MENU_LINKS.map((link) => (
            <button
              key={link.to}
              type="button"
              role="menuitem"
              className={`sb__menuitem${link.muted ? ' sb__menuitem--muted' : ''}`}
              onClick={() => go(link.to)}
            >
              <Glyph name={link.icon} size={16} strokeWidth={1.9} />
              {link.label}
            </button>
          ))}

          <span className="sb__menusep" />

          <button
            type="button"
            role="menuitem"
            className="sb__menuitem"
            onClick={() => go('/dashboard/settings')}
          >
            <Glyph name="info" size={16} strokeWidth={1.9} />
            <span className="sb__menuitem__label">Help</span>
            <Glyph name="chevron-right" size={16} strokeWidth={2} />
          </button>

          <button
            type="button"
            role="menuitem"
            className="sb__menuitem"
            onClick={handleLogout}
          >
            <Glyph name="log-out" size={16} strokeWidth={1.9} />
            Log out
          </button>

          {accountsOpen && !compact && (
            <div className="sb__accounts">
              <AccountsPanel inline onClose={closeAll} />
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className={`sb__user${open ? ' is-open' : ''}${compact ? ' sb__user--compact' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.name}
        onClick={() => {
          setOpen((v) => !v);
          if (open) setAccountsOpen(false);
        }}
      >
        <UserAvatar user={user} size={compact ? 34 : 32} />
        {!compact && (
          <>
            <span className="sb__who">
              <span className="sb__name">{user.name}</span>
            </span>
            <Glyph name="chevron-down" size={15} strokeWidth={2.25} className="sb__user-chevron" />
          </>
        )}
      </button>
    </div>
  );
}
