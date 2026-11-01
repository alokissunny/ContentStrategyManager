/*
 * Instagram account switcher — header chip (tablet / phone).
 * Desktop uses the nested "Your Accounts" flyout inside UserMenu instead.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Glyph from './Glyph';
import AccountsPanel, { ProfileAvatar } from './AccountsPanel';
import MobileSheet from './MobileSheet';
import { listInstagramProfiles, readCachedProfiles } from '../api/instagram';
import { syncHandle } from '../lib/store';
import { useNavigate } from 'react-router-dom';
import { MENU_LINKS } from './UserMenu';
import { useAuth } from '../context/AuthContext';

/* On a phone the top bar carries ONE avatar — the account's — so the
 * signed-in person's links live in its sheet too (PhoneAccountSheet),
 * instead of a second chip beside it. */
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

/* The phone's account sheet (bauhly-v3 AccountMobileSheet): the account
 * first — one row that opens the full list under "Switch account" — then the
 * signed-in person's links. However many accounts there are, the menu itself
 * stays the same short list; the accounts scroll inside their own level. */
function PhoneAccountSheet({ current, open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [level, setLevel] = useState(null);
  useEffect(() => { if (!open) setLevel(null); }, [open]);
  const go = (to) => { onClose(); navigate(to.startsWith('/#') ? '/' : to); };
  const closeBtn = (
    <button type="button" className="msheet__nav acs-msheet__x" onClick={onClose} aria-label="Close">
      <Glyph name="x" size={20} strokeWidth={2.25} />
    </button>
  );

  if (level === 'accounts') {
    return (
      <MobileSheet open={open} title="Switch account" onBack={() => setLevel(null)} onClose={onClose} full className="acs-msheet">
        <AccountsPanel embedded label={null} onClose={onClose} />
      </MobileSheet>
    );
  }

  return (
    <MobileSheet open={open} title={`@${current.username}`} nav={false} actions={closeBtn} onClose={onClose} className="acs-msheet">
      <div role="menu" className="msheet__menu">
        <button type="button" role="menuitem" className="acs-msheet__who" onClick={() => setLevel('accounts')}>
          <ProfileAvatar profile={current} size={44} />
          <span className="pe-menu__grow">
            @{current.username}
            <em>Switch account</em>
          </span>
          <Glyph name="chevron-right" size={18} strokeWidth={2} />
        </button>
        <span className="acs-msheet__sep" />
        {user && MENU_LINKS.map((l) => (
          <button key={l.to} type="button" role="menuitem" disabled={l.disabled} onClick={() => go(l.to)}>
            <Glyph name={l.icon} size={20} strokeWidth={1.8} />
            <span className="pe-menu__grow">{l.label}</span>
          </button>
        ))}
        <span className="acs-msheet__sep" />
        <button type="button" role="menuitem" disabled>
          <Glyph name="info" size={20} strokeWidth={1.8} />
          <span className="pe-menu__grow">Help</span>
        </button>
        {user && (
          <button type="button" role="menuitem" onClick={() => { onClose(); logout(); navigate('/auth'); }}>
            <Glyph name="log-out" size={20} strokeWidth={1.8} />
            <span className="pe-menu__grow">Log out</span>
          </button>
        )}
      </div>
    </MobileSheet>
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
      {phone ? (
        <PhoneAccountSheet current={current} open={open} onClose={() => setOpen(false)} />
      ) : open && createPortal(
        <>
          <div className="acs-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <AccountsPanel onClose={() => setOpen(false)} />
        </>,
        document.body,
      )}
    </>
  );
}
