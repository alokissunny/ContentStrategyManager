/* Experimental reel editor: ordered video/photo sources are rendered into a
 * stitched MP4. Captions, graphics, and virtual backgrounds remain live overlays.
 * Source media and rendered output are stored locally in IndexedDB.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../brand/Icon';
import { useFeatureFlags } from '../../lib/featureFlags';
import { useAuth } from '../../context/AuthContext';
import { loadReelDraft, saveReelDraft, clearReelDraft } from '../../lib/reelDraft';
import { uploadReelClip, editReel, assembleReel, isSupportedVideo, isSupportedMedia } from '../../api/reels';
import { sampleVideoFrames } from '../../lib/reelFrames';
import ReelEditView from './ReelEditView';
import ReelBackgroundPicker from './ReelBackgroundPicker';
import ReelVideo from './ReelVideo';
import { getReelBackground } from './reelBackgrounds';
import './reelEditor.css';

const MAX_DURATION_SEC = 180;
const MAX_ASSETS = 12;
const SUGGESTIONS = ['Make it punchy', 'Educational tone', 'Storytime', 'Add a strong CTA'];
const AGENT_STEPS = [
  'Watching the video & transcribing',
  'Directing the hook & pacing',
  'Styling captions',
  'Placing animations & pointers',
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
  const t = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
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
        if (a.type === 'zoom' || a.type === 'title') return null; // title → TitleCard; zoom → video wrapper
        const opacity = animOpacity(a, time);
        const x = a.position?.x ?? 50;
        const y = a.position?.y ?? 50;

        // Context-anchored pointers — positioned on a real on-screen subject.
        if (a.type === 'spotlight') {
          return (
            <div
              key={i}
              className="rl-anim rl-anim--spotlight"
              style={{ opacity, background: `radial-gradient(circle at ${x}% ${y}%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 10%, rgba(0,0,0,0.55) 24%)` }}
            />
          );
        }
        if (a.type === 'pointer') {
          return (
            <div key={i} className="rl-anim rl-anim--pointer" style={{ left: `${x}%`, top: `${y}%`, opacity }}>
              <span className="rl-ring" />
              <span className="rl-ring rl-ring--2" />
              <span className="rl-dot" />
            </div>
          );
        }
        if (a.type === 'label') {
          return (
            <div key={i} className="rl-anim rl-anim--labelwrap" style={{ left: `${x}%`, top: `${y}%`, opacity }}>
              <span className="rl-label__pill" style={{ transform: `translate(-50%, calc(-100% - 20px)) ${motionTransform(a, time)}` }}>{a.text}</span>
              <span className="rl-label__leader" />
              <span className="rl-label__dot" />
            </div>
          );
        }

        const style = {
          left: `${x}%`,
          top: `${y}%`,
          opacity,
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

// ── editorial "founder POV" frame ─────────────────────────────────────────────
// Persistent top brand bar: brand name (left) + tag (right).
function BrandBar({ brand }) {
  if (!brand?.name) return null;
  return (
    <div className="rl-brandbar">
      <span className="rl-brandbar__logo"><i className="rl-dotmark" />{brand.name}</span>
      {brand.tag && <span className="rl-brandbar__tag">{brand.tag}</span>}
    </div>
  );
}

// Big opening title card (eyebrow + hook, last word in the accent + underline tick).
const TITLE_END = 2.8;
function TitleCard({ strategy, time }) {
  if (!strategy?.hook || time > TITLE_END) return null;
  const words = String(strategy.hook).toUpperCase().split(/\s+/).filter(Boolean);
  // A real hook is short; anything longer isn't a crafted title — don't render it.
  if (words.length < 2 || words.length > 9) return null;
  const opacity = Math.min(1, (TITLE_END - time) / 0.4);
  const cut = words.length > 2 ? words.length - 2 : Math.max(1, words.length - 1);
  const head = words.slice(0, cut).join(' ');
  const tail = words.slice(cut).join(' ');
  return (
    <div className="rl-title" style={{ opacity }}>
      {strategy.hookEyebrow && <span className="rl-title__eyebrow">{strategy.hookEyebrow}</span>}
      <span className="rl-title__head">
        {head} {tail && <span className="rl-accent">{tail}</span>}
      </span>
      <span className="rl-title__rule" />
    </div>
  );
}

// Recurring bottom "section card": eyebrow + headline (or chip grid) + progress fill.
function SectionCard({ sections, time }) {
  if (!sections?.length) return null;
  const s = sections.find((x) => time >= x.start && time < x.end);
  if (!s) return null;
  const pct = Math.min(100, Math.max(0, ((time - s.start) / Math.max(0.5, s.end - s.start)) * 100));
  const lit = Math.ceil((pct / 100) * (s.chips?.length || 0));
  return (
    <div className="rl-section">
      {s.eyebrow && <span className="rl-section__eyebrow">{s.eyebrow}</span>}
      {s.chips?.length ? (
        <div className="rl-section__chips">
          {s.chips.map((c, i) => (
            <span key={i} className={`rl-chip ${i < lit ? 'is-lit' : ''}`}>{c}</span>
          ))}
        </div>
      ) : (
        <b className="rl-section__headline">{s.headline}</b>
      )}
      <span className="rl-section__bar"><i style={{ width: `${pct}%` }} /></span>
    </div>
  );
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

  // Accent is set ONLY when it was derived from the video; otherwise the CSS
  // neutral fallbacks apply (no hardcoded brand colour).
  const accent = spec?.brand?.accent || spec?.strategy?.accent || '';
  const background = getReelBackground(spec?.background);
  const screenStyle = { ...SCREEN_STYLE, background: background.background, ...(accent ? { '--reel-accent': accent } : {}) };

  return (
    <div className="reel-stage">
      <div className="reel-phone" style={PHONE_STYLE}>
        <div className="reel-phone__screen" style={screenStyle} onClick={toggle} role="presentation">
          <div className="rl-video-layer">
            <ReelVideo
              videoRef={videoRef}
              background={background.id}
              src={videoUrl}
              className="rl-video"
              style={{ ...VIDEO_BASE, transform: `scale(${zoom})` }}
              playsInline
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onEnded={() => setPlaying(false)}
            />
            {spec?.grade && <div className="rl-grade" />}
          </div>
          <div className="rl-overlay">
            <BrandBar brand={spec?.brand} />
            <AnimationLayer animations={animations} time={time} duration={duration} />
            <SectionCard sections={spec?.sections} time={time} />
            <CaptionLayer captions={spec?.captions} time={time} />
            <TitleCard strategy={spec?.strategy} time={time} />
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

function MixerDecisions({ plan, assets }) {
  if (!plan) return null;
  const name = (index) => assets[index]?.file?.name || `Source ${Number(index) + 1}`;
  let cursor = 0;
  const sequence = (plan.sequence || []).map((clip, index) => {
    const at = cursor;
    cursor += Number(clip.durationSec) || Math.max(0, clip.endSec - clip.startSec);
    if (index < plan.sequence.length - 1 && plan.transition !== 'none') cursor -= 11 / 30;
    return { ...clip, at };
  });
  return <section className="card set-card reel-mixer-decisions" aria-label="Mixer decisions">
    <h2>Mixer decisions</h2>
    {plan.summary && <p>{plan.summary}</p>}
    {sequence.length > 0 && <><h3>Main story</h3><ul>{sequence.map((clip, i) => <li key={i}>
      <b>{fmtTime(clip.at)} · {name(clip.assetIndex)}</b>
      <span>Source {fmtTime(clip.startSec)}–{fmtTime(clip.endSec ?? (clip.startSec || 0) + clip.durationSec)}</span>
      {clip.reason && <span>{clip.reason}</span>}
    </li>)}</ul></>}
    {plan.overlays?.length > 0 && <><h3>Supporting visuals</h3><ul>{plan.overlays.map((clip, i) => <li key={i}>
      <b>{fmtTime(clip.atSec)}–{fmtTime(clip.atSec + clip.durationSec)} · {clip.mode === 'pip' ? 'Small-screen insert' : 'Full-screen cutaway'}</b>
      <span>{name(clip.assetIndex)}{assets[clip.assetIndex]?.kind === 'video' ? ` · source from ${fmtTime(clip.startSec)} · muted` : ''}</span>
      {clip.reason && <span>{clip.reason}</span>}
    </li>)}</ul><p className="reel-field__hint">The main story audio continues underneath supporting visuals.</p></>}
    {plan.omitted?.length > 0 && <><h3>Left out</h3><ul>{plan.omitted.map((clip, i) => <li key={i}><b>{name(clip.assetIndex)}</b><span>{clip.reason}</span></li>)}</ul></>}
  </section>;
}

// ── the page ─────────────────────────────────────────────────────────────────
export default function ReelEditor() {
  const { user } = useAuth();
  const owner = user?._id || user?.id || user?.email;
  if (!owner) return null;
  return <ReelEditorDraft key={owner} owner={owner} />;
}

function ReelEditorDraft({ owner }) {
  const flags = useFeatureFlags();
  const [assets, setAssets] = useState([]);
  const assetFiles = useMemo(() => assets.map((a) => a.file), [assets]);
  const [transition, setTransition] = useState('fade');
  const [mixMode, setMixMode] = useState('smart');
  const [file, setFile] = useState(null);
  const [reading, setReading] = useState(false);
  const assetUrls = useRef(new Set());
  useEffect(() => () => assetUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const [meta, setMeta] = useState(null); // { duration, width, height, url }
  const [guidance, setGuidance] = useState('');
  const [background, setBackground] = useState('original');
  const [cleanAudio, setCleanAudio] = useState(true);
  const [enhancedFile, setEnhancedFile] = useState(null);
  const [enhancedUrl, setEnhancedUrl] = useState('');
  const agentSteps = useMemo(() => cleanAudio ? ['Cleaning & leveling voice', ...AGENT_STEPS] : AGENT_STEPS, [cleanAudio]);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | uploading | editing | done
  const [progress, setProgress] = useState(0);
  const [editStep, setEditStep] = useState(0);
  const [result, setResult] = useState(null); // { spec, transcript, direction, notes }
  const [editedSpec, setEditedSpec] = useState(null); // working copy for manual timeline edits
  const [editMode, setEditMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);
  const [draftReady, setDraftReady] = useState(false);
  const [storageStatus, setStorageStatus] = useState('');
  const saveVersion = useRef(0);

  // Revoke the local preview URL when the clip changes or the page unmounts.
  useEffect(() => () => { if (meta?.url) URL.revokeObjectURL(meta.url); }, [meta]);

  useEffect(() => {
    if (!enhancedFile) { setEnhancedUrl(''); return undefined; }
    const url = URL.createObjectURL(enhancedFile);
    setEnhancedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [enhancedFile]);

  useEffect(() => {
    let cancelled = false;
    loadReelDraft(owner).then((draft) => {
      if (cancelled || !draft) return;
      if (!draft.assets && draft.file && !draft.meta) throw new Error('Invalid saved reel.');
      const entries = draft.assets || (draft.file ? [{ id: 'legacy', kind: 'video', startSec: 0, endSec: draft.meta.duration, durationSec: draft.meta.duration, ...draft.meta }] : []);
      const files = draft.assetFiles || [draft.file];
      const restored = entries.map((entry, i) => {
        if (!(files[i] instanceof Blob)) throw new Error('Invalid saved media.');
        const source = files[i] instanceof File ? files[i] : new File([files[i]], entry.fileName || draft.fileName || 'Your clip.mp4', { type: files[i].type });
        const url = URL.createObjectURL(source);
        assetUrls.current.add(url);
        return { ...entry, file: source, url };
      });
      setAssets(restored);
      setTransition(draft.transition || 'fade');
      setMixMode(draft.mixMode === 'manual' ? 'manual' : 'smart');
      const assembled = draft.assembledFile || (!draft.assets ? draft.file : null);
      setFile(assembled);
      setCleanAudio(draft.cleanAudio !== false);
      setEnhancedFile(draft.enhancedFile instanceof Blob ? draft.enhancedFile : null);
      if (assembled && draft.meta) setMeta({ ...draft.meta, url: URL.createObjectURL(assembled) });
      setGuidance(draft.guidance || '');
      setBackground(getReelBackground(draft.background).id);
      setResult(draft.result || null);
      setEditedSpec(draft.editedSpec || draft.result?.spec || null);
      setPhase(draft.result ? 'done' : 'idle');
      setStorageStatus('Saved on this browser');
    }).catch(() => {
      if (!cancelled) setStorageStatus('Could not restore the local draft. Please upload your clip again.');
    }).finally(() => {
      if (!cancelled) setDraftReady(true);
    });
    return () => { cancelled = true; };
  }, [owner]);

  useEffect(() => {
    if (!draftReady || !assets.length) return;
    const version = ++saveVersion.current;
    setStorageStatus('Saving on this browser…');
    // Save immediately, without a debounce that could lose edits on refresh.
    saveReelDraft(owner, {
      assetFiles,
      assets: assets.map(({ file: source, url, ...a }) => ({ ...a, fileName: source.name })),
      transition, mixMode, assembledFile: file, enhancedFile, cleanAudio,
      meta: meta ? { duration: meta.duration, width: meta.width, height: meta.height } : null,
      guidance, background, result, editedSpec,
    }).then(() => {
      if (saveVersion.current === version) setStorageStatus('Saved on this browser');
    }).catch(() => {
      if (saveVersion.current === version) setStorageStatus('Could not save locally. Browser storage may be full or unavailable; this draft may be lost on refresh.');
    });
    return () => { saveVersion.current += 1; };
  }, [owner, draftReady, assets, assetFiles, transition, mixMode, file, meta, guidance, background, result, editedSpec, enhancedFile, cleanAudio]);

  // Cosmetic: walk the agent-step list while the pipeline runs (it runs these
  // stages server-side in this order; the single request can't stream progress).
  useEffect(() => {
    if (phase !== 'editing') return undefined;
    setEditStep(0);
    const id = setInterval(() => setEditStep((s) => Math.min(agentSteps.length - 1, s + 1)), 2600);
    return () => clearInterval(id);
  }, [phase, agentSteps]);

  const busy = !draftReady || reading || ['uploading', 'assembling', 'editing'].includes(phase);
  const totalDuration = assets.reduce((sum, a) => sum + (a.kind === 'image' ? a.durationSec : a.endSec - a.startSec), 0) - (mixMode === 'smart' || transition === 'none' ? 0 : Math.max(0, assets.length - 1) * (11 / 30));
  const validAssets = assets.length > 0 && assets.every((a) => a.kind === 'image'
    ? Number.isFinite(a.durationSec) && a.durationSec >= 1 && a.durationSec <= 10
    : Number.isFinite(a.startSec) && Number.isFinite(a.endSec) && a.startSec >= 0 && a.endSec <= a.duration && a.endSec - a.startSec >= 1 && a.endSec - a.startSec <= MAX_DURATION_SEC);
  const invalidate = () => { setFile(null); setMeta(null); setResult(null); setEditedSpec(null); setEnhancedFile(null); setEditMode(false); setPhase('idle'); };
  const updateAsset = (id, changes) => { invalidate(); setAssets((items) => items.map((a) => a.id === id ? { ...a, ...changes } : a)); };
  const removeAsset = (id) => {
    if (assets.length === 1) { reset(); return; }
    const removed = assets.find((a) => a.id === id);
    if (removed) { URL.revokeObjectURL(removed.url); assetUrls.current.delete(removed.url); }
    invalidate();
    setAssets((items) => items.filter((a) => a.id !== id));
  };
  const moveAsset = (index, direction) => {
    invalidate();
    setAssets((items) => { const next = [...items]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; return next; });
  };
  const pickFiles = async (selection) => {
    if (busy) return;
    const incoming = Array.from(selection || []);
    if (!incoming.length) return;
    setError('');
    if (assets.length + incoming.length > MAX_ASSETS) { setError('Choose up to 12 videos and photos per reel.'); return; }
    if (incoming.some((f) => f.size > 100 * 1024 * 1024)) { setError('Each file must be 100 MB or smaller.'); return; }
    if ([...assets.map((a) => a.file), ...incoming].reduce((sum, f) => sum + f.size, 0) > 300 * 1024 * 1024) { setError('Keep the total upload size within 300 MB.'); return; }
    if (incoming.some((f) => !isSupportedMedia(f))) { setError('Use MP4, MOV, WebM, JPEG, PNG, or WebP files.'); return; }
    setReading(true);
    const added = [];
    try {
      for (const source of incoming) {
        const kind = isSupportedVideo(source) ? 'video' : 'image';
        let m;
        if (kind === 'video') {
          m = await readVideoMeta(source);
          if (!Number.isFinite(m.duration) || m.duration < 1) { URL.revokeObjectURL(m.url); throw new Error('Video clips must have at least one second of playable media.'); }
        } else {
          const url = URL.createObjectURL(source);
          m = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')); };
            img.src = url;
          });
        }
        assetUrls.current.add(m.url);
        added.push({ ...m, id: crypto.randomUUID(), file: source, kind, startSec: 0, endSec: m.duration, durationSec: kind === 'image' ? 3 : m.duration });
      }
      invalidate();
      setAssets((items) => [...items, ...added]);
    } catch (err) {
      added.forEach((a) => { URL.revokeObjectURL(a.url); assetUrls.current.delete(a.url); });
      setError(err.message || 'Could not read this media.');
    } finally { setReading(false); }
  };
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); if (!busy) pickFiles(e.dataTransfer.files); };

  const addSuggestion = (s) => {
    setGuidance((g) => (g.trim() ? `${g.trim()} ${s}.` : `${s}.`));
  };

  const generate = async () => {
    if (!validAssets || (mixMode === 'manual' && totalDuration > MAX_DURATION_SEC) || busy) return;
    setError('');
    setResult(null);
    setEditedSpec(null);
    setEditMode(false);
    setEnhancedFile(null);
    try {
      setPhase('uploading');
      setProgress(0);
      const uploaded = [];
      for (let i = 0; i < assets.length; i += 1) {
        const asset = assets[i];
        const { key } = await uploadReelClip(asset.file, (pct) => setProgress(Math.round((i * 100 + pct) / assets.length)));
        uploaded.push({ key, kind: asset.kind, startSec: asset.startSec, endSec: asset.endSec, durationSec: asset.kind === 'image' ? asset.durationSec : asset.endSec - asset.startSec });
      }
      setPhase('assembling');
      const assembled = await assembleReel({ assets: uploaded, transition, guidance: guidance.trim(), mixMode });
      const response = await fetch(assembled.url, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Could not download the assembled reel. Please try again.');
      const assembledFile = await response.blob();
      const assembledMeta = await readVideoMeta(assembledFile);
      setFile(assembledFile);
      setMeta(assembledMeta);
      const key = assembled.key;
      const frameCount = Math.max(5, Math.min(10, Math.round(assembled.durationSec / 15)));
      const sampled = await sampleVideoFrames(assembledMeta.url, { count: frameCount });
      setPhase('editing');
      const data = await editReel({
        key,
        durationSec: assembled.durationSec,
        guidance: guidance.trim(),
        frames: sampled.frames,
        accentColor: sampled.accentColor,
        cleanAudio,
      });
      data.mixPlan = assembled.mixPlan || null;
      data.notes = [...(assembled.notes || []), ...(data.notes || [])];
      if (data.audioCleanup?.status === 'applied') {
        try {
          const response = await fetch(data.audioCleanup.url, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error('Could not download cleaned clip');
          const blob = await response.blob();
          // Confirm this is playable before switching away from the original.
          const cleanedMeta = await readVideoMeta(blob);
          URL.revokeObjectURL(cleanedMeta.url);
          setStorageStatus('Saving on this browser…');
          setEnhancedFile(blob);
        } catch {
          data.audioCleanup = { status: 'failed' };
          data.notes = [...(data.notes || []), 'Could not load the cleaned audio. Preview uses the original audio; regenerate to try again.'];
        }
        // The bytes are saved in IndexedDB, not an expiring download URL.
        delete data.audioCleanup.url;
      }
      setResult(data);
      setEditedSpec(typeof structuredClone === 'function' ? structuredClone(data.spec) : JSON.parse(JSON.stringify(data.spec)));
      setEditMode(false);
      setPhase('done');
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Could not edit that reel.');
      setPhase('idle');
    }
  };

  const reset = () => {
    saveVersion.current += 1;
    setStorageStatus('Clearing local draft…');
    clearReelDraft(owner).then(() => {
      setStorageStatus('');
    }).catch(() => {
      setStorageStatus('Could not clear the local draft. It may reappear after refresh.');
    });
    setEditedSpec(null);
    setEditMode(false);
    if (meta?.url) URL.revokeObjectURL(meta.url);
    setFile(null);
    setAssets([]);
    setTransition('fade');
    setMixMode('smart');
    assetUrls.current.forEach((url) => URL.revokeObjectURL(url));
    assetUrls.current.clear();
    setEnhancedFile(null);
    setCleanAudio(true);
    setMeta(null);
    setResult(null);
    setGuidance('');
    setBackground('original');
    setError('');
    setPhase('idle');
    setProgress(0);
  };

  const previewVideoUrl = cleanAudio && enhancedFile && enhancedUrl ? enhancedUrl : meta?.url;
  const hasMixedOverlays = Boolean(result?.mixPlan?.overlays?.length);
  const strategy = result?.direction || result?.spec?.strategy;
  // Prefer the manually-edited working copy so tweaks show in the live preview too.
  const previewSpec = useMemo(
    () => meta ? { ...(editedSpec || result?.spec || { meta: { durationSec: meta.duration }, captions: { cues: [] }, animations: [] }), background: hasMixedOverlays ? 'original' : background } : null,
    [editedSpec, result, meta, background, hasMixedOverlays],
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
        <div style={{ display: 'flex', gap: 8 }}>
          {editMode ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditMode(false)}>
              <Icon name="arrow-left" size={14} /> Exit edit mode
            </button>
          ) : (
            <>
              {editedSpec && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditMode(true)} disabled={busy}>
                  <Icon name="edit" size={14} /> Edit on timeline
                </button>
              )}
              {assets.length > 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={reset} disabled={busy}>
                  <Icon name="plus" size={14} /> New reel
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {storageStatus && <p className="reel-field__hint" role="status">{storageStatus}</p>}

      {draftReady && assets.length > 0 && (
        <div className="reel-audio">
          <label><input type="checkbox" checked={cleanAudio} onChange={(event) => { setStorageStatus('Saving on this browser…'); setCleanAudio(event.target.checked); }} disabled={busy} /> Clean voice audio</label>
          <p className="reel-field__hint">Reduce steady background noise and rumble, and balance voice volume.</p>
          <span role="status">{enhancedFile
            ? cleanAudio ? 'Previewing cleaned audio. Turn off to compare with the original.' : 'Previewing original audio. Turn on to hear cleaned audio.'
            : result?.audioCleanup?.status === 'no-audio' ? 'No audio track found in this clip.'
              : cleanAudio ? 'Applied when you generate or regenerate this reel.' : 'Original audio will be used.'}</span>
        </div>
      )}

      {!draftReady ? <p role="status">Restoring your local reel…</p> : editMode && editedSpec && meta ? (
        <ReelEditView
          videoUrl={previewVideoUrl}
          spec={previewSpec}
          onChange={setEditedSpec}
          onBackgroundChange={setBackground}
          backgroundDisabled={hasMixedOverlays}
          onExit={() => setEditMode(false)}
        />
      ) : (
      <>
      {/* eslint-disable-next-line react/jsx-no-useless-fragment */}

      <p className="reel-lead">
        Add up to 12 videos and photos. An Instagram video editor agent builds the story, places supporting media where it adds value, and chooses transitions for one reel up to 3 minutes. Add context below to guide the edit.
      </p>

      <div className="reel-grid">
        {/* ── left: inputs ── */}
        <div className="reel-col">
          <div className={`reel-drop ${dragOver ? 'is-over' : ''}`} onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
            <span className="reel-drop__ico"><Icon name="upload" size={24} /></span>
            <button className="btn btn--ghost" type="button" disabled={busy || assets.length >= MAX_ASSETS} onClick={() => inputRef.current?.click()}>{reading ? 'Reading media…' : assets.length ? 'Add videos or photos' : 'Choose videos and photos'}</button>
            <span>Or drop files here · MP4, MOV, WebM, JPEG, PNG, WebP · up to 12 files</span>
            <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" multiple hidden disabled={busy} onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {assets.length > 0 && <div className="card set-card reel-assets">
            <fieldset className="reel-mix-mode" disabled={busy}>
              <legend>How should we combine your media?</legend>
              <label><input type="radio" name="mixMode" value="smart" checked={mixMode === 'smart'} onChange={() => { invalidate(); setMixMode('smart'); }} /> Let the editor decide</label>
              <label><input type="radio" name="mixMode" value="manual" checked={mixMode === 'manual'} onChange={() => { invalidate(); setMixMode('manual'); }} /> Use my sequence</label>
            </fieldset>
            <div className="reel-field__label">{mixMode === 'smart' ? 'Source media' : 'Your sequence'} · {assets.length}/12</div>
            <p className="reel-field__hint">{mixMode === 'smart' ? 'Source order is not the final edit. The mixer watches your media and uses speech and your brief to select the story, add small-screen inserts or full-screen cutaways, and skip media that does not fit. Source trims set the available footage.' : 'Clips play in this order. Landscape media is fitted into the vertical reel.'}</p>
            {assets.map((asset, index) => <div className="reel-asset" key={asset.id}>
              <div className="reel-clip">
                {asset.kind === 'image' ? <img className="reel-clip__thumb" src={asset.url} alt="" /> : <video className="reel-clip__thumb" src={asset.url} muted playsInline preload="metadata" />}
                <span className="reel-clip__main"><b>{index + 1}. {asset.file.name}</b><span>{asset.kind === 'image' ? 'Photo' : `${asset.duration.toFixed(1)}s video`} · {asset.width}×{asset.height}</span></span>
                <button className="btn btn--ghost btn--sm" type="button" aria-label={`Remove ${asset.file.name}`} disabled={busy} onClick={() => removeAsset(asset.id)}>Remove</button>
              </div>
              <div className="reel-asset__controls">
                <button type="button" disabled={busy || index === 0} onClick={() => moveAsset(index, -1)} aria-label={`Move ${asset.file.name} earlier`}>↑ Earlier</button>
                <button type="button" disabled={busy || index === assets.length - 1} onClick={() => moveAsset(index, 1)} aria-label={`Move ${asset.file.name} later`}>↓ Later</button>
                {asset.kind === 'image' ? <label>Show for (s)<input type="number" min="1" max="10" step="0.1" value={asset.durationSec} disabled={busy} onChange={(e) => updateAsset(asset.id, { durationSec: Number(e.target.value) })} /></label> : <>
                  <label>Start (s)<input type="number" min="0" max={asset.duration} step="0.1" value={asset.startSec} disabled={busy} onChange={(e) => updateAsset(asset.id, { startSec: Number(e.target.value) })} /></label>
                  <label>End (s)<input type="number" min="1" max={asset.duration} step="0.1" value={asset.endSec} disabled={busy} onChange={(e) => updateAsset(asset.id, { endSec: Number(e.target.value) })} /></label>
                </>}
              </div>
            </div>)}
            {mixMode === 'manual' && <label className="reel-transition">Between clips <select value={transition} disabled={busy} onChange={(e) => { invalidate(); setTransition(e.target.value); }}><option value="none">Cut (no transition)</option><option value="fade">Crossfade</option><option value="slide">Slide</option></select></label>}
            <p className="reel-field__hint">{Math.max(0, totalDuration).toFixed(1)}s {mixMode === 'smart' ? 'of source media · editor selects up to 180s and chooses transitions' : '/ 180s'}{mixMode === 'manual' && transition !== 'none' && assets.length > 1 ? ' · ~0.37s overlap per transition' : ''}</p>
            {!validAssets && <p className="reel-err">Each video trim must be 1–180 seconds and within the source clip. Photos must be 1–10 seconds.</p>}
            {mixMode === 'manual' && totalDuration > MAX_DURATION_SEC && <p className="reel-err">Trim clips or shorten photos to keep your reel within 180 seconds.</p>}
          </div>}

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

          <div className="card set-card">
            <ReelBackgroundPicker value={hasMixedOverlays ? 'original' : background} onChange={setBackground} disabled={busy || hasMixedOverlays} />
            {hasMixedOverlays && <p className="reel-field__hint">Virtual backgrounds are unavailable for mixes with cutaways or picture-in-picture.</p>}
          </div>

          {error && <p className="reel-err">{error}</p>}

          <button type="button" className="btn reel-go" disabled={!validAssets || (mixMode === 'manual' && totalDuration > MAX_DURATION_SEC) || busy} onClick={generate}>
            <Icon name="sparkle" size={16} />
            {phase === 'uploading'
              ? `Uploading… ${progress}%`
              : phase === 'assembling' ? (mixMode === 'smart' ? 'Mixer is planning & composing…' : 'Stitching clips & transitions…')
              : phase === 'editing'
                ? 'Agents are editing…'
                : result ? 'Re-generate reel' : 'Generate viral reel'}
          </button>

          {phase === 'editing' && (
            <ul className="reel-steps">
              {agentSteps.map((label, i) => (
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
            <PreviewStage key={previewVideoUrl} videoUrl={previewVideoUrl} spec={previewSpec}>
              {file && <div className="reel-download"><a className="btn btn--ghost btn--sm" href={previewVideoUrl} download="stitched-reel.mp4">Download stitched MP4</a><p className="reel-field__hint">Includes cuts, transitions, small-screen inserts, full-screen cutaways, and selected audio. Live captions, graphics, and virtual backgrounds are preview-only.</p></div>}
              <MixerDecisions plan={result?.mixPlan} assets={assets} />
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
          ) : assets.length ? (
            <div className="reel-stage">
              <div className="reel-phone" style={PHONE_STYLE}><div style={SCREEN_STYLE}>{assets[0].kind === 'image' ? <img src={assets[0].url} alt="First uploaded photo" style={{ ...VIDEO_BASE, objectFit: 'contain' }} /> : <video key={assets[0].url} src={assets[0].url} controls playsInline style={{ ...VIDEO_BASE, objectFit: 'contain' }} />}</div></div>
              <p className="reel-field__hint">First source preview, before editing. {mixMode === 'smart' ? 'Generate to see the mixer’s chosen story and supporting visuals.' : 'Generate to see your sequence stitched into one reel.'}</p>
            </div>
          ) : (
            <div className="reel-stage">
              <div className="reel-emptyprev" style={PHONE_STYLE}>
                <Icon name="play" size={26} />
                <p>Add videos or photos to start your reel.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
