/*
 * WHAT BAUHLY IS MAKING, AS ONE PILL — ported from bauhly-v3 `components/ui/GenPill.jsx` (branch
 * editor/selbar-ai-button, decisions 735, 744, 746, 764, 765, 778).
 *
 * Shut it is a dark rounded box in the rail's corner: what it holds in words ("Generating 1 post", "2 posts ready")
 * and a field of lime dots that ripple while something is being made. Pressed, the same element grows into the
 * panel: a `Generating` head with its own dots, `Clear all`, a collapse chevron, and one line per request to make
 * posts — mark + first row (the stage it is on, `Queued`, `Didn't finish`, or `Single post · Wed 11 Nov`), the
 * studio's own words under it, `View post` on a finished line. A line opens on a press: the steps while it is
 * being made, the facts once done, what went wrong if it failed, and its `Clear`.
 *
 * Reads the plan-generation store (lib/planGeneration.js `jobs`), which replaces the old GenerationToast.
 * Non-blocking: the host takes no pointer, only the pill does. It closes when the studio presses elsewhere.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import useMediaQuery from '../hooks/useMediaQuery';
import Icon from '../brand/Icon';
import NotifyWhenReady from './NotifyWhenReady';
import IdeaCard, { useIdeaShown } from './IdeaCard';
import {
  usePlanGeneration, resumePlanGeneration, clearGenJob, clearFinishedGenJobs, retryGenJob, markGenJobSeen,
  requestOpenPostDay,
} from '../lib/planGeneration';
import { useActiveHandle } from '../lib/store';
import { openCaptureIdea, useCaptureOpen } from '../lib/captureUi';
import { useReelJobs, clearReelJob, clearFinishedReelJobs, reelStatusLine, aboutMin } from '../lib/reelJobs';
import { reelWorking } from '../api/captureReels';
import './genpill.css';

/* the dots: eight across, three down; each one's delay is fixed so the rhythm reads as a pattern, not noise */
const COLS = 8;
const ROWS = 3;
const DOTS = Array.from({ length: COLS * ROWS }, (_, i) => {
  const c = i % COLS;
  const r = Math.floor(i / COLS);
  return ((c * 140) + (r * 220) + (((c * 7) + (r * 3)) % 5) * 60) % 1800;
});

/* the run's stages, as the Capture conversation's progress card names them (bauhly-v3 lib/postrun.js STAGES) */
const STAGES = [
  { id: 'reading', label: 'Reading what you shared', motion: 'scan' },
  { id: 'structuring', label: 'Structuring the story', motion: 'stack' },
  { id: 'designing', label: 'Designing the slides', motion: 'grid' },
  { id: 'preview', label: 'Preparing your posts', motion: 'frame' },
];
/* where a run is: the queued run's own phase when the backend reports one, else a clock */
function stageAt(job, now) {
  switch (job.phase) {
    case 'queued': return 0;
    case 'planning': return 1;
    case 'writing': return 2;
    case 'finalizing': return 3;
    default: {
      const t = now - (job.at || now);
      return t < 8000 ? 0 : t < 45000 ? 1 : 2;
    }
  }
}

export function Motion({ kind }) {
  if (!kind) return null;
  return (
    <span className={`gprog__motion gprog__motion--${kind}`} aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {kind === 'scan' && (<><rect x="2.5" y="1.5" width="9" height="11" rx="1.5" /><path className="gprog__beam" d="M4 4.5h6" /></>)}
        {kind === 'stack' && (<><path className="gprog__bar" d="M2.5 3.5h9" /><path className="gprog__bar" d="M2.5 7h9" /><path className="gprog__bar" d="M2.5 10.5h6" /></>)}
        {kind === 'grid' && (<>
          <rect className="gprog__cell" x="1.5" y="1.5" width="4.5" height="4.5" rx="1" />
          <rect className="gprog__cell" x="8" y="1.5" width="4.5" height="4.5" rx="1" />
          <rect className="gprog__cell" x="1.5" y="8" width="4.5" height="4.5" rx="1" />
          <rect className="gprog__cell" x="8" y="8" width="4.5" height="4.5" rx="1" />
        </>)}
        {kind === 'frame' && (<><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" /><path d="M3.5 10l2.5-3 2 2 1.5-1.5 1.5 2.5" /><path className="gprog__sheen" d="M5 3.5l-2 7" /></>)}
      </svg>
    </span>
  );
}

const postsSay = (k) => `${k} ${k === 1 ? 'post' : 'posts'}`;
const reelsSay = (k) => `${k} ${k === 1 ? 'reel' : 'reels'}`;
// "1 post · 2 reels" — only the parts there are
const bothSay = (p, r) => [p ? postsSay(p) : '', r ? reelsSay(r) : ''].filter(Boolean).join(' · ');
const dayOf = (iso) => (iso
  ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  : null);
const TRIGGER_SAY = { capture: 'New capture', generate: 'Your plan', replan: 'Your plan', resume: 'Your plan', checkin: 'Your plan' };

export default function GenPill({ slot = null }) {
  const gen = usePlanGeneration();
  const handle = useActiveHandle() || '';
  const nav = useNavigate();
  const capOpen = useCaptureOpen();
  const [open, setOpen] = useState(false);
  const [unfold, setUnfold] = useState({});
  const [now, setNow] = useState(Date.now());
  const box = useRef(null);
  const inner = useRef(null);
  /* ON A PHONE IT HAS A ROW OF ITS OWN (bauhly-v3 GenPill, decision 745): below
     800 the pill is portalled into `.gpill-slot`, the first thing in the main
     column, as wide as the page's content; open, it grows down over the page */
  const narrow = useMediaQuery('(max-width: 800px)');
  const inRow = narrow && Boolean(slot);

  // a run started before a reload is still going on the server — wait for it (was GenerationToast's job)
  useEffect(() => { resumePlanGeneration(); }, []);

  const jobs = (gen.jobs || []).filter((j) => !j.handle || !handle || j.handle === handle);
  const postsMaking = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const done = jobs.filter((j) => j.status === 'done');
  const postsDone = done.reduce((n, j) => n + Math.max(1, (j.posts || []).length), 0);
  const postsFailed = jobs.filter((j) => j.status === 'failed').length;
  // reels being made / made (server-side jobs — lib/reelJobs)
  const { reels } = useReelJobs();
  const reelsMaking = reels.filter(reelWorking).length;
  const reelsDone = reels.filter((r) => r.status === 'done').length;
  const reelsFailed = reels.filter((r) => r.status === 'error').length;
  const making = postsMaking + reelsMaking;
  const doneN = postsDone + reelsDone;
  const failN = postsFailed + reelsFailed;
  const n = jobs.length + reels.length;
  // the recommended post is always in the panel (studio, 2026-11-19): it follows
  // the newest finished run, and with none yet it is fetched for the account
  const lastDone = [...done].filter((j) => (j.posts || []).length).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
  const ideaRun = handle ? `${handle}:${lastDone ? lastDone.id : 'base'}` : '';
  const ideaShown = useIdeaShown(ideaRun);

  // the clock-driven stage moves on while something is being made
  useEffect(() => {
    if (!making) return undefined;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [making]);

  /* ── THE OPEN SIZE, MEASURED FROM THE PARTS (a box cannot animate to `auto`) ── */
  const [tall, setTall] = useState(0);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const read = () => {
      const head = el.querySelector('.gpill__head');
      const list = el.querySelector('.gpill__list');
      if (!head || !list) return;
      const cs = window.getComputedStyle(el);
      const gap = parseFloat(window.getComputedStyle(list).marginTop) || 0;
      const next = Math.ceil((parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
        + head.getBoundingClientRect().height + gap + list.scrollHeight);
      // a pixel either way is rounding, not a new size — ignoring it keeps the panel from see-sawing
      setTall((prev) => (Math.abs(prev - next) <= 1 ? prev : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.querySelectorAll('.gpill__list, .gpill__item, .gpill__ideaslot').forEach((x) => ro.observe(x));
    return () => ro.disconnect();
  }, [open, n, unfold, ideaRun, inRow]);

  /* ── THE FLOOR: the phone's tab bar, measured ── */
  useEffect(() => {
    const read = () => {
      const bar = document.querySelector('.mtabs');
      const seen = bar && window.getComputedStyle(bar).display !== 'none';
      const floor = seen ? Math.max(0, Math.round(window.innerHeight - bar.getBoundingClientRect().top)) : 0;
      document.body.style.setProperty('--genq-floor', `${floor}px`);
    };
    read();
    window.addEventListener('resize', read);
    return () => { window.removeEventListener('resize', read); document.body.style.removeProperty('--genq-floor'); };
  }, []);

  /* it closes when the studio looks away: a press anywhere else folds it */
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!e.target?.closest?.('.gpill-host')) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc); };
  }, [open]);

  /* on its row, the room below it: open, it may take what is between its top
     and the tab bar (`--genq-floor`), less a step (decision 770) */
  const [room, setRoom] = useState(0);
  useEffect(() => {
    if (!open || !inRow) return undefined;
    const read = () => {
      const el = box.current;
      if (!el) return;
      const floor = parseFloat(document.body.style.getPropertyValue('--genq-floor')) || 0;
      setRoom(Math.max(120, Math.floor(window.innerHeight - el.getBoundingClientRect().top - floor - 12)));
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, true);
    return () => { window.removeEventListener('resize', read); window.removeEventListener('scroll', read, true); };
  }, [open, inRow]);

  // the pill is always there: posts being made or made, and the recommended post
  if (!handle) return null;

  const viewPost = (j) => {
    const first = [...(j.posts || [])].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    markGenJobSeen(j.id);
    setOpen(false);
    nav('/dashboard');
    if (first) requestOpenPostDay(first.date);
  };
  const toggle = (key) => setUnfold((u) => ({ ...u, [key]: !u[key] }));
  // a reel opens in its Reel studio on the Captures page (Captures reads `openReel`)
  const openReel = (r) => {
    setOpen(false);
    nav('/dashboard/projects', { state: { openReel: { id: r.id, captureIds: r.captureIds || [] } } });
  };
  const tab = open ? 0 : -1;

  const label = making ? `Generating ${bothSay(postsMaking, reelsMaking)}`
    : doneN ? `${bothSay(postsDone, reelsDone)} ready`
      : failN ? `${bothSay(postsFailed, reelsFailed)} not finished`
        : n ? bothSay(jobs.length, reels.length)
          : ideaShown ? 'Your next post' : 'Your posts';

  const tree = (
    <div className={`gpill-host ${open ? 'is-open' : 'is-shut'} ${capOpen ? 'is-under' : ''} ${inRow ? 'is-row' : ''}`}>
      <div
        className={`gpill ${open ? 'is-open' : 'is-shut'} ${making ? 'is-busy' : ''}`}
        ref={box}
        style={tall || (inRow && room)
          ? { ...(tall ? { '--gpill-open-h': `${tall}px` } : null), ...(inRow && room ? { '--gpill-room': `${room}px` } : null) }
          : undefined}
      >
        <button
          type="button"
          className="gpill__tab"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-label={`${label} — show`}
          tabIndex={open ? -1 : 0}
        >
          <span className="gpill__say" aria-live="polite">{label}</span>
          <span className={`gpill__dots ${making ? 'is-live' : doneN ? 'is-ready' : ''}`} aria-hidden="true">
            {DOTS.map((d, i) => <i key={i} style={{ animationDelay: `${d}ms` }} />)}
          </span>
        </button>

        <div className="gpill__panel" ref={inner} aria-hidden={!open}>
          <div className="gpill__head">
            <span className="gpill__title">
              {making ? 'Generating' : 'Your posts'}
              <span className={`gpill__dots gpill__dots--sm ${making ? 'is-live' : ''}`} aria-hidden="true">
                {DOTS.slice(0, 16).map((d, i) => <i key={i} style={{ animationDelay: `${d}ms` }} />)}
              </span>
            </span>
            <span className="gpill__headacts">
              {(done.length + failN) > 0 && (
                <button type="button" className="gpill__clear" onClick={() => { clearFinishedGenJobs(); clearFinishedReelJobs(); }} tabIndex={tab}>Clear all</button>
              )}
              <button type="button" className="gpill__icon" onClick={() => setOpen(false)} aria-label="Collapse" title="Collapse" tabIndex={tab}>
                <Icon name="chevron-down" size={15} strokeWidth={2.5} />
              </button>
            </span>
          </div>

          <div className="gpill__list">
            {ideaRun && (
              <div className="gpill__ideaslot">
                <IdeaCard runKey={ideaRun} tabIndex={tab} onExplore={() => setOpen(false)} />
              </div>
            )}
            {!n && !ideaShown && (
              <p className="gpill__empty">Nothing being made right now. New posts, reels and your next recommended post show here.</p>
            )}
            {reels.map((r) => {
              const live = reelWorking(r);
              const st = live ? 'running' : r.status === 'done' ? 'done' : 'failed';
              const key = `reel:${r.id}:${st}`;
              const on = Boolean(unfold[key]);
              const queued = live && r.status === 'queued' && r.stage !== 'retrying';
              const spent = r.startedAt ? now - new Date(r.startedAt).getTime() : 0;
              const total = (r.queue?.renderSec || 150) * 1000;
              return (
                <div key={key} className={`gpill__item is-${st} ${on ? 'is-unfolded' : ''}`}>
                  <button type="button" className="gpill__row" onClick={() => toggle(key)} tabIndex={tab} aria-expanded={on}>
                    <span className={`gpill__mark gpill__mark--${st} ${live && !queued ? 'has-motion' : ''}`} aria-hidden="true">
                      {st === 'done' && <Icon name="check" size={10} strokeWidth={2.75} />}
                      {st === 'failed' && <Icon name="x" size={10} strokeWidth={2.75} />}
                      {live && !queued && <Motion kind="frame" />}
                    </span>
                    <span className="gpill__label">{reelStatusLine(r)}</span>
                    <Icon name="chevron-down" size={14} strokeWidth={2.25} className="gpill__chev" />
                    <span className="gpill__said">{`Reel · ${r.projectName || 'No project'}`}</span>
                  </button>
                  {live && (
                    <span className="gpill__reelbar" aria-hidden="true">
                      <i
                        className={queued ? 'is-indeterminate' : ''}
                        style={queued ? undefined : {
                          width: `${r.stage === 'rendering' ? Math.max(4, r.renderPct || 0) : Math.min(96, Math.max(4, (spent / total) * 100))}%`,
                        }}
                      />
                    </span>
                  )}
                  {st === 'done' && (
                    <span className="gpill__acts">
                      <button type="button" className="gpill__go" onClick={() => openReel(r)} tabIndex={tab}>View reel</button>
                    </span>
                  )}
                  {st === 'failed' && (
                    <span className="gpill__acts">
                      <button type="button" className="gpill__go gpill__go--quiet" onClick={() => openReel(r)} tabIndex={tab}>Open</button>
                    </span>
                  )}
                  <div className="gpill__more" aria-hidden={!on}>
                    <div className="gpill__more-in">
                      {queued && (
                        <p className="gpill__fact">
                          {r.queue?.ahead
                            ? `Reels are made one after another. Yours starts in ${aboutMin(r.queue.startsInSec)}.`
                            : 'Yours is next — starting now.'}
                        </p>
                      )}
                      {live && !queued && r.stage !== 'rendering' && (
                        <p className="gpill__fact">
                          {spent > total - 10000 ? 'Almost done.' : `About ${aboutMin((total - spent) / 1000).replace(/^about /, '')} left.`}
                        </p>
                      )}
                      {live && (
                        <span className="gpill__moreacts">
                          <button type="button" className="gpill__clear" onClick={() => openReel(r)} tabIndex={on ? tab : -1}>Open</button>
                        </span>
                      )}
                      {st === 'done' && r.post?.date && <p className="gpill__fact">{`On your calendar · ${dayOf(String(r.post.date).slice(0, 10))}`}</p>}
                      {st === 'failed' && <p className="gpill__fail">{r.error || 'This reel could not be made.'}</p>}
                      {!live && (
                        <span className="gpill__moreacts">
                          <button type="button" className="gpill__clear" onClick={() => clearReelJob(r.id)} tabIndex={on ? tab : -1}
                            title="Takes it off this list. The reel stays on its capture.">
                            Clear
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {jobs.map((j) => {
              const phase = j.status === 'running' || j.status === 'queued' ? 'live' : j.status;
              const key = `${j.id}:${phase}`;
              const on = Boolean(unfold[key]);
              const at = j.status === 'running' ? stageAt(j, now) : -1;
              const stageNow = at >= 0 ? STAGES[at] : null;
              const posts = j.posts || [];
              const facts = j.status === 'done'
                ? (posts.length > 1
                  ? [postsSay(posts.length), posts[0]?.date ? `from ${dayOf([...posts].sort((a, b) => a.date.localeCompare(b.date))[0].date)}` : null]
                  : [posts[0]?.kind || 'Single post', dayOf(posts[0]?.date)]).filter(Boolean).join(' · ')
                : '';
              const doing = j.status === 'running' ? stageNow?.label || 'Generating'
                : j.status === 'queued' ? 'Queued'
                  : j.status === 'failed' ? 'Didn’t finish'
                    : null;
              const first = facts || doing || '';
              const said = j.label || TRIGGER_SAY[j.trigger] || 'Your plan';
              const slides = posts.length === 1 ? posts[0].slides : 0;
              return (
                <div key={j.id} className={`gpill__item is-${j.status} ${on ? 'is-unfolded' : ''}`}>
                  <button type="button" className="gpill__row" onClick={() => toggle(key)} tabIndex={tab} aria-expanded={on}>
                    <span className={`gpill__mark gpill__mark--${j.status} ${stageNow?.motion ? 'has-motion' : ''}`} aria-hidden="true">
                      {j.status === 'done' && <Icon name="check" size={10} strokeWidth={2.75} />}
                      {j.status === 'failed' && <Icon name="x" size={10} strokeWidth={2.75} />}
                      {stageNow?.motion && <Motion key={stageNow.id} kind={stageNow.motion} />}
                    </span>
                    <span className="gpill__label">{first}</span>
                    <Icon name="chevron-down" size={14} strokeWidth={2.25} className="gpill__chev" />
                    <span className="gpill__said">{said}</span>
                  </button>
                  {j.status === 'done' && posts.length > 0 && (
                    <span className="gpill__acts">
                      <button type="button" className="gpill__go" onClick={() => viewPost(j)} tabIndex={tab}>View post</button>
                    </span>
                  )}
                  {j.status === 'failed' && (
                    <span className="gpill__acts">
                      {j.needsInput ? (
                        <button type="button" className="gpill__go gpill__go--quiet" onClick={() => { clearGenJob(j.id); setOpen(false); openCaptureIdea(); }} tabIndex={tab}>Add detail</button>
                      ) : (
                        <button type="button" className="gpill__go gpill__go--quiet" onClick={() => retryGenJob(j.id)} tabIndex={tab}>Try again</button>
                      )}
                    </span>
                  )}
                  <div className="gpill__more" aria-hidden={!on}>
                    <div className="gpill__more-in">
                      {j.status === 'running' && (
                        <ul className="gprog__card">
                          {STAGES.map((st, i) => {
                            const s = i < at ? 'done' : i === at ? 'active' : 'upcoming';
                            return (
                              <li className={`gprog__stage is-${s}`} key={st.id}>
                                <span className="gprog__mark" aria-hidden="true">
                                  {s === 'done' && <Icon name="check" size={10} strokeWidth={2.75} />}
                                  {s === 'active' && <Motion kind={st.motion} />}
                                </span>
                                <span className="gprog__label">{st.label}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {j.status === 'running' && <div className="gpill__notify"><NotifyWhenReady variant="pill" /></div>}
                      {j.status === 'queued' && <p className="gpill__fact">Queued, after the post being made now.</p>}
                      {j.status === 'done' && slides > 1 && <p className="gpill__fact">{`${slides} slides`}</p>}
                      {j.status === 'done' && posts.length > 1 && (
                        <p className="gpill__fact">{posts.map((p) => dayOf(p.date)).filter(Boolean).join(', ')}</p>
                      )}
                      {j.status === 'done' && !posts.length && <p className="gpill__fact">No empty days were left on your plan.</p>}
                      {j.status === 'failed' && <p className="gpill__fail">{j.message || 'We couldn’t build this one.'}</p>}
                      {phase !== 'live' && (
                        <span className="gpill__moreacts">
                          <button type="button" className="gpill__clear" onClick={() => clearGenJob(j.id)} tabIndex={on ? tab : -1}
                            title="Takes it off this list. The post stays on your plan.">
                            Clear
                          </button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
  return inRow ? createPortal(tree, slot) : tree;
}
