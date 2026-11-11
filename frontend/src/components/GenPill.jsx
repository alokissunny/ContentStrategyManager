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
import { useNavigate } from 'react-router-dom';
import Icon from '../brand/Icon';
import NotifyWhenReady from './NotifyWhenReady';
import {
  usePlanGeneration, resumePlanGeneration, clearGenJob, clearFinishedGenJobs, retryGenJob, markGenJobSeen,
  requestOpenPostDay,
} from '../lib/planGeneration';
import { useActiveHandle } from '../lib/store';
import { openCaptureIdea, useCaptureOpen } from '../lib/captureUi';
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
const dayOf = (iso) => (iso
  ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  : null);
const TRIGGER_SAY = { capture: 'New capture', generate: 'Your plan', replan: 'Your plan', resume: 'Your plan', checkin: 'Your plan' };

export default function GenPill() {
  const gen = usePlanGeneration();
  const handle = useActiveHandle() || '';
  const nav = useNavigate();
  const capOpen = useCaptureOpen();
  const [open, setOpen] = useState(false);
  const [unfold, setUnfold] = useState({});
  const [now, setNow] = useState(Date.now());
  const box = useRef(null);
  const inner = useRef(null);

  // a run started before a reload is still going on the server — wait for it (was GenerationToast's job)
  useEffect(() => { resumePlanGeneration(); }, []);

  const jobs = (gen.jobs || []).filter((j) => !j.handle || !handle || j.handle === handle);
  const making = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const done = jobs.filter((j) => j.status === 'done');
  const doneN = done.reduce((n, j) => n + Math.max(1, (j.posts || []).length), 0);
  const failN = jobs.filter((j) => j.status === 'failed').length;
  const n = jobs.length;

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
      setTall(Math.ceil((parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
        + head.getBoundingClientRect().height + gap + list.scrollHeight));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    el.querySelectorAll('.gpill__list, .gpill__item').forEach((x) => ro.observe(x));
    return () => ro.disconnect();
  }, [open, n, unfold]);

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
  useEffect(() => { if (!n) setOpen(false); }, [n]);

  if (!n) return null;

  const viewPost = (j) => {
    const first = [...(j.posts || [])].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    markGenJobSeen(j.id);
    setOpen(false);
    nav('/dashboard');
    if (first) requestOpenPostDay(first.date);
  };
  const toggle = (key) => setUnfold((u) => ({ ...u, [key]: !u[key] }));
  const tab = open ? 0 : -1;

  const label = making ? `Generating ${postsSay(making)}`
    : doneN ? `${postsSay(doneN)} ready`
      : failN ? `${postsSay(failN)} not finished`
        : postsSay(n);

  return (
    <div className={`gpill-host ${open ? 'is-open' : 'is-shut'} ${capOpen ? 'is-under' : ''}`}>
      <div
        className={`gpill ${open ? 'is-open' : 'is-shut'} ${making ? 'is-busy' : ''}`}
        ref={box}
        style={tall ? { '--gpill-open-h': `${tall}px` } : undefined}
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
                <button type="button" className="gpill__clear" onClick={clearFinishedGenJobs} tabIndex={tab}>Clear all</button>
              )}
              <button type="button" className="gpill__icon" onClick={() => setOpen(false)} aria-label="Collapse" title="Collapse" tabIndex={tab}>
                <Icon name="chevron-down" size={15} strokeWidth={2.5} />
              </button>
            </span>
          </div>

          <div className="gpill__list">
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
}
