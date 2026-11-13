/*
 * Reel studio — Captures › Generate reel.
 *
 * Opens over the Captures page for one capture: starts (or picks up) the
 * background Capture Reel job, shows where it is, then plays the finished 9:16
 * reel with its post caption, Download, Copy caption and Make another (with an
 * optional note to steer the next cut). The job keeps running if this closes.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import { useBodyScrollLock } from '../checkin/ui';
import { videoProxyUrl } from '../../api/media';
import {
  createCaptureReel, listCaptureReels, getCaptureReel, deleteCaptureReel, reelWorking,
} from '../../api/captureReels';
import ReelStyleModal from './ReelStyleModal';
import './reelStudio.css';

const STEPS = [
  { id: 'reading', say: 'Watching your photos and clips' },
  { id: 'writing', say: 'Writing the hook and the cut' },
  { id: 'voicing', say: 'Recording the voiceover' },
  { id: 'scoring', say: 'Composing the music' },
  { id: 'cutting', say: 'Cutting and animating the reel' },
  { id: 'saving', say: 'Saving it' },
];
// the render itself is part of 'Cutting and animating the reel'
const stepAt = (stage) => Math.max(0, STEPS.findIndex((s) => s.id === (stage === 'rendering' ? 'cutting' : stage)));
const POLL_MS = 3000;

const dayOf = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export default function ReelStudio({ item, autoStart = false, startWith = null, onClose, onReels, onDone, onViewPost }) {
  useBodyScrollLock();
  const captureIds = item.memberIds;
  const [reels, setReels] = useState(null); // null = loading
  const [shownId, setShownId] = useState(null);
  const [picking, setPicking] = useState(false); // Make another › style picker
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  const put = (list) => { setReels(list); onReels?.(list); };
  const upsert = (r) => setReels((cur) => {
    const was = (cur || []).find((x) => x.id === r.id);
    if (was && reelWorking(was) && r.status === 'done') onDone?.(r);
    const list = [r, ...(cur || []).filter((x) => x.id !== r.id)]
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    onReels?.(list);
    return list;
  });

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
        setShownId(list[0]?.id || null);
        if (autoStart && !started.current && !list.some(reelWorking)) {
          started.current = true;
          start(startWith?.direction || '', startWith?.styleId || '');
        }
      })
      .catch(() => { if (alive) { put([]); setErr('Your reels could not be loaded.'); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // poll every running job until it lands
  const running = (reels || []).filter(reelWorking).map((r) => r.id).join(',');
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => {
      running.split(',').forEach((id) => getCaptureReel(id).then(upsert).catch(() => {}));
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
              Bauhly picks the strongest shots, writes a hook for the first second, records a
              voiceover in your voice (or keeps what you said on camera), and adds word-by-word
              captions and an end card, then puts it on your calendar. It takes about a minute.
            </p>
            <button type="button" className="rls-btn rls-btn--go" onClick={() => setPicking(true)}>
              <Icon name="film" size={16} /> Generate reel
            </button>
          </div>
        ) : (
          <div className="rls__body">
            <div className="rls__stage">
              {reel.status === 'done' && src ? (
                <video key={reel.id} className="rls__video" src={src} poster={reel.posterUrl || undefined} controls autoPlay playsInline loop />
              ) : (
                <div className="rls__wait" style={reel.posterUrl ? { backgroundImage: `url(${reel.posterUrl})` } : undefined}>
                  {reelWorking(reel) ? (
                    <ol className="rls__steps">
                      {STEPS.map((s, i) => {
                        const at = reel.status === 'queued' ? -1 : stepAt(reel.stage);
                        const state = i < at ? 'done' : i === at ? 'now' : 'next';
                        return (
                          <li key={s.id} className={`rls__step is-${state}`}>
                            <span className="rls__dot">{state === 'done' ? <Icon name="check" size={12} strokeWidth={3} /> : state === 'now' ? <span className="pj-spin" /> : null}</span>
                            {s.say}
                          </li>
                        );
                      })}
                      <li className="rls__note">{reel.status === 'queued' ? 'Waiting for the reel ahead of it…' : 'You can close this — it keeps going.'}</li>
                    </ol>
                  ) : (
                    <div className="rls__fail">
                      <Icon name="info" size={18} />
                      <p>{reel.error || 'The reel could not be made this time.'}</p>
                      <button type="button" className="rls-btn rls-btn--go" onClick={() => start(reel.direction || '')}>Try again</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <aside className="rls__side">
              {reelWorking(reel) && !reel.hook && (
                <>
                  <p className="rls__hook">Making your reel</p>
                  <p className="rls__concept">
                    Usually about a minute. You can close this and keep working — the reel
                    shows on this capture when it is ready.
                  </p>
                </>
              )}
              {reel.hook && <p className="rls__hook">“{reel.hook}”</p>}
              {reel.concept && <p className="rls__concept">{reel.concept}</p>}
              <p className="rls__style">{reel.styleName ? `Style · ${reel.styleName}` : 'Style · Default'}</p>
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
                    {Math.round(reel.durationSec)}s · {reel.audioMode === 'original' ? 'your own audio' : reel.audioMode === 'music' ? 'music' : 'voiceover'}
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
