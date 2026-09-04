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
import { getMetaStatus, startMetaConnect, disconnectMeta, metaConnectionFor } from '../api/meta';
import { syncHandle } from '../lib/store';
import { resetProjects } from '../lib/projectsStore';
import { useAiDebug, setAiDebugEnabled, clearAiDebugEntries } from '../lib/aiDebug';
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

function metaConnections(meta) {
  if (Array.isArray(meta?.connections)) return meta.connections;
  if (meta?.connected && meta.igUsername) {
    return [{
      igUserId: meta.igUserId || meta.igUsername,
      igUsername: meta.igUsername,
      pageName: meta.pageName || null,
      connectedAt: meta.connectedAt || null,
    }];
  }
  return [];
}

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState('');
  const [dropped, setDropped] = useState(loadDropped);
  const [meta, setMeta] = useState({ connected: false, configured: false, connections: [] });
  const [metaBusy, setMetaBusy] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState('');
  const debug = useAiDebug();

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => setProfiles(data.profiles || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
    getMetaStatus()
      .then(setMeta)
      .catch(() => setMeta({ connected: false, configured: false, connections: [] }));
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

  async function disconnectMetaAccount(igUserId) {
    if (!igUserId) return;
    setDisconnectingId(igUserId);
    try {
      setMeta(await disconnectMeta(igUserId));
    } catch (err) {
      alert(err.response?.data?.message || 'Could not disconnect that account.');
    } finally {
      setDisconnectingId('');
    }
  }

  // Make another connected handle current — same path as the header switcher.
  async function switchTo(username) {
    if (!username || switching) return;
    const current = profiles[0];
    if (current && current.username === username) return;
    setSwitching(username);
    try {
      syncHandle(username);
      resetProjects();
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
  const connections = metaConnections(meta);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
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
          Reel views. Connect more than one handle — each gets its own Business memory and plans.
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
            const metaLink = metaConnectionFor(meta, p.username);
            const insights = !!metaLink;
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
                    ? (
                      <img
                        src={p.profilePicUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const parent = e.currentTarget.parentElement;
                          if (parent && !parent.dataset.fallback) {
                            parent.dataset.fallback = '1';
                            parent.classList.add('set-row__ico--avatar');
                            parent.textContent = handleInitials(p.username);
                          }
                        }}
                      />
                    )
                    : handleInitials(p.username)}
                </span>
                <span className="set-row__main">
                  <b className="set-row__title">@{p.username}</b>
                  <span className={`set-row__sub ${insights ? 'is-good' : ''}`}>
                    {busy
                      ? 'Switching…'
                      : insights
                        ? (metaLink.pageName
                          ? `Publishes via Meta · Page: ${metaLink.pageName}`
                          : 'Meta connected — ready to publish')
                        : isCurrent
                          ? 'Current account · public profile · Meta not linked'
                          : 'Tap to switch · public profile · Meta not linked'}
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
          Profile analysis reads public posts. Publishing uses the Meta link shown under each handle.
        </p>
      </section>

      {/* ── Meta publishing ── */}
      <section className="card set-card">
        <h2>Publish with Meta</h2>
        <p className="set-card__sub">
          Each Bauhly Instagram handle must match the Meta Instagram it publishes to.
          The Facebook Page on the right is the Page Bauhly posts through for that handle.
        </p>

        {profiles.length === 0 && connections.length === 0 ? (
          <p className="set-empty">
            Not connected yet. You’ll also be prompted when you hit Publish on a post.
          </p>
        ) : (
          <>
            {profiles.map((p) => {
              const link = metaConnectionFor(meta, p.username);
              const id = link?.igUserId || link?.igUsername;
              const busy = id && disconnectingId === id;
              return (
                <div className={`set-row ${link ? 'is-active' : ''}`} key={`meta-${p._id || p.username}`}>
                  <span className="set-row__ico"><Icon name="instagram" size={20} /></span>
                  <span className="set-row__main">
                    <b className="set-row__title">
                      @{p.username}
                      {link
                        ? <span className="set-row__badge">Linked</span>
                        : <span className="set-row__badge set-row__badge--muted">Not linked</span>}
                    </b>
                    {link ? (
                      <span className="set-row__sub set-linkmap">
                        <span className="set-linkmap__pair">
                          Bauhly <b>@{p.username}</b>
                          <span className="set-linkmap__arrow" aria-hidden="true">→</span>
                          Meta <b>@{link.igUsername || p.username}</b>
                        </span>
                        <span className="set-linkmap__page">
                          {link.pageName
                            ? <>Facebook Page: <b>{link.pageName}</b></>
                            : 'Facebook Page linked'}
                        </span>
                      </span>
                    ) : (
                      <span className="set-row__sub">
                        Connect Meta with the Facebook login that owns @{p.username}&rsquo;s Page.
                      </span>
                    )}
                  </span>
                  <span className="set-row__acts">
                    {link ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || metaBusy}
                        onClick={() => disconnectMetaAccount(id)}
                        title={`Disconnect Meta for @${p.username}`}
                      >
                        <Icon name="x" size={14} />
                        {busy ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={metaBusy}
                        onClick={connectMeta}
                      >
                        <Icon name="instagram" size={14} />
                        {metaBusy ? 'Connecting…' : 'Connect'}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}

            {/* Meta IGs that don't match any Bauhly handle — shown so they can be removed */}
            {connections
              .filter((c) => {
                const ig = String(c.igUsername || '').toLowerCase();
                return ig && !profiles.some((p) => String(p.username || '').toLowerCase() === ig);
              })
              .map((c) => {
                const id = c.igUserId || c.igUsername;
                const busy = disconnectingId === id;
                return (
                  <div className="set-row" key={`orphan-${id}`}>
                    <span className="set-row__ico"><Icon name="info" size={20} /></span>
                    <span className="set-row__main">
                      <b className="set-row__title">
                        @{c.igUsername}
                        <span className="set-row__badge set-row__badge--warn">No Bauhly account</span>
                      </b>
                      <span className="set-row__sub set-linkmap">
                        <span className="set-linkmap__pair">
                          Meta <b>@{c.igUsername}</b> is connected, but you have no matching Bauhly Instagram handle.
                        </span>
                        <span className="set-linkmap__page">
                          {c.pageName
                            ? <>Facebook Page: <b>{c.pageName}</b></>
                            : 'Orphan Meta connection'}
                        </span>
                      </span>
                    </span>
                    <span className="set-row__acts">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || metaBusy}
                        onClick={() => disconnectMetaAccount(id)}
                        title={`Disconnect @${c.igUsername}`}
                      >
                        <Icon name="x" size={14} />
                        {busy ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </span>
                  </div>
                );
              })}
          </>
        )}

        <div className="set-foot">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={metaBusy}
            onClick={connectMeta}
          >
            <Icon name="instagram" size={14} />
            {metaBusy
              ? 'Connecting…'
              : connections.length
                ? 'Connect another Meta account'
                : 'Connect with Meta'}
          </button>
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

      {/* ── Debug ── */}
      <section className="card set-card">
        <h2>Debug mode</h2>
        <p className="set-card__sub">
          When on, Bauhly records prompts sent in AI calls and the model output for each, and shows them in a collapsible side panel.
        </p>
        <div className="set-row">
          <span className="set-row__ico"><Icon name="bug" size={19} /></span>
          <span className="set-row__main">
            <b className="set-row__title">AI prompt debug panel</b>
            <span className="set-row__sub">
              {debug.enabled
                ? `On · ${debug.entries.length} prompt${debug.entries.length === 1 ? '' : 's'} logged`
                : 'Off'}
            </span>
          </span>
          <span className="set-row__acts">
            {debug.enabled && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={clearAiDebugEntries}>
                <Icon name="x" size={14} />
                Clear log
              </button>
            )}
            <button
              className={`set-switch ${debug.enabled ? 'is-on' : ''}`}
              role="switch"
              aria-checked={debug.enabled}
              aria-label={`${debug.enabled ? 'Disable' : 'Enable'} debug mode`}
              onClick={() => setAiDebugEnabled(!debug.enabled)}
            >
              <i aria-hidden="true" />
            </button>
          </span>
        </div>
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
