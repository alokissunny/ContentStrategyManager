import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { getMissionCoverage, fetchRecentMissionPosts, getContentTopics } from '../api/missions';
import { MISSIONS, MISSION_ORDER, PILLAR_SAY, PILLARS, PILLAR_ORDER } from '../lib/missions';
import { useActiveHandle } from '../lib/store';
import { useFeatureFlags } from '../lib/featureFlags';
import './missionAnalysis.css';

/*
 * Analysis › Mission coverage. How the account's last 10 Instagram posts spread across the four content missions
 * (Attract / Nurture / Position / Convert), as the funnel in the studio's diagram, plus every post with the mission it
 * served and why. Pressing a mission filters the posts. The backend (GET /api/analysis/missions) analyses each post once
 * (caption + first image) and keeps the result; Re-analyse runs them all again.
 *
 * Below it: Content pillars — the share of posts on Skills / Passion / Story and how each pillar spreads over the
 * missions (pressing a pillar filters the posts too) — and the Topic map (GET /api/analysis/topics): the topics the
 * studio could genuinely talk about, per pillar, marked covered / thin / new, with who each reaches and what's needed.
 */

const dayOf = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const whenOf = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

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

const STATUS_SAY = { covered: 'Covered', thin: 'Touched once', missing: 'New for you' };

/* Skills / Passion / Story: three bars, then the pillar × mission grid. */
function PillarMix({ pillars, onlyPillar, setOnlyPillar }) {
  const max = Math.max(1, ...PILLAR_ORDER.flatMap((p) => MISSION_ORDER.map((m) => pillars.matrix[p][m])));
  return (
    <section className="mca-card mca-card--pillars" aria-label="Content pillars">
      <h2 className="mca-card__title"><span aria-hidden="true">🧭</span> Content pillars</h2>
      <p className="mca-card__sub">
        What your last {pillars.total} posts talk about, and the job each pillar did. Equal shares aren't the goal —
        the gaps show where new topics could reach new people. Press a pillar to see its posts.
      </p>
      <div className="mca-pillars">
        {PILLAR_ORDER.map((p) => {
          const on = onlyPillar === p;
          return (
            <button key={p} type="button" className={`mca-pbar mca-pillar--${p} ${on ? 'is-on' : ''}`}
              onClick={() => setOnlyPillar(on ? '' : p)} aria-pressed={on}>
              <span className="mca-pbar__head">
                <strong>{PILLARS[p].say}</strong>
                <span>{pillars.percents[p]}% · {pillars.counts[p]} of {pillars.total}</span>
              </span>
              <span className="mca-pbar__track" aria-hidden="true">
                <span className="mca-pbar__fill" style={{ width: `${pillars.percents[p]}%` }} />
              </span>
              <span className="mca-pbar__purpose">{PILLARS[p].purpose} — {PILLARS[p].shows.toLowerCase()}</span>
            </button>
          );
        })}
      </div>
      <div className="mca-grid" role="table" aria-label="Posts by pillar and mission">
        <div className="mca-grid__row mca-grid__row--head" role="row">
          <span role="columnheader" />
          {MISSION_ORDER.map((m) => <span key={m} role="columnheader" className={`mca-grid__col mca-tone--${m}`}>{MISSIONS[m].say}</span>)}
        </div>
        {PILLAR_ORDER.map((p) => (
          <div key={p} className="mca-grid__row" role="row">
            <span role="rowheader" className="mca-grid__pillar">{PILLARS[p].say}</span>
            {MISSION_ORDER.map((m) => {
              const n = pillars.matrix[p][m];
              return (
                <span key={m} role="cell" className={`mca-grid__cell mca-tone--${m} ${n ? '' : 'is-zero'}`}
                  style={{ '--mca-a': n ? 0.15 + (0.85 * n) / max : 0 }}
                  aria-label={`${PILLARS[p].say} · ${MISSIONS[m].say}: ${n}`}>
                  {n || '–'}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function TopicRow({ topic }) {
  return (
    <li className={`mca-topic is-${topic.status}`}>
      <div className="mca-topic__top">
        <span className={`mca-topic__status is-${topic.status}`}>{STATUS_SAY[topic.status]}</span>
        {topic.missions.map((m) => <MissionChip key={m} mission={m} />)}
      </div>
      <h4 className="mca-topic__title">{topic.topic}</h4>
      {topic.detail && <p className="mca-topic__detail">{topic.detail}</p>}
      {topic.audience && <p className="mca-topic__meta"><strong>Reaches:</strong> {topic.audience}</p>}
      {topic.needs && <p className="mca-topic__meta"><strong>You'd share:</strong> {topic.needs}</p>}
    </li>
  );
}

/* The studio's content territory: per pillar, topics covered / touched once / new. */
function TopicMap({ state, onRemap }) {
  const map = state.data;
  return (
    <section className="mca-card mca-card--topics" aria-label="Topic map">
      <div className="mca-card__headrow">
        <h2 className="mca-card__title"><span aria-hidden="true">🗺️</span> Topic map</h2>
        <button type="button" className="btn btn--ghost btn--sm mca-refresh" onClick={onRemap} disabled={state.loading}
          title="Maps your topics again from your posts, captures and business memory">
          <Glyph name="refresh-cw" size={14} /> {state.loading && map ? 'Mapping…' : 'Re-map'}
        </button>
      </div>
      <p className="mca-card__sub">
        Topics you can genuinely talk about — from what you do, what inspires you and your projects — and which your
        posts already cover. New ones are ideas beyond what you've captured so far.
      </p>
      {state.error && <p className="mca-error" role="alert">{state.error}</p>}
      {state.loading && !map && (
        <div className="mca-loading" aria-live="polite">
          <span className="mca-loading__dot" aria-hidden="true" />
          Mapping your Skills, Passion and Story topics… about half a minute.
        </div>
      )}
      {map && !map.topics?.length && !state.loading && (
        <p className="mca-empty">There isn't enough on file yet to map your topics — add a capture or fill in your business memory.</p>
      )}
      {map?.summary && <p className="mca-note mca-note--top">{map.summary}</p>}
      {map?.topics?.length > 0 && (
        <div className="mca-topics">
          {PILLAR_ORDER.map((p) => {
            const list = map.topics.filter((t) => t.pillar === p)
              .sort((a, b) => ['missing', 'thin', 'covered'].indexOf(a.status) - ['missing', 'thin', 'covered'].indexOf(b.status));
            const fresh = list.filter((t) => t.status !== 'covered').length;
            return (
              <div key={p} className={`mca-topics__col mca-pillar--${p}`}>
                <h3 className="mca-topics__head">{PILLARS[p].say} <span>{fresh} to explore</span></h3>
                {map.pillarNotes?.[p] && <p className="mca-topics__note">{map.pillarNotes[p]}</p>}
                <ul className="mca-topics__list">{list.map((t) => <TopicRow key={t.id} topic={t} />)}</ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function MissionAnalysis() {
  const handle = useActiveHandle() || '';
  const flags = useFeatureFlags();
  const [state, setState] = useState({ loading: true, error: '', data: null, refreshing: false });
  const [only, setOnly] = useState('');
  const [onlyPillar, setOnlyPillar] = useState('');
  const [topics, setTopics] = useState({ loading: false, error: '', data: null });
  // every request names the account it is for; an answer that lands after a switch is dropped
  const handleRef = useRef(handle);
  handleRef.current = handle;
  const stillOn = (h) => handleRef.current === h;

  const loadTopics = useCallback((refresh) => {
    const h = handle;
    setTopics((t) => ({ ...t, loading: true, error: '' }));
    getContentTopics({ refresh, handle: h })
      .then((data) => { if (stillOn(h)) setTopics({ loading: false, error: '', data }); })
      .catch((err) => stillOn(h) && setTopics((t) => ({
        ...t,
        loading: false,
        error: err.response?.data?.message || 'We could not map your topics. Please try again.',
      })));
  }, [handle]);
  const [fetching, setFetching] = useState(false);
  const [fetchSay, setFetchSay] = useState('');

  const load = useCallback((refresh) => {
    const h = handle;
    setState((s) => ({ ...s, loading: !s.data, refreshing: Boolean(s.data), error: '' }));
    getMissionCoverage({ refresh, handle: h })
      .then((data) => { if (stillOn(h)) setState({ loading: false, refreshing: false, error: '', data }); })
      .catch((err) => stillOn(h) && setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: err.response?.data?.message || 'We could not analyse your recent posts. Please try again.',
      })));
  }, [handle]);

  // the header account switcher changes whose posts these are
  // (nothing is read — or paid for — while the Analysis flag is off)
  useEffect(() => {
    if (!flags.missionAnalysis) return;
    setOnly(''); setOnlyPillar(''); setFetchSay(''); setTopics({ loading: false, error: '', data: null });
    // never show the previous account's posts while this one loads
    setState({ loading: true, error: '', data: null, refreshing: false });
    load(false);
  }, [handle, load, flags.missionAnalysis]);
  // the topic map reads the posts' pillar tags: asked for once the coverage (which tags them) is in
  const coverageReady = Boolean(state.data && !state.loading && !state.refreshing);
  useEffect(() => {
    if (flags.missionAnalysis && coverageReady && !topics.data && !topics.loading && !topics.error) loadTopics(false);
  }, [flags.missionAnalysis, coverageReady, topics.data, topics.loading, topics.error, loadTopics]);

  // Fetch recent: only posts published after the newest one already here are read and analysed
  const fetchRecent = () => {
    const before = state.data?.lastFetchedAt;
    setFetching(true);
    setFetchSay('');
    const h = handle;
    fetchRecentMissionPosts({ handle: h })
      .then((data) => {
        if (!stillOn(h)) return;
        setState({ loading: false, refreshing: false, error: '', data });
        setFetchSay(data.added
          ? `${data.added} new ${data.added === 1 ? 'post' : 'posts'} added and analysed.`
          : `No new posts since ${before ? whenOf(before) : 'the last fetch'}.`);
      })
      .catch((err) => setState((s) => ({
        ...s,
        error: err.response?.data?.message || 'We could not fetch your recent posts. Please try again.',
      })))
      .finally(() => setFetching(false));
  };
  const busy = state.loading || state.refreshing || fetching;

  const data = state.data;
  const posts = useMemo(() => (data?.posts || [])
    .filter((p) => (!only || p.mission === only) && (!onlyPillar || p.pillar === onlyPillar)), [data, only, onlyPillar]);
  const filterSay = [only && MISSIONS[only].say, onlyPillar && PILLARS[onlyPillar].say].filter(Boolean).join(' · ');
  const focus = new Set(data?.focus || []);

  if (!flags.missionAnalysis) {
    return (
      <div className="mca-page">
        <div className="page-head">
          <div>
            <span className="eyebrow">Experimental</span>
            <h1>Analysis</h1>
          </div>
        </div>
        <section className="card set-card">
          <p className="set-card__sub">
            Analysis is off. Turn it on under{' '}
            <Link to="/dashboard/settings">Settings → Experimental features</Link> to try it.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mca-page">
      <div className="page-head mca-head">
        <div>
          <span className="eyebrow">Analysis</span>
          <h1>Content coverage</h1>
          <p className="page-head__sub">
            How your last {data?.posts?.length || 10} Instagram posts{data?.username ? ` on @${data.username}` : ''} spread across the
            four content missions (why you publish) and three pillars (what you talk about) — and the topics you haven't covered yet.
          </p>
        </div>
        <div className="mca-acts">
          <button type="button" className="btn btn--ghost mca-refresh" onClick={fetchRecent} disabled={busy}
            title="Adds only the posts published since the newest one here">
            <Glyph name="download" size={15} /> {fetching ? 'Fetching…' : 'Fetch recent'}
          </button>
          <button type="button" className="btn btn--ghost mca-refresh" onClick={() => load(true)} disabled={busy}
            title="Works out the mission of every post here again">
            <Glyph name="refresh-cw" size={15} /> {state.refreshing ? 'Analysing…' : 'Re-analyse'}
          </button>
          {(fetchSay || data?.lastFetchedAt) && (
            <p className="mca-fetched" aria-live="polite">
              {fetchSay || `Last fetched ${whenOf(data.lastFetchedAt)}`}
            </p>
          )}
        </div>
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

          {data.pillars?.total > 0 && <PillarMix pillars={data.pillars} onlyPillar={onlyPillar} setOnlyPillar={setOnlyPillar} />}

          <TopicMap state={topics} onRemap={() => loadTopics(true)} />

          <section className="mca-posts" aria-label="Analysed posts">
            <div className="mca-posts__head">
              <h2>{filterSay ? `${filterSay} posts` : 'All analysed posts'} <span>({posts.length})</span></h2>
              {filterSay && <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setOnly(''); setOnlyPillar(''); }}>Show all</button>}
            </div>
            {posts.length ? posts.map((p) => <PostRow key={p.id} post={p} />) : only && !onlyPillar ? (
              <p className="mca-empty">
                None of your last {data.total} posts did the {MISSIONS[only].say.toLowerCase()} job. Posts that do usually show:{' '}
                {MISSIONS[only].shows.toLowerCase()}.
              </p>
            ) : (
              <p className="mca-empty">None of your last {data.total} posts {only ? `did the ${MISSIONS[only].say.toLowerCase()} job and ` : ''}talked about {PILLARS[onlyPillar].say.toLowerCase()}. The topic map above has ideas for it.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
