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

export default function AccountSwitcher() {
  const [profiles, setProfiles] = useState(readCachedProfiles);
  const [open, setOpen] = useState(false);

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
          <AccountsPanel onClose={() => setOpen(false)} />
        </>,
        document.body,
      )}
    </>
  );
}
