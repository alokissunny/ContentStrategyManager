/*
 * Settings — the accounts Bauhly reads, the formats it may plan with, and the
 * account you're signed in as.
 *
 * Restyled to the bauhly-v3 design (page-head + set-card/set-row), wired to the
 * real app: Instagram profiles come from the API, the account row and sign-out
 * are the real auth. Format preferences persist locally until the plan
 * generator reads them.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import { useAuth } from '../context/AuthContext';
import { listInstagramProfiles, activateInstagramProfile } from '../api/instagram';
import { getMetaStatus, startMetaConnect, disconnectMeta } from '../api/meta';
import './settings.css';

/* which formats Bauhly may use — held as EXCLUSIONS so a format added later is
 * on by default. Persisted locally (self-contained) until generation reads it. */
const FORMATS = ['Reels', 'Carousels', 'Stories', 'Single posts'];
const FORMAT_ICON = { Reels: 'play', Carousels: 'copy', Stories: 'eye', 'Single posts': 'brief' };
const DROPPED_KEY = 'bauhly_dropped_formats';
const loadDropped = () => {
  try { return JSON.parse(localStorage.getItem(DROPPED_KEY)) || []; } catch { return []; }
};

function initialsOf(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// First two letters of a handle — the header switcher's avatar convention.
function handleInitials(username = '') {
  return (username.replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'IG').toUpperCase();
}

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState('');
  const [dropped, setDropped] = useState(loadDropped);
  const [meta, setMeta] = useState({ connected: false, configured: false });
  const [metaBusy, setMetaBusy] = useState(false);

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => setProfiles(data.profiles || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
    getMetaStatus()
      .then(setMeta)
      .catch(() => setMeta({ connected: false, configured: false }));
  }, []);

  async function connectMeta() {
    setMetaBusy(true);
    try {
      const { url, state } = await startMetaConnect();
      if (state) sessionStorage.setItem('meta_oauth_state', state);
      if (url) window.location.href = url;
    } catch (err) {
      alert(err.response?.data?.message || 'Meta connect is not available yet.');
    } finally {
      setMetaBusy(false);
    }
  }

  async function disconnectMetaAccount() {
    setMetaBusy(true);
    try {
      setMeta(await disconnectMeta());
    } catch { /* ignore */ }
    finally { setMetaBusy(false); }
  }

  // Make another connected handle current — same path as the header switcher.
  async function switchTo(username) {
    if (!username || switching) return;
    const current = profiles[0];
    if (current && current.username === username) return;
    setSwitching(username);
    try {
      await activateInstagramProfile(username);
      window.location.reload();
    } catch (err) {
      alert(err.response?.data?.message || 'Could not switch Instagram account.');
      setSwitching('');
    }
  }

  const toggleFormat = (f) => {
    setDropped((prev) => {
      const next = prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f];
      try { localStorage.setItem(DROPPED_KEY, JSON.stringify(next)); } catch { /* quota */ }
      return next;
    });
  };

  const signOut = () => { logout(); navigate('/'); };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 'clamp(24px, 6vw, 48px) clamp(16px, 5vw, 48px)' }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">Settings</span>
          <h1>Accounts &amp; connections</h1>
        </div>
        {isAdmin && <span className="set-row__badge" style={{ alignSelf: 'center' }}>Admin</span>}
      </div>

      {/* ── Instagram ── */}
      <section className="card set-card">
        <h2>Instagram</h2>
        <p className="set-card__sub">
          Bauhly reads what&rsquo;s on a public profile: posts, formats, cadence, likes, comments and
          Reel views. Connect more than one handle — each gets its own Brand profile and plans.
          Switch from here or the header anytime.
        </p>

        {loading ? (
          <p className="set-empty">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="set-empty">No Instagram connected yet — add one below.</p>
        ) : (
          profiles.map((p, i) => {
            const isCurrent = i === 0;
            const busy = switching === p.username;
            const insights = meta.connected && meta.igUsername
              && meta.igUsername.toLowerCase() === p.username.toLowerCase();
            return (
              <button
                type="button"
                className={`set-row set-row--switch ${isCurrent ? 'is-active' : ''}`}
                key={p._id || p.username}
                disabled={!!switching || isCurrent}
                onClick={() => switchTo(p.username)}
                aria-current={isCurrent ? 'true' : undefined}
                title={isCurrent ? 'Current account' : `Switch to @${p.username}`}
              >
                <span className={`set-row__ico ${p.profilePicUrl ? '' : 'set-row__ico--avatar'}`}>
                  {p.profilePicUrl
                    ? <img src={p.profilePicUrl} alt="" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} />
                    : handleInitials(p.username)}
                </span>
                <span className="set-row__main">
                  <b className="set-row__title">@{p.username}</b>
                  <span className={`set-row__sub ${insights ? 'is-good' : ''}`}>
                    {busy
                      ? 'Switching…'
                      : insights
                        ? 'Insights connected — saves, reach, shares and profile visits'
                        : isCurrent
                          ? 'Current account · public profile'
                          : 'Tap to switch · public profile'}
                  </span>
                </span>
                {isCurrent && (
                  <span className="set-row__acts" title="Current account">
                    <Icon name="check" size={18} className="set-row__check" />
                  </span>
                )}
              </button>
            );
          })
        )}

        <div className="set-foot">
          <Link className="btn btn--ghost btn--sm" to="/onboarding?add=1">
            <Icon name="plus" size={14} strokeWidth={2.25} />
            Add another account
          </Link>
        </div>

        <p className="set-card__note">
          Profile analysis reads public posts. Publishing to Instagram uses a separate Meta connection below.
        </p>
      </section>

      {/* ── Meta publishing ── */}
      <section className="card set-card">
        <h2>Publish with Meta</h2>
        <p className="set-card__sub">
          Connect an Instagram Professional account (Business or Creator) linked to a Facebook Page
          so Bauhly can post carousels and Reels from your weekly plan.
        </p>

        {meta.connected ? (
          <div className="set-row is-active">
            <span className="set-row__ico"><Icon name="instagram" size={20} /></span>
            <span className="set-row__main">
              <b className="set-row__title">
                @{meta.igUsername || 'connected'}
                <span className="set-row__badge">Connected</span>
              </b>
              <span className="set-row__sub">
                {meta.pageName ? `Page: ${meta.pageName}` : 'Ready to publish from Your plans'}
              </span>
            </span>
          </div>
        ) : (
          <p className="set-empty">
            Not connected yet. You’ll also be prompted when you hit Publish on a post.
          </p>
        )}

        <div className="set-foot">
          {meta.connected ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={metaBusy}
              onClick={disconnectMetaAccount}
            >
              <Icon name="x" size={14} />
              Disconnect Meta
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={metaBusy}
              onClick={connectMeta}
            >
              <Icon name="instagram" size={14} />
              {metaBusy ? 'Connecting…' : 'Connect with Meta'}
            </button>
          )}
        </div>
      </section>

      {/* ── Formats ── */}
      <section className="card set-card">
        <h2>Formats Bauhly can use</h2>
        <p className="set-card__sub">Unticked formats are left out of every plan. Changes apply from your next plan.</p>
        {FORMATS.map((f) => {
          const on = !dropped.includes(f);
          return (
            <div className="set-row" key={f}>
              <span className="set-row__ico"><Icon name={FORMAT_ICON[f] || 'brief'} size={20} /></span>
              <span className="set-row__main">
                <b className="set-row__title">{f}</b>
                <span className="set-row__sub">{on ? 'Bauhly can plan these' : 'Left out of every plan'}</span>
              </span>
              <span className="set-row__acts">
                <button
                  className={`set-switch ${on ? 'is-on' : ''}`}
                  role="switch"
                  aria-checked={on}
                  aria-label={`${on ? 'Exclude' : 'Include'} ${f}`}
                  onClick={() => toggleFormat(f)}
                >
                  <i aria-hidden="true" />
                </button>
              </span>
            </div>
          );
        })}
        {dropped.length === FORMATS.length && (
          <p className="set-empty">Every format is off — Bauhly has nothing to plan with. Turn at least one back on.</p>
        )}
      </section>

      {/* ── You ── */}
      <section className="card set-card">
        <h2>You</h2>
        <div className="set-row">
          <span className="set-row__avatar">{initialsOf(user?.name)}</span>
          <span className="set-row__main">
            <b className="set-row__title">{user?.name || 'Your account'}</b>
            <span className="set-row__sub">{user?.email || ''}</span>
          </span>
          <span className="set-row__acts">
            <button className="btn btn--ghost btn--sm" onClick={signOut}>
              <Icon name="logout" size={14} />
              Sign out
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
