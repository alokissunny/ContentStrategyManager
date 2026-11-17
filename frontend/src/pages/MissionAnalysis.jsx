import { useCallback, useEffect, useMemo, useState } from 'react';
import Glyph from '../components/Glyph';
import { getMissionCoverage } from '../api/missions';
import { MISSIONS, MISSION_ORDER, PILLAR_SAY } from '../lib/missions';
import { useActiveHandle } from '../lib/store';
import './missionAnalysis.css';

/*
 * Analysis › Mission coverage. How the account's last 10 Instagram posts spread across the four content missions
 * (Attract / Nurture / Position / Convert), as the funnel in the studio's diagram, plus every post with the mission it
 * served and why. Pressing a mission filters the posts. The backend (GET /api/analysis/missions) analyses each post once
 * (caption + first image) and keeps the result; Re-analyse runs them all again.
 */

const dayOf = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function MissionChip({ mission }) {
  const m = MISSIONS[mission];
  if (!m) return null;
  return (
    <span className={`mca-chip mca-tone--${mission}`}>
      <span aria-hidden="true">{m.mark}</span> {m.say}
    </span>
  );
}

function PostRow({ post }) {
  return (
    <article className="mca-post">
      <a className="mca-post__media" href={post.url || undefined} target="_blank" rel="noreferrer" tabIndex={post.url ? 0 : -1}>
        {post.image ? <img src={post.image} alt="" loading="lazy" /> : <span className="mca-post__noimg"><Glyph name="image-off" size={22} /></span>}
      </a>
      <div className="mca-post__body">
        <div className="mca-post__top">
          <MissionChip mission={post.mission} />
          {post.pillar && <span className="mca-post__pillar">{PILLAR_SAY[post.pillar]}</span>}
          <span className="mca-post__date">{dayOf(post.timestamp)}</span>
        </div>
        {post.reason && <p className="mca-post__reason">{post.reason}</p>}
        {post.caption && <p className="mca-post__caption">{post.caption}</p>}
        <p className="mca-post__stats">
          <span><Glyph name="heart" size={13} /> {post.likes}</span>
          <span><Glyph name="message-circle" size={13} /> {post.comments}</span>
          {post.url && <a href={post.url} target="_blank" rel="noreferrer">Open on Instagram</a>}
        </p>
      </div>
    </article>
  );
}

export default function MissionAnalysis() {
  const handle = useActiveHandle() || '';
  const [state, setState] = useState({ loading: true, error: '', data: null, refreshing: false });
  const [only, setOnly] = useState('');

  const load = useCallback((refresh) => {
    setState((s) => ({ ...s, loading: !s.data, refreshing: Boolean(s.data), error: '' }));
    getMissionCoverage({ refresh })
      .then((data) => setState({ loading: false, refreshing: false, error: '', data }))
      .catch((err) => setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: err.response?.data?.message || 'We could not analyse your recent posts. Please try again.',
      })));
  }, []);

  // the header account switcher changes whose posts these are
  useEffect(() => { setOnly(''); load(false); }, [handle, load]);

  const data = state.data;
  const posts = useMemo(() => (data?.posts || []).filter((p) => !only || p.mission === only), [data, only]);
  const focus = new Set(data?.focus || []);

  return (
    <div className="mca-page">
      <div className="page-head mca-head">
        <div>
          <span className="eyebrow">Analysis</span>
          <h1>Mission coverage</h1>
          <p className="page-head__sub">
            How your last {data?.posts?.length || 10} Instagram posts{data?.username ? ` on @${data.username}` : ''} spread across the
            four content missions — which are covered and which need attention.
          </p>
        </div>
        <button type="button" className="btn btn--ghost mca-refresh" onClick={() => load(true)} disabled={state.loading || state.refreshing}>
          <Glyph name="refresh-cw" size={15} /> {state.refreshing ? 'Analysing…' : 'Re-analyse'}
        </button>
      </div>

      {state.error && <p className="mca-error" role="alert">{state.error}</p>}

      {state.loading && (
        <div className="mca-loading" aria-live="polite">
          <span className="mca-loading__dot" aria-hidden="true" />
          Reading your recent posts and working out the job each one did… the first time takes about half a minute.
        </div>
      )}

      {data && !data.total && !state.loading && (
        <p className="mca-empty">We could not find recent Instagram posts to analyse for this account yet.</p>
      )}

      {data && data.total > 0 && (
        <>
          <section className="mca-card" aria-label="Mission coverage">
            <h2 className="mca-card__title"><span aria-hidden="true">📊</span> Check mission coverage</h2>
            <p className="mca-card__sub">Your last {data.total} Instagram posts, by the one job each did. Press a mission to see its posts.</p>
            <div className="mca-funnel">
              {MISSION_ORDER.map((m, i) => {
                const meta = MISSIONS[m];
                const on = only === m;
                return (
                  <button
                    key={m}
                    type="button"
                    className={`mca-bar mca-tone--${m} ${on ? 'is-on' : ''} ${focus.has(m) ? 'is-focus' : ''}`}
                    style={{ '--mca-w': `${100 - i * 12}%` }}
                    onClick={() => setOnly(on ? '' : m)}
                    aria-pressed={on}
                  >
                    <span className="mca-bar__fill" style={{ width: `${data.percents[m]}%` }} aria-hidden="true" />
                    <span className="mca-bar__say">
                      <span aria-hidden="true">{meta.mark}</span>
                      <strong>{meta.say.toUpperCase()} - {data.percents[m]}%</strong>
                    </span>
                    <span className="mca-bar__meta">
                      {focus.has(m) && <span className="mca-bar__flag">Needs attention</span>}
                      {data.counts[m]} of {data.total}
                    </span>
                    <span className="mca-bar__purpose">{meta.purpose}</span>
                  </button>
                );
              })}
            </div>
            {data.note && <p className="mca-note">{data.note}</p>}
          </section>

          <section className="mca-posts" aria-label="Analysed posts">
            <div className="mca-posts__head">
              <h2>{only ? `${MISSIONS[only].say} posts` : 'All analysed posts'} <span>({posts.length})</span></h2>
              {only && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOnly('')}>Show all</button>}
            </div>
            {posts.length ? posts.map((p) => <PostRow key={p.id} post={p} />) : (
              <p className="mca-empty">
                None of your last {data.total} posts did the {MISSIONS[only].say.toLowerCase()} job. Posts that do usually show:{' '}
                {MISSIONS[only].shows.toLowerCase()}.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
