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
import { listInstagramProfiles, activateInstagramProfile, refreshInstagramMedia } from '../api/instagram';
import { getMetaStatus, startMetaConnect, disconnectMeta, metaConnectionFor, rememberMetaOAuthReturn } from '../api/meta';
import { syncHandle } from '../lib/store';
import { resetProjects } from '../lib/projectsStore';
import { useAiDebug, setAiDebugEnabled, clearAiDebugEntries } from '../lib/aiDebug';
import { useFeatureFlags, setVideoCoverEnabled, setReelEditorEnabled } from '../lib/featureFlags';
import { getCarouselModel, updateCarouselModel } from '../api/settings';
import LinkedInSettings from '../components/LinkedInSettings';
import './settings.css';

/* which formats Bauhly may use — held as EXCLUSIONS so a format added later is
 * on by default. Persisted locally (self-contained) until generation reads it. */
const FORMATS = ['Reels', 'Carousels', 'Stories', 'Single posts'];
const FORMAT_ICON = { Reels: 'play', Carousels: 'copy', Stories: 'eye', 'Single posts': 'brief' };
const DROPPED_KEY = 'bauhly_dropped_formats';
// connectingHandle key for the generic footer "Connect Instagram" button,
// which isn't tied to one row's handle.
const FOOTER_CONNECT_KEY = '__footer__';
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

const compactCount = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
function formatCount(n) {
  return typeof n === 'number' ? compactCount.format(n) : '0';
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
  const [connectingHandle, setConnectingHandle] = useState('');
  const [disconnectingId, setDisconnectingId] = useState('');
  const debug = useAiDebug();
  const flags = useFeatureFlags();
  const [carousel, setCarousel] = useState(null);
  const [carouselBusy, setCarouselBusy] = useState('');
  const [carouselErr, setCarouselErr] = useState('');

  useEffect(() => {
    listInstagramProfiles()
      .then((data) => setProfiles(data.profiles || []))
      .catch(() => setProfiles([]))
      .finally(() => setLoading(false));
    getMetaStatus()
      .then(setMeta)
      .catch(() => setMeta({ connected: false, configured: false, connections: [] }));
    getCarouselModel()
      .then(setCarousel)
      .catch(() => setCarousel(null));
  }, []);

  // Graph's post-thumbnail URLs are short-lived; re-pull media for each
  // Meta-linked handle once so the "Publish to Instagram" preview isn't
  // showing stale, expired links. Fire-and-forget, one pass per mount.
  const mediaRefreshed = React.useRef(false);
  useEffect(() => {
    if (mediaRefreshed.current || loading || !profiles.length) return;
    const linked = profiles.filter((p) => metaConnectionFor(meta, p.username));
    if (!linked.length) return;
    mediaRefreshed.current = true;
    linked.forEach((p) => {
      refreshInstagramMedia(p.username)
        .then(({ profile: fresh }) => {
          if (!fresh) return;
          setProfiles((prev) => prev.map((row) => (
            row.username === p.username ? { ...row, ...fresh } : row
          )));
        })
        .catch(() => {});
    });
  }, [loading, profiles, meta]);

  async function pickCarousel(patch) {
    if (!isAdmin || carouselBusy) return;
    setCarouselBusy(JSON.stringify(patch));
    setCarouselErr('');
    try {
      setCarousel(await updateCarouselModel(patch));
    } catch (err) {
      setCarouselErr(err.response?.data?.message || 'Could not update the carousel model.');
    } finally {
      setCarouselBusy('');
    }
  }

  // `expectedHandle` is the Bauhly handle this particular Connect button is
  // for — MetaCallback checks the OAuth result against it, so each row must
  // pass its own username rather than always the first/current profile.
  async function connectMeta(expectedHandle = '') {
    setConnectingHandle(expectedHandle || FOOTER_CONNECT_KEY);
    try {
      const { url, state } = await startMetaConnect();
      rememberMetaOAuthReturn({ expectedHandle: expectedHandle || profiles[0]?.username || '' });
      if (state) sessionStorage.setItem('meta_oauth_state', state);
      if (url) window.location.href = url;
    } catch (err) {
      alert(err.response?.data?.message || 'Instagram connect is not available yet.');
    } finally {
      setConnectingHandle('');
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

      {/* ── Your business ── */}
      <section className="card set-card">
        <h2>Your business</h2>
        <p className="set-card__sub">
          The facts every plan and every caption is written from, and the look every post is drawn in.
        </p>

        <Link className="set-row set-row--switch" to="/dashboard/brand-dna" title="Business memory">
          <span className="set-row__ico"><Icon name="brief" size={20} /></span>
          <span className="set-row__main">
            <b className="set-row__title">Business memory</b>
            <span className="set-row__sub">What Bauhly knows about your business</span>
          </span>
          <span className="set-row__acts">
            <Icon name="chevron-right" size={18} className="set-row__chev" />
          </span>
        </Link>

        <Link className="set-row set-row--switch" to="/dashboard/library-settings" title="Brand Kit">
          <span className="set-row__ico"><Icon name="swatch" size={20} /></span>
          <span className="set-row__main">
            <b className="set-row__title">Brand Kit</b>
            <span className="set-row__sub">Your colours, faces and visual mood</span>
          </span>
          <span className="set-row__acts">
            <Icon name="chevron-right" size={18} className="set-row__chev" />
          </span>
        </Link>
      </section>

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
                          : 'Instagram connected — ready to publish')
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
          Profile analysis reads public posts. Publishing uses the Instagram connection shown under each handle.
        </p>
      </section>

      {/* ── Meta publishing ── */}
      <section className="card set-card">
        <h2>Publish to Instagram</h2>
        <p className="set-card__sub">
          Each Bauhly handle must match the Instagram Professional account you connect.
          Sign in with Instagram — no Facebook Page required.
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
                            : 'Connected with Instagram Login'}
                        </span>
                      </span>
                    ) : null}
                    {link && (
                      <span className="set-igdata">
                        <span className="set-igdata__stats">
                          <span><b>{formatCount(p.followersCount)}</b> followers</span>
                          <span><b>{formatCount(p.followingCount)}</b> following</span>
                          <span><b>{formatCount(p.postsCount)}</b> posts</span>
                        </span>
                        {Array.isArray(p.posts) && p.posts.length > 0 && (
                          <span className="set-igdata__thumbs">
                            {p.posts.slice(0, 4).map((post) => (
                              post.displayUrl && (
                                <img
                                  key={post.externalId || post.url}
                                  src={post.displayUrl}
                                  alt=""
                                  referrerPolicy="no-referrer"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                              )
                            ))}
                          </span>
                        )}
                        <span className="set-igdata__note">
                          Bauhly reads @{link.igUsername || p.username}&rsquo;s profile and recent posts from
                          Instagram to plan captions, formats and timing.
                        </span>
                      </span>
                    )}
                    {!link && (
                      <span className="set-row__sub">
                        Connect Instagram and sign in as @{p.username}.
                      </span>
                    )}
                  </span>
                  <span className="set-row__acts">
                    {link ? (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || !!connectingHandle}
                        onClick={() => disconnectMetaAccount(id)}
                        title={`Disconnect Instagram for @${p.username}`}
                      >
                        <Icon name="x" size={14} />
                        {busy ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!!connectingHandle}
                        onClick={() => connectMeta(p.username)}
                      >
                        <Icon name="instagram" size={14} />
                        {connectingHandle === p.username ? 'Connecting…' : 'Connect'}
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
                            : 'Connected Instagram with no matching Bauhly handle'}
                        </span>
                      </span>
                    </span>
                    <span className="set-row__acts">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={busy || !!connectingHandle}
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
            disabled={!!connectingHandle}
            onClick={() => connectMeta()}
          >
            <Icon name="instagram" size={14} />
            {connectingHandle === FOOTER_CONNECT_KEY
              ? 'Connecting…'
              : connections.length
                ? 'Connect another Instagram'
                : 'Connect Instagram'}
          </button>
        </div>
      </section>

      <LinkedInSettings />

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

      {/* ── Carousel model ── */}
      <section className="card set-card">
        <h2>Carousel model</h2>
        <p className="set-card__sub">
          Which model designs your carousel slides, and how hard it thinks. Applies from your next
          carousel — including when you press <b>Run layout agent</b> on a post.
          {!isAdmin && ' Only an admin can change this.'}
        </p>

        {!carousel ? (
          <p className="set-empty">Loading…</p>
        ) : (() => {
          const selected = carousel.modelOptions.find((m) => m.id === carousel.model);
          const reasoningApplies = selected ? selected.reasoning !== false : true;
          const TIER_LABEL = { cheapest: 'Cheapest', priciest: 'Priciest' };
          return (
          <>
            <span className="set-seg__label">Model</span>
            <div className="set-seg" role="group" aria-label="Carousel model">
              {carousel.modelOptions.map((m) => {
                const on = m.id === carousel.model;
                return (
                  <button
                    type="button"
                    key={m.id}
                    className={`set-seg__btn ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    disabled={!isAdmin || Boolean(carouselBusy)}
                    onClick={() => pickCarousel({ model: m.id })}
                  >
                    {m.label}
                    <span className="set-seg__tag">
                      {m.provider === 'anthropic' ? 'Anthropic' : 'OpenAI'}
                      {TIER_LABEL[m.tier] ? ` · ${TIER_LABEL[m.tier]}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>

            <span className="set-seg__label">Reasoning</span>
            <div className="set-seg set-seg--sub" role="group" aria-label="Reasoning level">
              {carousel.reasoningOptions.map((r) => {
                const on = reasoningApplies && r.id === carousel.reasoningEffort;
                return (
                  <button
                    type="button"
                    key={r.id}
                    className={`set-seg__btn ${on ? 'is-on' : ''}`}
                    aria-pressed={on}
                    disabled={!isAdmin || Boolean(carouselBusy) || !reasoningApplies}
                    onClick={() => pickCarousel({ reasoningEffort: r.id })}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
            {!reasoningApplies && (
              <p className="set-card__note">
                {selected?.label || 'This model'} runs at a fixed speed — the reasoning level doesn’t apply to it.
              </p>
            )}

            {carouselErr && <p className="set-err">{carouselErr}</p>}
            <p className="set-card__note">
              Higher reasoning improves composition but costs more and is slower — most of the extra cost is
              reasoning tokens. To cut cost: pick a cheaper model (Haiku is cheapest) or lower the reasoning
              level. GPT-6 Astra is the default.
            </p>
          </>
          );
        })()}
      </section>

      {/* ── Experimental features ── */}
      <section className="card set-card">
        <h2>Experimental features</h2>
        <p className="set-card__sub">Early features you can try. Off by default.</p>
        <div className="set-row">
          <span className="set-row__ico"><Icon name="play" size={19} /></span>
          <span className="set-row__main">
            <b className="set-row__title">Animated video cover</b>
            <span className="set-row__sub">
              {flags.videoCover
                ? 'On · a “Video cover” option appears on each post’s hook slide'
                : 'Off · generate an animated hook video from a post’s strategy and structure'}
            </span>
          </span>
          <span className="set-row__acts">
            <button
              className={`set-switch ${flags.videoCover ? 'is-on' : ''}`}
              role="switch"
              aria-checked={flags.videoCover}
              aria-label={`${flags.videoCover ? 'Disable' : 'Enable'} animated video cover`}
              onClick={() => setVideoCoverEnabled(!flags.videoCover)}
            >
              <i aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="set-row">
          <span className="set-row__ico"><Icon name="film" size={19} /></span>
          <span className="set-row__main">
            <b className="set-row__title">Reel editor</b>
            <span className="set-row__sub">
              {flags.reelEditor
                ? 'On · a “Reel editor” page appears in the sidebar'
                : 'Off · upload a clip (≤3 min) and let AI agents cut it into a viral reel with live captions and on-screen animations'}
            </span>
          </span>
          <span className="set-row__acts">
            <button
              className={`set-switch ${flags.reelEditor ? 'is-on' : ''}`}
              role="switch"
              aria-checked={flags.reelEditor}
              aria-label={`${flags.reelEditor ? 'Disable' : 'Enable'} reel editor`}
              onClick={() => setReelEditorEnabled(!flags.reelEditor)}
            >
              <i aria-hidden="true" />
            </button>
          </span>
        </div>
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
