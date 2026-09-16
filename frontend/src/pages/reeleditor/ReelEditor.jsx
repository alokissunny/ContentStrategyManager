/*
 * Reel Editor (experimental) — upload a clip (≤60s) + a note, and a multi-agent
 * pipeline (director → caption stylist → motion graphics) returns a "reel spec"
 * we overlay LIVE on the <video> during playback: karaoke/pop captions and
 * on-screen animations, all driven by the video's currentTime. No server render
 * — the preview is a time-synced DOM layer over the local clip.
 *
 * Gated by the `reelEditor` feature flag (Settings → Experimental features).
 *
 * The phone frame and <video> carry INLINE sizing as well as the stylesheet, so
 * a slow/absent CSS chunk can never let the video render at its natural (huge)
 * resolution and swamp the page.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../brand/Icon';
import { useFeatureFlags } from '../../lib/featureFlags';
import { uploadReelClip, editReel, isSupportedVideo } from '../../api/reels';
import './reelEditor.css';

const MAX_DURATION_SEC = 60;
const DURATION_TOLERANCE = 1.5; // allow slightly-over clips
const SUGGESTIONS = ['Make it punchy', 'Educational tone', 'Storytime', 'Add a strong CTA'];
const AGENT_STEPS = [
  'Transcribing & timing captions',
  'Directing the hook & pacing',
  'Styling captions',
  'Placing on-screen animations',
];

// Inline safety sizing — applied regardless of whether the stylesheet loaded.
const PHONE_STYLE = { width: '100%', maxWidth: 300, aspectRatio: '9 / 16', maxHeight: '72vh' };
const SCREEN_STYLE = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' };
const VIDEO_BASE = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };

// Read duration + dimensions from a local file without uploading. Keeps the
// objectURL for instant playback (revoked on reset).
function readVideoMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight, url });
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that video file.')); };
    v.src = url;
  });
}

function fmtTime(s) {
  const sec = Math.max(0, Math.floor(s || 0));
  return `0:${String(sec).padStart(2, '0')}`;
}

// ── the live overlay ─────────────────────────────────────────────────────────
function CaptionLayer({ captions, time }) {
  if (!captions?.cues?.length) return null;
  const cue = captions.cues.find((c) => time >= c.start && time < c.end);
  if (!cue) return null;
  const frac = (time - cue.start) / Math.max(0.1, cue.end - cue.start);
  const words = cue.text.split(/\s+/).filter(Boolean);
  const emph = new Set((cue.emphasis || []).map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, '')));
  const style = captions.style || 'karaoke';

  let inner;
  if (style === 'word') {
    const idx = Math.min(words.length - 1, Math.floor(frac * words.length));
    const w = words[idx] || '';
    inner = <span className={`rl-cap__w is-lit ${emph.has(w.toLowerCase().replace(/[^a-z0-9]/gi, '')) ? 'is-emph' : ''}`}>{w}</span>;
  } else {
    const litCount = style === 'karaoke' ? Math.ceil(frac * words.length) : words.length;
    inner = words.map((w, i) => {
      const bare = w.toLowerCase().replace(/[^a-z0-9]/gi, '');
      const lit = style === 'karaoke' ? i < litCount : true;
      return (
        <span key={i} className={`rl-cap__w ${lit ? 'is-lit' : ''} ${emph.has(bare) ? 'is-emph' : ''}`}>
          {w}{' '}
        </span>
      );
    });
  }
  return (
    <div className={`rl-cap rl-cap--${captions.position || 'bottom'} rl-cap--${style}`}>
      <span className="rl-cap__box">{inner}</span>
    </div>
  );
}

function animOpacity(a, time) {
  const enter = Math.min(1, (time - a.start) / 0.4);
  const exit = Math.min(1, (a.end - time) / 0.35);
  return Math.max(0, Math.min(enter, exit));
}

function motionTransform(a, time) {
  const p = Math.min(1, (time - a.start) / 0.4); // 0→1 entrance
  const ease = 1 - Math.pow(1 - p, 3);
  switch (a.motion) {
    case 'slide-up': return `translateY(${(1 - ease) * 24}px)`;
    case 'pop': return `scale(${0.7 + ease * 0.3})`;
    case 'bounce': return `translateY(${(1 - ease) * -18}px)`;
    case 'shake': return `translateX(${Math.sin(time * 30) * (1 - ease) * 6}px)`;
    default: return 'none';
  }
}

function AnimationLayer({ animations, time, duration }) {
  return (
    <>
      {animations.map((a, i) => {
        if (a.type === 'progress') {
          return (
            <div key={i} className="rl-anim rl-anim--progress">
              <i style={{ width: `${Math.min(100, (time / Math.max(1, duration)) * 100)}%` }} />
            </div>
          );
        }
        if (time < a.start || time > a.end) return null;
        if (a.type === 'zoom') return null; // handled on the video wrapper
        const style = {
          left: `${a.position.x}%`,
          top: `${a.position.y}%`,
          opacity: animOpacity(a, time),
          transform: `translate(-50%, -50%) ${motionTransform(a, time)}`,
        };
        const cls = `rl-anim rl-anim--${a.type}${a.emphasis ? ' is-emph' : ''}`;
        if (a.type === 'emoji') return <div key={i} className={cls} style={style}>{a.emoji || '✨'}</div>;
        return <div key={i} className={cls} style={style}>{a.text}</div>;
      })}
    </>
  );
}

// Active zoom animation → a subtle scale on the video itself.
function zoomScale(animations, time) {
  const z = animations.find((a) => a.type === 'zoom' && time >= a.start && time <= a.end);
  if (!z) return 1;
  const mid = (z.start + z.end) / 2;
  const half = Math.max(0.1, (z.end - z.start) / 2);
  return 1 + (1 - Math.min(1, Math.abs(time - mid) / half)) * 0.12;
}

function PreviewStage({ videoUrl, spec, children }) {
  const videoRef = useRef(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef(0);

  const duration = spec?.meta?.durationSec || 0;
  const animations = spec?.animations || [];

  const tick = useCallback(() => {
    const v = videoRef.current;
    if (v) setTime(v.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (playing) rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, tick]);

  const zoom = zoomScale(animations, time);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  return (
    <div className="reel-stage">
      <div className="reel-phone" style={PHONE_STYLE}>
        <div className="reel-phone__screen" style={SCREEN_STYLE} onClick={toggle} role="presentation">
          <video
            ref={videoRef}
            src={videoUrl}
            className="rl-video"
            style={{ ...VIDEO_BASE, transform: `scale(${zoom})` }}
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
          />
          <div className="rl-overlay">
            <AnimationLayer animations={animations} time={time} duration={duration} />
            <CaptionLayer captions={spec?.captions} time={time} />
          </div>
          {!playing && (
            <button type="button" className="rl-play" aria-label="Play preview" onClick={(e) => { e.stopPropagation(); toggle(); }}>
              <Icon name="play" size={28} />
            </button>
          )}
        </div>
      </div>
      <div className="reel-scrub">
        <span>{fmtTime(time)}</span>
        <div className="reel-scrub__bar"><i style={{ width: `${Math.min(100, (time / Math.max(1, duration)) * 100)}%` }} /></div>
        <span>{fmtTime(duration)}</span>
      </div>
      {children}
    </div>
  );
}

// ── the page ─────────────────────────────────────────────────────────────────
export default function ReelEditor() {
  const flags = useFeatureFlags();
  const [file, setFile] = useState(null);
  const [meta, setMeta] = useState(null); // { duration, width, height, url }
  const [guidance, setGuidance] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | uploading | editing | done
  const [progress, setProgress] = useState(0);
  const [editStep, setEditStep] = useState(0);
  const [result, setResult] = useState(null); // { spec, transcript, direction, notes }
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  // Revoke the local preview URL when the clip changes or the page unmounts.
  useEffect(() => () => { if (meta?.url) URL.revokeObjectURL(meta.url); }, [meta]);

  // Cosmetic: walk the agent-step list while the pipeline runs (it runs these
  // stages server-side in this order; the single request can't stream progress).
  useEffect(() => {
    if (phase !== 'editing') return undefined;
    setEditStep(0);
    const id = setInterval(() => setEditStep((s) => Math.min(AGENT_STEPS.length - 1, s + 1)), 2600);
    return () => clearInterval(id);
  }, [phase]);

  const busy = phase === 'uploading' || phase === 'editing';

  const pickFile = useCallback(async (f) => {
    setError('');
    if (!f) return;
    if (!isSupportedVideo(f)) {
      setError('Please upload an MP4, MOV, or WebM video.');
      return;
    }
    try {
      const m = await readVideoMeta(f);
      if (m.duration > MAX_DURATION_SEC + DURATION_TOLERANCE) {
        URL.revokeObjectURL(m.url);
        setError(`That clip is ${Math.round(m.duration)}s. Reels must be 60 seconds or less.`);
        return;
      }
      setMeta((prev) => { if (prev?.url) URL.revokeObjectURL(prev.url); return m; });
      setFile(f);
      setResult(null);
      setPhase('idle');
    } catch (err) {
      setError(err.message || 'Could not read that video.');
    }
  }, []);

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  };

  const addSuggestion = (s) => {
    setGuidance((g) => (g.trim() ? `${g.trim()} ${s}.` : `${s}.`));
  };

  const generate = async () => {
    if (!file || !meta || busy) return;
    setError('');
    setResult(null);
    try {
      setPhase('uploading');
      setProgress(0);
      const { key } = await uploadReelClip(file, setProgress);
      setPhase('editing');
      const data = await editReel({ key, durationSec: meta.duration, guidance: guidance.trim() });
      setResult(data);
      setPhase('done');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not edit that reel.');
      setPhase('idle');
    }
  };

  const reset = () => {
    if (meta?.url) URL.revokeObjectURL(meta.url);
    setFile(null);
    setMeta(null);
    setResult(null);
    setGuidance('');
    setError('');
    setPhase('idle');
    setProgress(0);
  };

  const strategy = result?.direction || result?.spec?.strategy;
  const previewSpec = useMemo(
    () => result?.spec || (meta ? { meta: { durationSec: meta.duration }, captions: { cues: [] }, animations: [] } : null),
    [result, meta],
  );

  if (!flags.reelEditor) {
    return (
      <div className="reel-page">
        <div className="page-head">
          <div>
            <span className="eyebrow">Experimental</span>
            <h1>Reel editor</h1>
          </div>
        </div>
        <section className="card set-card">
          <p className="set-card__sub">
            The Reel editor is off. Turn it on under{' '}
            <Link to="/dashboard/settings">Settings → Experimental features</Link> to try it.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="reel-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Experimental</span>
          <h1>Reel editor</h1>
        </div>
        {meta && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={busy}>
            <Icon name="plus" size={14} /> New reel
          </button>
        )}
      </div>

      <p className="reel-lead">
        Upload a clip (up to 60s) and tell the agents what you&rsquo;re going for. A director, a
        caption stylist, and a motion-graphics agent cut it into a viral-style reel with live
        captions and on-screen animations — previewed right here.
      </p>

      <div className="reel-grid">
        {/* ── left: inputs ── */}
        <div className="reel-col">
          {!meta ? (
            <div
              className={`reel-drop ${dragOver ? 'is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            >
              <span className="reel-drop__ico"><Icon name="upload" size={24} /></span>
              <b>Drop a clip or click to upload</b>
              <span>MP4, MOV or WebM · up to 60 seconds · vertical 9:16 works best</span>
              <input
                ref={inputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                hidden
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          ) : (
            <div className="card set-card">
              <div className="reel-clip">
                <video className="reel-clip__thumb" src={meta.url} muted playsInline preload="metadata" />
                <span className="reel-clip__main">
                  <b>{file?.name || 'Your clip'}</b>
                  <span>{Math.round(meta.duration)}s · {meta.width}×{meta.height}</span>
                  <span className="reel-clip__ok"><Icon name="check" size={13} /> Ready to edit</span>
                </span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={busy}>
                  <Icon name="x" size={14} /> Remove
                </button>
              </div>
            </div>
          )}

          <div className="card set-card">
            <div className="reel-field__label">What&rsquo;s this reel about?</div>
            <p className="reel-field__hint">
              The more context, the sharper the edit — goal, audience, vibe, a call to action.
            </p>
            <textarea
              className="reel-guidance"
              placeholder="e.g. Behind-the-scenes of restoring a walnut chair. Audience: design-lovers. Punchy, satisfying, ends with 'follow for the full build'."
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              maxLength={2000}
              disabled={busy}
            />
            <div className="reel-chipset">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="reel-suggest" onClick={() => addSuggestion(s)} disabled={busy}>
                  + {s}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="reel-err">{error}</p>}

          <button type="button" className="btn reel-go" disabled={!file || busy} onClick={generate}>
            <Icon name="sparkle" size={16} />
            {phase === 'uploading'
              ? `Uploading… ${progress}%`
              : phase === 'editing'
                ? 'Agents are editing…'
                : result ? 'Re-generate reel' : 'Generate viral reel'}
          </button>

          {phase === 'editing' && (
            <ul className="reel-steps">
              {AGENT_STEPS.map((label, i) => (
                <li key={label} className={i < editStep ? 'is-done' : i === editStep ? 'is-run' : ''}>{label}</li>
              ))}
            </ul>
          )}

          {result?.notes?.length > 0 && (
            <div className="reel-notes">
              {result.notes.map((n, i) => (
                <p key={i}><Icon name="info" size={13} /> {n}</p>
              ))}
            </div>
          )}
        </div>

        {/* ── right: preview + strategy ── */}
        <div className="reel-col reel-col--prev">
          {previewSpec ? (
            <PreviewStage videoUrl={meta.url} spec={previewSpec}>
              {strategy && (
                <div className="card set-card reel-strategy">
                  <h2>The edit</h2>
                  <div className="reel-strategy__hook">
                    <span className="eyebrow">Hook</span>
                    <b>“{strategy.hook || strategy.hookRewrite}”</b>
                    {strategy.hookRationale && <p>{strategy.hookRationale}</p>}
                  </div>
                  <div className="reel-strategy__meta">
                    {strategy.targetEmotion && <span className="reel-chip">{strategy.targetEmotion}</span>}
                    {strategy.pacing && <span className="reel-chip">{strategy.pacing} pacing</span>}
                    {strategy.endCta && <span className="reel-chip">CTA · {strategy.endCta}</span>}
                  </div>
                  {strategy.retentionTactics?.length > 0 && (
                    <ul className="reel-tactics">
                      {strategy.retentionTactics.map((t, i) => (
                        <li key={i}><Icon name="check" size={13} /> {t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </PreviewStage>
          ) : (
            <div className="reel-stage">
              <div className="reel-emptyprev" style={PHONE_STYLE}>
                <Icon name="play" size={26} />
                <p>Upload a clip to see your edited reel preview here.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
