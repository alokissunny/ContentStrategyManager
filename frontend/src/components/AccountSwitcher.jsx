/*
 * Header account switcher — the current Instagram handle top-right, with a
 * dropdown to switch between connected accounts or add another. Switching
 * calls /instagram/activate, which re-points the app's "current" handle, then
 * reloads so every page picks up the new account.
 *
 * Look & feel matches the bauhly-v3 design system: ink-900 round avatars,
 * an r-lg card on shadow-md, signal-50/100/500 for the active account, and a
 * dashed "add" affordance — the same language as the sidebar user/status block.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Glyph from './Glyph';
import { listInstagramProfiles, activateInstagramProfile } from '../api/instagram';
import { getMetaStatus } from '../api/meta';
import { LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_SOFT_BORDER, LS_HOVER, LS_FONT } from '../theme';

// Tokens not exposed on the LS_* palette but part of the shared design system.
const SUNKEN = '#F6F6F8';   // --surface-sunken
const POSITIVE = '#0A6E46'; // --positive / --trust-600 (this app's AA-safe green)
const INK_500 = '#6C6C79';  // --ink-500
const SHADOW_MD = '0 2px 6px rgba(22,22,26,0.06), 0 14px 36px rgba(22,22,26,0.09)';

function handleInitials(username = '') {
  return (username.replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'IG').toUpperCase();
}

function Avatar({ profile, size = 34 }) {
  const [broken, setBroken] = useState(false);
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    objectFit: 'cover',
  };
  const showImg = profile?.profilePicUrl && !broken;
  if (showImg) {
    return (
      <img
        src={profile.profilePicUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={{ ...base, border: `1px solid ${LS_BORDER}` }}
      />
    );
  }
  return (
    <div
      style={{
        ...base, background: LS_INK, color: '#fff', display: 'grid', placeItems: 'center',
        fontFamily: LS_FONT, fontWeight: 700, fontSize: Math.round(size * 0.34),
      }}
    >
      {handleInitials(profile?.username)}
    </div>
  );
}

export default function AccountSwitcher() {
  const [profiles, setProfiles] = useState([]);
  const [meta, setMeta] = useState(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => setProfiles(data.profiles || []))
      .catch(() => setProfiles([]));
    getMetaStatus().then(setMeta).catch(() => setMeta(null));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onClick(e) {
      if (!ref.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Backend returns the current handle first.
  const current = profiles[0];
  if (!current) return null;

  // Insights are a single Meta connection today; show the green "connected"
  // state only on the handle it actually belongs to.
  const insightsConnected = (username) =>
    !!(meta?.connected && meta.igUsername && meta.igUsername.toLowerCase() === username.toLowerCase());

  async function switchTo(username) {
    if (username === current.username || switching) return;
    setSwitching(username);
    try {
      await activateInstagramProfile(username);
      // The current handle drives plans, brand profile and analysis app-wide;
      // a full reload is the simplest way to refresh every page's data.
      window.location.reload();
    } catch {
      setSwitching('');
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px 5px 14px',
          borderRadius: 999, border: 'none', background: open ? SUNKEN : 'transparent', cursor: 'pointer',
          fontFamily: LS_FONT, fontSize: 14, fontWeight: 600, color: LS_INK, transition: 'background 140ms ease',
        }}
        onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = SUNKEN; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          @{current.username}
        </span>
        <Glyph name="chevron-down" size={16} color={LS_T2} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }} />
        <Avatar profile={current} size={34} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 10px)', right: 0, minWidth: 300,
            background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 18,
            boxShadow: SHADOW_MD, padding: 8, zIndex: 60,
          }}
        >
          <div style={{ padding: '6px 10px 8px', fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: LS_MUTED }}>
            YOUR ACCOUNTS
          </div>
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
                disabled={!!switching}
                onClick={() => switchTo(p.username)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px',
                  border: active ? `1px solid ${LS_SOFT_BORDER}` : '1px solid transparent', borderRadius: 12,
                  background: active ? LS_SOFT : 'transparent', cursor: switching ? 'default' : 'pointer',
                  textAlign: 'left', font: 'inherit', fontFamily: LS_FONT, marginBottom: 2,
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={(e) => { if (!active && !switching) e.currentTarget.style.background = LS_HOVER; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <Avatar profile={p} size={34} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: LS_INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    @{p.username}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, marginTop: 1, color: busy ? INK_500 : insights ? POSITIVE : INK_500 }}>
                    {busy ? 'Switching…' : insights ? 'Insights connected' : 'Public profile only'}
                  </span>
                </span>
                {active && <Glyph name="check" size={18} color={LS_SIGNAL} />}
              </button>
            );
          })}

          <div style={{ height: 1, background: LS_BORDER, margin: '6px 4px 8px' }} />

          <Link
            to="/onboarding?add=1"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px', borderRadius: 12,
              textDecoration: 'none', fontFamily: LS_FONT, fontSize: 14, fontWeight: 600, color: LS_INK,
              transition: 'background 120ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = LS_HOVER; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 34, height: 34, borderRadius: '50%', border: `1px dashed ${LS_MUTED}`, background: SUNKEN, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Glyph name="plus" size={16} color={LS_T2} />
            </span>
            Add another account
          </Link>
        </div>
      )}
    </div>
  );
}
