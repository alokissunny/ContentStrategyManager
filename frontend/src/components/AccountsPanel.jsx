/*
 * "Your Accounts" list — switch Instagram handle or add another.
 * Used inside the sidebar profile menu (flyout) and the header switcher sheet.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Glyph from './Glyph';
import { listInstagramProfiles, readCachedProfiles, activateInstagramProfile } from '../api/instagram';
import { getMetaStatus, isMetaConnectedFor } from '../api/meta';
import { syncHandle } from '../lib/store';
import { resetProjects } from '../lib/projectsStore';

function handleInitials(username = '') {
  return (username.replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'IG').toUpperCase();
}

export function ProfileAvatar({ profile, size = 34, className = '' }) {
  const [broken, setBroken] = useState(false);
  const showImg = profile?.profilePicUrl && !broken;

  if (showImg) {
    return (
      <img
        className={`acs-opt__avatar ${className}`.trim()}
        src={profile.profilePicUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`acs-opt__avatar ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
    >
      {handleInitials(profile?.username)}
    </span>
  );
}

export default function AccountsPanel({ onClose, label = 'Your accounts', inline = false }) {
  const sheetClass = inline ? 'acs-sheet acs-sheet--inline' : 'acs-sheet';
  const [profiles, setProfiles] = useState(readCachedProfiles);
  const [meta, setMeta] = useState(null);
  const [switching, setSwitching] = useState('');

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => {
        const list = data.profiles || [];
        setProfiles(list);
        if (list[0]) syncHandle(list[0].username);
      })
      .catch(() => setProfiles([]));
    getMetaStatus().then(setMeta).catch(() => setMeta(null));
  }, []);

  const current = profiles[0];
  const insightsConnected = (username) => isMetaConnectedFor(meta, username);

  async function switchTo(username) {
    if (!current || username === current.username || switching) return;
    setSwitching(username);
    try {
      resetProjects();
      const data = await activateInstagramProfile(username);
      if (data?.profiles?.length) setProfiles(data.profiles);
      syncHandle(username);
      onClose?.();
    } catch {
      /* leave current selected */
    } finally {
      setSwitching('');
    }
  }

  if (!current) {
    return (
      <div className={sheetClass} role="menu" aria-label="Switch account">
        <span className="acs-sheet__label">{label}</span>
        <Link
          className="acs-opt acs-opt--quiet"
          to="/onboarding?add=1"
          role="menuitem"
          onClick={() => onClose?.()}
        >
          <span className="acs-opt__avatar acs-opt__avatar--ghost">
            <Glyph name="plus" size={16} strokeWidth={2.5} />
          </span>
          <span className="acs-opt__text"><b>Add an account</b></span>
        </Link>
      </div>
    );
  }

  return (
    <div className={sheetClass} role="menu" aria-label="Switch account">
      <span className="acs-sheet__label">{label}</span>
      {profiles.map((p) => {
        const active = p.username === current.username;
        const busy = switching === p.username;
        const insights = insightsConnected(p.username);
        return (
          <button
            key={p._id || p.username}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            className={`acs-opt${active ? ' is-on' : ''}`}
            disabled={!!switching}
            onClick={() => switchTo(p.username)}
          >
            <ProfileAvatar profile={p} size={34} />
            <span className="acs-opt__text">
              <b>@{p.username}</b>
              <span>
                {busy ? 'Switching…' : insights ? 'Insights connected' : 'Public profile only'}
              </span>
            </span>
            {active && <Glyph name="check" size={18} strokeWidth={2.5} />}
          </button>
        );
      })}
      <div className="acs-sheet__sep" />
      <Link
        className="acs-opt acs-opt--quiet"
        to="/onboarding?add=1"
        role="menuitem"
        onClick={() => onClose?.()}
      >
        <span className="acs-opt__avatar acs-opt__avatar--ghost">
          <Glyph name="plus" size={16} strokeWidth={2.5} />
        </span>
        <span className="acs-opt__text"><b>Add another account</b></span>
      </Link>
    </div>
  );
}
