/*
 * Reel studio — Captures › Generate reel.
 *
 * Opens over the Captures page for one capture: starts (or picks up) the
 * background Capture Reel job, shows where it is, then plays the finished 9:16
 * reel with its post caption, Download, Copy caption and Make another (with an
 * optional note to steer the next cut). The job keeps running if this closes.
 */
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import InViewVideo from '../../components/InViewVideo';
import Icon from '../../brand/Icon';
import { useBodyScrollLock } from '../checkin/ui';
import { videoProxyUrl } from '../../api/media';
import {
  createCaptureReel, listCaptureReels, getCaptureReel, deleteCaptureReel, reelWorking, getReelSystem,
} from '../../api/captureReels';
import ReelStyleModal from './ReelStyleModal';
import { REEL_STEPS, reelStepIndex, aboutMin, clockOf } from '../../lib/reelJobs';
import {
  browserCanRenderReels, renderOfferedReel, stopBrowserRender, browserRenderRunning,
} from '../../lib/browserReelRender';

// Remotion (the in-browser player) only downloads when a preview is shown
const ReelPreview = lazy(() => import('./ReelPreview'));
import './reelStudio.css';

const POLL_MS = 3000;

const dayOf = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function ReelStudio({ item, autoStart = false, startWith = null, showReelId = '', onClose, onReels, onDone, onViewPost }) {
  useBodyScrollLock();
  const captureIds = item.memberIds;
  const [reels, setReels] = useState(null); // null = loading
  const [shownId, setShownId] = useState(null);
  const [picking, setPicking] = useState(false); // Make another › style picker
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const put = (list) => setReels(list);
  const upsert = (r) => setReels((cur) => {
    const was = (cur || []).find((x) => x.id === r.id);
    if (was?.preview && r.preview) r = { ...r, preview: was.preview }; // keep the player from restarting
    return [r, ...(cur || []).filter((x) => x.id !== r.id)]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  });
  // tell the page after the update (never from inside it): its reel badges,
  // and — once a reel finishes — that its capture is now used
  const lastStatus = useRef({}); // reel id → status at the previous update
  useEffect(() => {
    if (reels === null) return;
    onReels?.(reels);
    reels.forEach((r) => {
      const was = lastStatus.current[r.id];
      if (was && was !== 'done' && was !== 'error' && r.status === 'done') onDone?.(r);
      lastStatus.current[r.id] = r.status;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reels]);

  const start = async (note = '', styleId = '') => {
    setErr('');
    try {
      const r = await createCaptureReel({ projectId: item.projectId, captureIds, direction: note, styleId });
      upsert(r);
      setShownId(r.id);
    } catch (e) {
      setErr(e?.response?.data?.message || 'The reel could not be started. Try again.');
    }
  };

  useEffect(() => {
    let alive = true;
    listCaptureReels(captureIds)
      .then((list) => {
        if (!alive) return;
        put(list);
        setShownId((list.find((r) => r.id === showReelId) || list[0])?.id || null);
        if (autoStart && !started.current && !list.some(reelWorking)) {
          started.current = true;
          start(startWith?.direction || '', startWith?.styleId || '');
        }
      })
      .catch(() => { if (alive) { put([]); setErr('Your reels could not be loaded.'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── rendering the MP4 here (lib/browserReelRender.js) ──
  const [canRender, setCanRender] = useState(false);
  const canRenderRef = useRef(false); // read by the poll below (its interval outlives renders)
  const [local, setLocal] = useState(null); // { reelId, phase, pct }
  useEffect(() => {
    let alive = true;
    browserCanRenderReels().then((ok) => { if (alive) { canRenderRef.current = Boolean(ok); setCanRender(Boolean(ok)); } });
    return () => { alive = false; stopBrowserRender(); };
  }, []);
  const offered = canRender ? (reels || []).find((r) => reelWorking(r) && r.browserRender?.state === 'offered') : null;
  useEffect(() => {
    if (!offered || browserRenderRunning() || document.visibilityState !== 'visible') return;
    const id = offered.id;
    renderOfferedReel(id, { onState: (st) => setLocal({ reelId: id, ...st }) })
      .finally(() => {
        setLocal((cur) => (cur?.reelId === id && cur.phase !== 'done' ? null : cur));
        getCaptureReel(id).then(upsert).catch(() => {});
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offered?.id]);

  // poll every running job until it lands
  const running = (reels || []).filter(reelWorking).map((r) => r.id).join(',');
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => {
      // a capable, visible studio says so: the worker then offers it the render
      const viewer = canRenderRef.current && document.visibilityState === 'visible';
      running.split(',').forEach((id) => getCaptureReel(id, { viewer }).then(upsert).catch(() => {}));
    }, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reel = (reels || []).find((r) => r.id === shownId) || (reels || [])[0] || null;

  // a reel queued for a while: ask the server why (admins only — others get 403)
  const [whyWait, setWhyWait] = useState('');
  const queuedId = reel?.status === 'queued' && reel?.stage !== 'retrying' ? reel.id : '';
  useEffect(() => {
    setWhyWait('');
    if (!queuedId) return undefined;
    const t = setTimeout(() => {
      getReelSystem().then((sys) => {
        const here = sys.workerInThisProcess || {};
        // a worker on another service (igsignal-reel-worker) counts too
        const live = Array.isArray(sys.workers) ? sys.workers : null;
        const w = here.started ? here : (live && live[0]) ? { ...live[0], started: true } : here;
        const slots = live && live.length ? live.reduce((n, x) => n + (x.concurrency || 1), 0) : (w.concurrency || 1);
        if (!sys.queueConfigured) setWhyWait('Admin: no reel queue on this server (REDIS_URL / PLAN_QUEUE).');
        else if (live && !live.length && !here.started) setWhyWait(`Admin: no reel worker is running anywhere — start igsignal-reel-worker (needs ≥ ${sys.renderNeedsMb} MB). This API: ${here.reason || 'does not render'}.`);
        else if (!w.started) setWhyWait(`Admin: no reel worker is running on this server — ${w.reason || 'not started'}. Memory seen: ${sys.memoryLimitMb} MB (needs ${sys.renderNeedsMb}).`);
        else if (sys.queue && sys.queue.active >= slots) setWhyWait(`Admin: the reel worker${live && live.length > 1 ? 's are' : ' is'} busy (${sys.queue.active} rendering, ${sys.queue.waiting} waiting).`);
        else setWhyWait(`Admin: a reel worker is running${w.service ? ` on ${w.service}` : ''} (${w.memoryLimitMb} MB, since ${String(w.since || '').slice(11, 16)} UTC) but has not taken this reel yet.`);
      }).catch(() => {});
    }, 45000);
    return () => clearTimeout(t);
  }, [queuedId]);
  // ── where the reel is, in words, with a clock ─────────────────────────────
  const working = reelWorking(reel);
  const queued = working && reel.status === 'queued' && reel.stage !== 'retrying';
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [working]);
  // the voiceover step only for a reel that has one
  const steps = REEL_STEPS.filter((s) => s.id !== 'voicing' || reel?.audioMode === 'voiceover' || reel?.stage === 'voicing');
  const at = !working || reel.status === 'queued' ? -1
    : Math.max(0, steps.findIndex((s) => s.id === REEL_STEPS[reelStepIndex(reel.stage)]?.id));
  const progress = (() => {
    if (!working) return {};
    if (reel.stage === 'retrying') {
      return { title: 'Trying again', say: 'Something went wrong on our side — starting this reel again in a moment.', pct: null };
    }
    if (queued) {
      const ahead = reel.queue?.ahead || 0;
      const waited = now - new Date(reel.createdAt).getTime();
      const slow = !ahead && waited > 60000;
      return {
        title: ahead ? `In line · ${ahead} ${ahead === 1 ? 'reel' : 'reels'} ahead of yours`
          : slow ? 'Waiting for a renderer' : 'Starting your reel',
        say: ahead ? `Yours starts in ${aboutMin(reel.queue?.startsInSec)}.`
          : slow ? 'This is taking longer than usual — it starts as soon as one is free.' : 'Getting a renderer ready…',
        pct: null,
        clock: waited > 3000 ? `Waiting ${clockOf(waited)}` : '',
      };
    }
    const step = steps[at] || REEL_STEPS[0];
    const total = (reel.queue?.renderSec || 150) * 1000;
    const spent = reel.startedAt ? now - new Date(reel.startedAt).getTime() : 0;
    // time drives the bar inside a step's share, so it moves but never runs ahead of the work
    const share = 100 / steps.length;
    // the render reports its own %: the bar follows it inside the cutting step
    // rendering in this browser
    if (local?.reelId === reel.id && ['checking', 'rendering', 'uploading'].includes(local.phase)) {
      const share2 = 100 / steps.length;
      return {
        title: local.phase === 'uploading' ? 'Uploading the video'
          : local.phase === 'checking' ? 'Rendering in your browser' : `Rendering in your browser · ${local.pct || 0}%`,
        say: local.phase === 'uploading' ? 'Almost there — sending the finished file.'
          : 'Keep this tab open: your computer renders it many times faster than our server.',
        pct: at * share2 + (share2 * (local.pct || 0)) / 100,
        clock: reel.startedAt ? clockOf(now - new Date(reel.startedAt).getTime()) : '',
      };
    }
    if (reel.stage === 'rendering') {
      const rp = Math.max(0, Math.min(100, reel.renderPct || 0));
      return {
        title: `Rendering the video · ${rp}%`,
        say: 'Drawing every frame with its captions and motion, then encoding the file.',
        pct: at * share + (share * rp) / 100,
        clock: clockOf(spent),
      };
    }
    const byTime = Math.min(96, (spent / total) * 100);
    const pct = Math.max(at * share + 2, Math.min((at + 1) * share - 2, byTime));
    const left = Math.max(0, total - spent);
    return {
      title: step.say,
      say: step.detail,
      pct,
      clock: `${clockOf(spent)}${left > 10000 ? ` · ${aboutMin(left / 1000)} left` : ' · almost done'}`,
    };
  })();
  const src = reel?.videoKey ? videoProxyUrl(reel.videoKey) : '';
  const postText = reel ? [reel.caption, (reel.hashtags || []).join(' ')].filter(Boolean).join('\n\n') : '';

  const copy = async () => {
    try { await navigator.clipboard.writeText(postText); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };
  const drop = async () => {
    if (!reel || !window.confirm('Delete this reel? This cannot be undone.')) return;
    try {
      await deleteCaptureReel(reel.id);
      const list = (reels || []).filter((r) => r.id !== reel.id);
      put(list);
      setShownId(list[0]?.id || null);
    } catch (e) { setErr(e?.response?.data?.message || 'That reel could not be deleted.'); }
  };

  return (
    <div className="rls" role="dialog" aria-modal="true" aria-label="Reel from this capture">
      <div className="rls__scrim" onClick={onClose} />
      <div className="rls__card">
        <header className="rls__head">
          <span className="rls__title">
            <Icon name="film" size={18} />
            Reel
            <span className="rls__sub">{item.projectName || 'No project'}</span>
          </span>
          <button type="button" className="rls__x" onClick={onClose} aria-label="Close"><Icon name="x" size={16} strokeWidth={2.25} /></button>
        </header>

        {reels === null ? (
          <div className="rls__empty"><span className="pj-spin" /></div>
        ) : !reel ? (
          <div className="rls__intro">
            <p className="rls__lead">Turn this capture into a vertical reel.</p>
            <p className="rls__say">
              Bauhly cuts your strongest shots into a short teaser — a hook in the first second,
              fast cuts on the beat of original music, animated callouts and one big reveal —
              then puts it on your calendar. It takes about a minute.
            </p>
            <button type="button" className="rls-btn rls-btn--go" onClick={() => setPicking(true)}>
              <Icon name="film" size={16} /> Generate reel
            </button>
          </div>
        ) : (
          <div className="rls__body">
            <div className="rls__stage">
              {reel.status === 'done' && src ? (
                <InViewVideo key={reel.id} className="rls__video" src={src} poster={reel.posterUrl || undefined} controls />
              ) : reelWorking(reel) && reel.preview ? (
                // the cut is ready: play it here while the server makes the file
                <div className="rls__preview">
                  <Suspense fallback={<div className="rls__empty"><span className="pj-spin" /></div>}>
                    <ReelPreview key={reel.id} timeline={reel.preview} />
                  </Suspense>
                  <span className="rls__badge"><span className="pj-spin" />
                    {local?.reelId === reel.id && local.phase === 'rendering' ? `Rendering in your browser · ${local.pct || 0}%`
                      : local?.reelId === reel.id && local.phase === 'uploading' ? 'Uploading the video…'
                        : reel.browserRender?.state === 'claimed' ? `Rendering in your browser · ${reel.renderPct || 0}%`
                          : reel.stage === 'rendering' && reel.renderPct > 0 ? `Rendering the video file · ${reel.renderPct}%` : 'Finishing the video file…'}
                  </span>
                </div>
              ) : (
                <div className="rls__wait" style={reel.posterUrl ? { backgroundImage: `url(${reel.posterUrl})` } : undefined}>
                  {reelWorking(reel) ? (
                    <div className="rls__progress">
                      <div className="rls__now" aria-live="polite">
                        <span className={`rls__pulse ${queued ? 'is-queued' : ''}`} aria-hidden="true"><i /><i /><i /></span>
                        <p className="rls__now-title">{progress.title}</p>
                        <p className="rls__now-say">{progress.say}</p>
                        <div
                          className={`rls__bar ${progress.pct == null ? 'is-indeterminate' : ''}`}
                          role="progressbar"
                          aria-label="Reel progress"
                          {...(progress.pct != null ? { 'aria-valuenow': Math.round(progress.pct), 'aria-valuemin': 0, 'aria-valuemax': 100 } : {})}
                        >
                          <span style={progress.pct != null ? { width: `${progress.pct}%` } : undefined} />
                        </div>
                        {progress.clock && <p className="rls__clock">{progress.clock}</p>}
                      </div>
                      <ol className="rls__steps">
                        {steps.map((s, i) => {
                          const state = i < at ? 'done' : i === at ? 'now' : 'next';
                          return (
                            <li key={s.id} className={`rls__step is-${state}`}>
                              <span className="rls__dot">{state === 'done' ? <Icon name="check" size={12} strokeWidth={3} /> : state === 'now' ? <span className="pj-spin" /> : null}</span>
                              {s.say}
                            </li>
                          );
                        })}
                        {whyWait && <li className="rls__note rls__note--admin">{whyWait}</li>}
                      </ol>
                    </div>
                  ) : (
                    <div className="rls__fail">
                      <Icon name="info" size={18} />
                      <p>{reel.error || 'The reel could not be made this time.'}</p>
                      <button type="button" className="rls-btn rls-btn--go" onClick={() => start(reel.direction || '', reel.styleId || '')}>Try again</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <aside className="rls__side">
              {reelWorking(reel) && reel.preview && (
                <p className="rls__meta">
                  This is a live preview. Download and posting unlock in a few seconds, when the video file is ready.
                </p>
              )}
              {reelWorking(reel) && !reel.hook && (
                <>
                  <p className="rls__hook">{queued ? 'Your reel is in line' : 'Making your reel'}</p>
                  <p className="rls__concept">
                    {queued
                      ? `Reels are made one after another. ${reel.queue?.ahead
                        ? `Yours starts in ${aboutMin(reel.queue.startsInSec)} and should be ready in ${aboutMin(reel.queue.etaSec)}.`
                        : `Yours is next and takes ${aboutMin(reel.queue?.renderSec || 150)}.`}`
                      : `A reel takes ${aboutMin(reel.queue?.renderSec || 150)}.`}
                    {' '}You can close this and keep working — it shows on this capture and in the
                    panel at the bottom when it is ready.
                  </p>
                </>
              )}
              {reel.hook && <p className="rls__hook">“{reel.hook}”</p>}
              {reel.concept && <p className="rls__concept">{reel.concept}</p>}
              <p className="rls__style">
                {reel.styleName ? `Style · ${reel.styleName}` : 'Style · Default'}
                {reel.format ? ` · ${reel.format.replace('_', ' ')}` : ''}
              </p>
              {reel.altHook && (
                <p className="rls__alt"><span className="rls__lab">Alternative hook (A/B)</span>“{reel.altHook}”</p>
              )}
              {reel.status === 'done' && (
                <>
                  <div className="rls__acts">
                    <a className="rls-btn rls-btn--go" href={src} download={`reel-${reel.id}.mp4`} target="_blank" rel="noreferrer">
                      <Icon name="download" size={16} /> Download
                    </a>
                    <button type="button" className="rls-btn" onClick={copy} disabled={!postText}>
                      <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy caption'}
                    </button>
                    <button type="button" className="rls-btn rls-btn--quiet" onClick={drop} aria-label="Delete reel" title="Delete reel">
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  {postText && (
                    <div className="rls__caption">
                      <span className="rls__lab">Caption</span>
                      <p>{reel.caption}</p>
                      {reel.hashtags?.length > 0 && <p className="rls__tags">{reel.hashtags.join(' ')}</p>}
                    </div>
                  )}
                  {reel.post ? (
                    <div className="rls__cal">
                      <span className="rls__cal__say">
                        <Icon name="calendar" size={15} />
                        {reel.post.published ? 'Published' : 'On your calendar'} · {dayOf(reel.post.date)}
                      </span>
                      {onViewPost && (
                        <button type="button" className="rls-btn" onClick={() => onViewPost(reel.post)}>
                          View in calendar
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="rls__meta">Not on the calendar — there was no empty publishing day to put it on.</p>
                  )}
                  <p className="rls__meta">
                    {Math.round(reel.durationSec)}s · {reel.audioMode === 'voiceover' ? 'voiceover' : 'music'}
                  </p>
                </>
              )}
              {!reelWorking(reel) && (
                <button type="button" className="rls-btn" onClick={() => setPicking(true)}>
                  <Icon name="refresh" size={16} /> Make another
                </button>
              )}
              {reels.length > 1 && (
                <div className="rls__others">
                  <span className="rls__lab">Reels from this capture</span>
                  <div className="rls__thumbs">
                    {reels.map((r, i) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`rls__thumb ${r.id === reel.id ? 'is-on' : ''}`}
                        onClick={() => setShownId(r.id)}
                        aria-label={`Reel ${reels.length - i}`}
                        style={r.posterUrl ? { backgroundImage: `url(${r.posterUrl})` } : undefined}
                      >
                        {reelWorking(r) ? <span className="pj-spin" /> : r.status === 'error' ? <Icon name="info" size={14} /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
        {err && <p className="rls__err" role="alert">{err}</p>}
      </div>
      {picking && (
        <ReelStyleModal
          initialStyleId={reel?.styleId || ''}
          onClose={() => setPicking(false)}
          onGenerate={({ styleId, direction: note }) => { setPicking(false); start(note, styleId); }}
        />
      )}
    </div>
  );
}
