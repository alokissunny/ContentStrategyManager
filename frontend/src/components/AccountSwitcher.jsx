/*
 * Instagram account switcher — header chip (tablet / phone).
 * Desktop uses the nested "Your Accounts" flyout inside UserMenu instead.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Glyph from './Glyph';
import AccountsPanel, { ProfileAvatar } from './AccountsPanel';
import { listInstagramProfiles, readCachedProfiles } from '../api/instagram';
import { syncHandle } from '../lib/store';
import { useNavigate } from 'react-router-dom';
import { MENU_LINKS } from './UserMenu';
import { useAuth } from '../context/AuthContext';

/* On a phone the top bar carries ONE avatar — the account's — so the
 * signed-in person's links live in this sheet under the accounts (bauhly-v3
 * AccountMobileSheet), instead of a second chip beside it. */
const PHONE = '(max-width: 767px)';
function usePhone() {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const f = () => setOn(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return on;
}

function UserRows({ onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const go = (to) => { onClose(); navigate(to.startsWith('/#') ? '/' : to); };
  return (
    <>
      <div className="acs-sheet__sep" />
      <span className="acs-sheet__label">{user.name || user.email}</span>
      {MENU_LINKS.filter((l) => !l.muted).map((l) => (
        <button key={l.to} type="button" role="menuitem" className="acs-opt acs-opt--quiet acs-opt--link" onClick={() => go(l.to)}>
          <span className="acs-opt__avatar acs-opt__avatar--ghost"><Glyph name={l.icon} size={16} strokeWidth={2} /></span>
          <span className="acs-opt__text"><b>{l.label}</b></span>
        </button>
      ))}
      <button type="button" role="menuitem" className="acs-opt acs-opt--quiet acs-opt--link" onClick={() => { onClose(); logout(); navigate('/auth'); }}>
        <span className="acs-opt__avatar acs-opt__avatar--ghost"><Glyph name="log-out" size={16} strokeWidth={2} /></span>
        <span className="acs-opt__text"><b>Log out</b></span>
      </button>
    </>
  );
}

export default function AccountSwitcher() {
  const [profiles, setProfiles] = useState(readCachedProfiles);
  const [open, setOpen] = useState(false);
  const phone = usePhone();

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => {
        const list = data.profiles || [];
        setProfiles(list);
        if (list[0]) syncHandle(list[0].username);
      })
      .catch(() => setProfiles([]));
  }, []);

  const current = profiles[0];
  if (!current) return null;

  return (
    <>
      <button
        type="button"
        className="acs"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Account @${current.username}. Switch account`}
      >
        <span className="acs__handle">@{current.username}</span>
        <Glyph name="chevron-down" size={14} strokeWidth={2.25} />
        <ProfileAvatar profile={current} size={28} className="acs__avatar" />
      </button>
      {open && createPortal(
        <>
          <div className="acs-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <AccountsPanel onClose={() => setOpen(false)} footer={phone ? <UserRows onClose={() => setOpen(false)} /> : null} />
        </>,
        document.body,
      )}
    </>
  );
}
