import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import Tabs from '../components/Tabs';
import { useFeatureFlags } from '../lib/featureFlags';
import { openCaptureIdea } from '../lib/captureUi';
import { startPlanGeneration, requestOpenPostDay } from '../lib/planGeneration';
import { getRemixSources } from '../api/posts';
import './postRemix.css';

/*
 * Post remix (experimental, `postRemix` flag).
 *  1. the studio's last 10 Instagram posts, split into Carousels / Reels tabs
 *  2. pick one or several (≤ MAX_PICKS, across both tabs) → Capture asks what is new
 *  3. Strategist + Carousel write ONE new carousel that builds on the picked
 *     post(s), using the capture plus their own photos / video (the backend
 *     copies them into the capture). It lands on the next empty slot.
 */

// the post's own photos / video are used for the new carousel (the backend
// copies them into this capture), so Capture does not ask for media
const MAX_PICKS = 5;
const remixAsk = (n) => (n > 1
  ? `What should a new post made from these ${n} posts say? Tell me what ties them together or what is new — a result, a detail, a next step, a question people asked. I’ll use their own photos and video.`
  : 'What do you want to add to this post? Tell me what is new — a result, a detail, a next step, a question people asked. I’ll use this post’s own photos and video.');

function when(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Graph: VIDEO / CAROUSEL_ALBUM / IMAGE · Apify: Video / Sidecar / Image
const isReel = (p) => /video|reel|clip/i.test(String(p?.type || ''));

function kindLabel(p) {
  if (isReel(p)) return 'Reel';
  return (p.images || []).length > 1 || /sidecar|carousel|album/i.test(String(p.type || '')) ? 'Carousel' : 'Photo';
}

// first line of the caption, without the dot-spacer lines Instagram captions use
function firstLine(caption) {
  return String(caption || '').split('\n').map((l) => l.trim()).find((l) => l && !/^[.·•…\s]+$/.test(l)) || '';
}

function PostCard({ post, order, onSelect }) {
  const selected = order > 0;
  const [at, setAt] = useState(0);
  const images = post.images || [];
  const count = images.length;
  const step = (dir) => (e) => {
    e.stopPropagation();
    setAt((i) => (i + dir + count) % count);
  };
  const reel = isReel(post);
  return (
    <div
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      className={`rmx-card${selected ? ' is-selected' : ''}${reel ? ' rmx-card--reel' : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      <div className="rmx-card__media">
        {count ? (
          <img src={images[at]} alt={post.imageLabels?.[at] || `Post image ${at + 1}`} loading="lazy" />
        ) : (
          <span className="rmx-card__noimg"><Glyph name="image-off" size={28} /></span>
        )}
        <span className="rmx-card__shade" aria-hidden="true" />
        <span className="rmx-card__kind">
          <Glyph name={reel ? 'clapperboard' : (count > 1 ? 'gallery-horizontal' : 'image')} size={12} strokeWidth={2} />
          {kindLabel(post)}
        </span>
        <span className={`rmx-card__check${selected ? ' is-on' : ''}`} aria-hidden="true">
          {selected && order}
        </span>
        {count > 1 && (
          <>
            <button type="button" className="rmx-card__nav rmx-card__nav--prev" aria-label="Previous image" onClick={step(-1)}>
              <Glyph name="chevron-left" size={16} strokeWidth={2} />
            </button>
            <button type="button" className="rmx-card__nav rmx-card__nav--next" aria-label="Next image" onClick={step(1)}>
              <Glyph name="chevron-right" size={16} strokeWidth={2} />
            </button>
            <span className="rmx-card__dots" aria-hidden="true">
              {images.map((_, i) => <i key={i} className={i === at ? 'is-on' : ''} />)}
            </span>
          </>
        )}
        <span className="rmx-card__over">
          <span>{when(post.timestamp)}</span>
          <span className="rmx-card__stats">
            {/* Instagram reports hidden like counts as -1 */}
            {post.likes >= 0 && <span><Glyph name="heart" size={12} strokeWidth={2} /> {post.likes}</span>}
            <span><Glyph name="message-circle" size={12} strokeWidth={2} /> {post.comments}</span>
          </span>
        </span>
      </div>
      <p className="rmx-card__caption">{firstLine(post.caption) || <em>No caption</em>}</p>
    </div>
  );
}

export default function PostRemix() {
  const flags = useFeatureFlags();
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: '', posts: [], username: '' });
  const [tab, setTab] = useState('carousels');
  // picked post ids, in the order picked (several posts → one new carousel)
  const [chosen, setChosen] = useState([]);
  const [note, setNote] = useState('');
  // idle | running | done | failed
  const [run, setRun] = useState({ status: 'idle', message: '', date: '' });

  const load = useCallback((refresh = false) => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    getRemixSources({ refresh })
      .then((data) => {
        const posts = Array.isArray(data.posts) ? data.posts : [];
        setState({ loading: false, error: '', posts, username: data.username || '' });
        setChosen((c) => c.filter((id) => posts.some((p) => p.id === id)));
        // open on a tab that has something in it
        if (!posts.some((p) => !isReel(p)) && posts.some(isReel)) setTab('reels');
      })
      .catch((err) => {
        setState((s) => ({
          ...s,
          loading: false,
          error: err.response?.data?.message || 'We could not read your recent posts. Please try again.',
        }));
      });
  }, []);

  useEffect(() => { if (flags.postRemix) load(false); }, [flags.postRemix, load]);

  const groups = useMemo(() => ({
    carousels: state.posts.filter((p) => !isReel(p)),
    reels: state.posts.filter(isReel),
  }), [state.posts]);
  const shown = groups[tab] || [];
  const pickedPosts = chosen.map((id) => state.posts.find((p) => p.id === id)).filter(Boolean);
  const picked = pickedPosts[0] || null;
  const toggle = (id) => {
    setNote('');
    setChosen((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      if (c.length >= MAX_PICKS) {
        setNote(`You can combine up to ${MAX_PICKS} posts.`);
        return c;
      }
      return [...c, id];
    });
  };
  const countIn = (list) => list.filter((p) => chosen.includes(p.id)).length;

  const remix = () => {
    if (!pickedPosts.length) return;
    const posts = pickedPosts;
    const many = posts.length > 1;
    openCaptureIdea({
      opening: remixAsk(posts.length),
      savedLine: many
        ? `Got it — writing one new carousel from your ${posts.length} posts.`
        : 'Got it — writing a new carousel that builds on your post.',
      projectName: 'No project',
      askProject: false,
      maxQuestions: 2,
      askMedia: false,
      onSaved: (captured) => {
        const captureIds = captured?.captureId ? [captured.captureId] : [];
        setRun({ status: 'running', message: '', date: '' });
        startPlanGeneration('remix', {
          label: `Remix${many ? ` of ${posts.length} posts` : ''} · ${captured?.text || firstLine(posts[0].caption) || 'your post'}`,
          captureIds,
          referencePostIds: posts.map((p) => p.id),
        })
          .then((data) => {
            const first = (data?.posts || [])[0];
            setRun({ status: 'done', message: '', date: first?.date || '' });
          })
          .catch((err) => {
            setRun({
              status: 'failed',
              message: err.response?.data?.message || 'We could not write the new carousel. Please try again.',
              date: '',
            });
          });
      },
    });
  };

  const openPost = () => {
    if (run.date) requestOpenPostDay(run.date);
    navigate('/dashboard');
  };

  if (!flags.postRemix) {
    return (
      <div className="rmx-page">
        <div className="page-head">
          <div>
            <span className="eyebrow">Experimental</span>
            <h1>Post remix</h1>
          </div>
        </div>
        <section className="card set-card">
          <p className="set-card__sub">
            Post remix is off. Turn it on under{' '}
            <Link to="/dashboard/settings">Settings → Experimental features</Link> to try it.
          </p>
        </section>
      </div>
    );
  }

  const tabItems = [
    { id: 'carousels', label: <>Carousels &amp; photos <span className="rmx-tabcount">{groups.carousels.length}</span>{countIn(groups.carousels) > 0 && <span className="rmx-tabpick">{countIn(groups.carousels)} picked</span>}</> },
    { id: 'reels', label: <>Reels <span className="rmx-tabcount">{groups.reels.length}</span>{countIn(groups.reels) > 0 && <span className="rmx-tabpick">{countIn(groups.reels)} picked</span>}</> },
  ];

  return (
    <div className="rmx-page">
      <div className="page-head rmx-head">
        <div>
          <span className="eyebrow">Experimental</span>
          <h1>Post remix</h1>
          <p className="page-head__sub">
            Pick one of your last 10 posts{state.username ? ` on @${state.username}` : ''} — or several to combine — tell
            Capture what is new, and get a fresh carousel built from their own photos and video.
          </p>
        </div>
        <button type="button" className="btn btn--ghost rmx-refresh" onClick={() => load(true)} disabled={state.loading}>
          <Glyph name="refresh-cw" size={15} /> Re-read Instagram
        </button>
      </div>

      <Tabs items={tabItems} value={tab} onChange={setTab} label="Post type" className="rmx-tabs" />

      {state.error && <p className="rmx-error" role="alert">{state.error}</p>}

      {state.loading ? (
        <div className={`rmx-grid${tab === 'reels' ? ' rmx-grid--reels' : ''}`} aria-busy="true">
          {Array.from({ length: tab === 'reels' ? 5 : 4 }, (_, i) => <div key={i} className="rmx-ghost" />)}
        </div>
      ) : shown.length ? (
        <div className={`rmx-grid${tab === 'reels' ? ' rmx-grid--reels' : ''}`} role="group" aria-label="Posts">
          {shown.map((p) => (
            <PostCard key={p.id} post={p} order={chosen.indexOf(p.id) + 1} onSelect={() => toggle(p.id)} />
          ))}
        </div>
      ) : !state.error && (
        <div className="rmx-empty">
          <Glyph name={tab === 'reels' ? 'clapperboard' : 'gallery-horizontal'} size={22} />
          <p>{tab === 'reels' ? 'No reels in your last 10 posts.' : 'No carousels or photos in your last 10 posts.'}</p>
        </div>
      )}

      <div className={`rmx-bar${picked ? ' has-pick' : ''}`}>
        {pickedPosts.length ? (
          <span className="rmx-bar__stack" aria-hidden="true">
            {pickedPosts.slice(0, 3).map((p, i) => (
              p.images?.[0]
                ? <img key={p.id} className="rmx-bar__thumb" style={{ zIndex: 3 - i }} src={p.images[0]} alt="" />
                : <span key={p.id} className="rmx-bar__thumb rmx-bar__thumb--empty" style={{ zIndex: 3 - i }} />
            ))}
          </span>
        ) : (
          <span className="rmx-bar__thumb rmx-bar__thumb--empty"><Glyph name="repeat-2" size={18} /></span>
        )}
        <div className="rmx-bar__text">
          {run.status === 'running' && (
            <>
              <b>Writing your new carousel…</b>
              <span>It lands on the next empty day of your calendar.</span>
            </>
          )}
          {run.status === 'done' && (
            <>
              <b>Your new carousel is ready.</b>
              <span>It is on your calendar{run.date ? ` for ${when(run.date)}` : ''}.</span>
            </>
          )}
          {run.status === 'failed' && (
            <>
              <b>That did not work.</b>
              <span className="rmx-error">{run.message}</span>
            </>
          )}
          {run.status === 'idle' && (pickedPosts.length > 1 ? (
            <>
              <b>{pickedPosts.length} posts picked — combined into one carousel</b>
              <span className={note ? 'rmx-warn' : ''}>{note || pickedPosts.map((p) => firstLine(p.caption) || kindLabel(p)).join(' · ')}</span>
            </>
          ) : picked ? (
            <>
              <b>{kindLabel(picked)} from {when(picked.timestamp)}</b>
              <span>{firstLine(picked.caption) || 'No caption'} · pick more to combine them</span>
            </>
          ) : (
            <>
              <b>Choose one or more posts to build on</b>
              <span>The new carousel uses their own photos and video, plus what you tell Capture.</span>
            </>
          ))}
        </div>
        {pickedPosts.length > 0 && run.status !== 'running' && (
          <button type="button" className="btn btn--ghost rmx-bar__clear" onClick={() => { setChosen([]); setNote(''); setRun({ status: 'idle', message: '', date: '' }); }}>
            Clear
          </button>
        )}
        {run.status === 'done' ? (
          <button type="button" className="btn btn--primary" onClick={openPost}>
            <Glyph name="calendar" size={15} /> Open in calendar
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={remix}
            disabled={!pickedPosts.length || run.status === 'running'}
          >
            <Glyph name="plus" size={15} strokeWidth={2.5} />
            {run.status === 'running' ? 'Writing…' : (pickedPosts.length > 1 ? `Combine ${pickedPosts.length} posts` : 'Add what’s new')}
          </button>
        )}
      </div>
    </div>
  );
}
