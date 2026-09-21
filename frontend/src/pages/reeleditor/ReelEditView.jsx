/*
 * Reel Edit View — a manual timeline editor over the AI-generated reel spec.
 * Left: the live phone preview (same overlay renderers as the auto preview).
 * Right: an inspector for the selected overlay. Below: a timeline with three
 * lanes (captions / animations / sections) whose blocks can be selected, dragged
 * to retime, and edge-resized. Everything edits `spec` immutably via onChange, so
 * the preview updates live. Nothing is fabricated here — the user is in control.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import {
  PHONE_STYLE, SCREEN_STYLE, VIDEO_BASE, fmtTime, ReelOverlay, zoomScale,
} from './reelOverlay';
import ReelBackgroundPicker from './ReelBackgroundPicker';
import ReelVideo from './ReelVideo';
import { getReelBackground } from './reelBackgrounds';
import './reelEditView.css';

const ANIM_TYPES = ['title', 'callout', 'emoji', 'progress', 'zoom', 'lower-third', 'cta', 'pointer', 'spotlight', 'label'];
const TEXT_TYPES = new Set(['title', 'callout', 'cta', 'lower-third', 'label']);
const MOTIONS = ['pop', 'slide-up', 'fade', 'bounce', 'shake'];
const CAP_STYLES = ['boxed', 'karaoke', 'pop', 'word', 'block'];
const CAP_POS = ['bottom', 'center', 'top'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

const TRACKS = [
  { key: 'captions', label: 'Captions' },
  { key: 'animations', label: 'Animations' },
  { key: 'sections', label: 'Sections' },
];

function itemsOf(spec, track) {
  if (track === 'captions') return spec?.captions?.cues || [];
  if (track === 'animations') return spec?.animations || [];
  if (track === 'sections') return spec?.sections || [];
  return [];
}

function blockLabel(track, item) {
  if (track === 'captions') return item.text || '—';
  if (track === 'sections') return item.headline || (item.chips || []).join(' · ') || 'Section';
  if (item.type === 'emoji') return item.emoji || '✨';
  if (item.type === 'progress') return 'progress bar';
  return item.text || item.type;
}

export default function ReelEditView({ videoUrl, spec, onChange, onExit, onBackgroundChange }) {
  const videoRef = useRef(null);
  const lanesRef = useRef(null);
  const rafRef = useRef(0);
  const dragRef = useRef(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState(null); // { track, index }

  const duration = spec?.meta?.durationSec || 0;
  const accent = spec?.brand?.accent || spec?.strategy?.accent || '';
  const background = getReelBackground(spec?.background);
  const screenStyle = { ...SCREEN_STYLE, background: background.background, ...(accent ? { '--reel-accent': accent } : {}) };

  // ── playback ──
  const tick = useCallback(() => {
    const v = videoRef.current;
    if (v) setTime(v.currentTime);
    rafRef.current = requestAnimationFrame(tick);
  }, []);
  useEffect(() => {
    if (playing) rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, tick]);

  const seek = useCallback((t) => {
    const v = videoRef.current;
    const nt = clamp(t, 0, duration || (v?.duration ?? t));
    if (v) v.currentTime = nt;
    setTime(nt);
  }, [duration]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  // ── immutable edits ──
  const patch = useCallback((track, index, p) => {
    const next = clone(spec);
    const list = itemsOf(next, track);
    if (!list[index]) return;
    list[index] = { ...list[index], ...p };
    onChange(next);
  }, [spec, onChange]);

  const patchCaptionsMeta = (p) => { const next = clone(spec); next.captions = { ...(next.captions || {}), ...p }; onChange(next); };

  const removeSelected = useCallback(() => {
    if (!sel) return;
    const next = clone(spec);
    const list = itemsOf(next, sel.track);
    list.splice(sel.index, 1);
    onChange(next);
    setSel(null);
  }, [sel, spec, onChange]);

  const addItem = (track) => {
    const next = clone(spec);
    const start = round2(clamp(time, 0, Math.max(0, duration - 1)));
    let list; let item;
    if (track === 'captions') {
      next.captions = next.captions || { style: 'boxed', position: 'bottom', cues: [] };
      next.captions.cues = next.captions.cues || [];
      list = next.captions.cues;
      item = { start, end: round2(clamp(start + 1.8, start + 0.4, duration)), text: 'New caption', emphasis: [] };
    } else if (track === 'sections') {
      next.sections = next.sections || [];
      list = next.sections;
      item = { start, end: round2(clamp(start + 5, start + 1, duration)), eyebrow: '', headline: 'New section', chips: [] };
    } else {
      next.animations = next.animations || [];
      list = next.animations;
      item = { type: 'callout', start, end: round2(clamp(start + 2, start + 0.4, duration)), text: 'New text', emoji: '🔥', position: { x: 50, y: 42 }, motion: 'pop', emphasis: false };
    }
    list.push(item);
    list.sort((a, b) => a.start - b.start);
    const index = list.indexOf(item);
    onChange(next);
    setSel({ track, index });
    seek(start);
  };

  // ── drag to retime (move / resize) ──
  const onBlockPointerDown = (e, track, index, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setSel({ track, index });
    const lane = lanesRef.current;
    const width = lane ? lane.getBoundingClientRect().width : 1;
    const it = itemsOf(spec, track)[index];
    dragRef.current = { track, index, mode, startX: e.clientX, origStart: it.start, origEnd: it.end, width, moved: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
  };
  const onDragMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaSec = ((e.clientX - d.startX) / Math.max(1, d.width)) * duration;
    if (Math.abs(e.clientX - d.startX) > 2) d.moved = true;
    const len = d.origEnd - d.origStart;
    let start = d.origStart; let end = d.origEnd;
    if (d.mode === 'move') { start = clamp(d.origStart + deltaSec, 0, duration - len); end = start + len; }
    else if (d.mode === 'l') { start = clamp(d.origStart + deltaSec, 0, d.origEnd - 0.3); }
    else if (d.mode === 'r') { end = clamp(d.origEnd + deltaSec, d.origStart + 0.3, duration); }
    patch(d.track, d.index, { start: round2(start), end: round2(end) });
  };
  const onDragUp = () => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
  };

  // ── scrub on the ruler ──
  const scrubFrom = (clientX) => {
    const lane = lanesRef.current;
    if (!lane) return;
    const r = lane.getBoundingClientRect();
    seek(((clientX - r.left) / Math.max(1, r.width)) * duration);
  };
  const onRulerPointerDown = (e) => {
    scrubFrom(e.clientX);
    const move = (ev) => scrubFrom(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // keyboard: Delete removes, space plays/pauses
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  };

  const ticks = useMemo(() => {
    if (!duration) return [];
    const step = duration <= 20 ? 2 : duration <= 60 ? 5 : duration <= 120 ? 15 : 30;
    const out = [];
    for (let t = 0; t <= duration + 0.01; t += step) out.push(round2(t));
    return out;
  }, [duration]);

  const zoom = zoomScale(spec?.animations, time);
  const playheadPct = Math.min(100, (time / Math.max(1, duration)) * 100);
  const selItem = sel ? itemsOf(spec, sel.track)[sel.index] : null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="rle" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="rle__top">
        {/* preview */}
        <div className="rle__stage">
          <div className="reel-phone" style={PHONE_STYLE}>
            <div className="reel-phone__screen" style={screenStyle} onClick={togglePlay} role="presentation">
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
              <ReelOverlay spec={spec} time={time} />
              {!playing && (
                <button type="button" className="rl-play" aria-label="Play" onClick={(e) => { e.stopPropagation(); togglePlay(); }}>
                  <Icon name="play" size={26} />
                </button>
              )}
            </div>
          </div>
          <div className="rle__time"><b>{fmtTime(time)}</b> / {fmtTime(duration)}</div>
        </div>

        {/* inspector */}
        <div className="rle__inspector">
          <ReelBackgroundPicker value={spec?.background} onChange={onBackgroundChange} />
          {selItem ? (
            <Inspector
              track={sel.track}
              item={selItem}
              captions={spec?.captions}
              onPatch={(p) => patch(sel.track, sel.index, p)}
              onPatchCaptions={patchCaptionsMeta}
              onSeek={seek}
              onDelete={removeSelected}
              duration={duration}
            />
          ) : (
            <div className="rle__empty">
              <Icon name="edit" size={22} />
              <p>Select a block on the timeline to edit it, or add a new overlay below.</p>
            </div>
          )}
        </div>
      </div>

      {/* toolbar */}
      <div className="rle__toolbar">
        <button type="button" className="btn btn--ghost btn--sm" onClick={togglePlay}>
          <Icon name={playing ? 'x' : 'play'} size={13} /> {playing ? 'Pause' : 'Play'}
        </button>
        <span className="rle__sep" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => addItem('captions')}><Icon name="plus" size={13} /> Caption</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => addItem('animations')}><Icon name="plus" size={13} /> Animation</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => addItem('sections')}><Icon name="plus" size={13} /> Section</button>
        <span className="rle__sep" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={removeSelected} disabled={!sel}><Icon name="trash" size={13} /> Delete</button>
        <span className="rle__spacer" />
        <button type="button" className="btn btn--primary btn--sm" onClick={onExit}><Icon name="check" size={13} /> Done</button>
      </div>

      {/* timeline */}
      <div className="rle__timeline">
        <div className="rle__ruler" onPointerDown={onRulerPointerDown} role="presentation">
          {ticks.map((t) => (
            <span key={t} className="rle__tick" style={{ left: `${(t / Math.max(1, duration)) * 100}%` }}>{fmtTime(t)}</span>
          ))}
        </div>
        <div className="rle__lanes" ref={lanesRef}>
          <div className="rle__playhead" style={{ left: `${playheadPct}%` }} />
          {TRACKS.map((tr) => (
            <div className={`rle__lane rle__lane--${tr.key}`} key={tr.key}>
              <span className="rle__lane-label">{tr.label}</span>
              <div className="rle__lane-track">
                {itemsOf(spec, tr.key).map((it, i) => {
                  const left = (it.start / Math.max(1, duration)) * 100;
                  const w = Math.max(0.6, ((it.end - it.start) / Math.max(1, duration)) * 100);
                  const isSel = sel && sel.track === tr.key && sel.index === i;
                  return (
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                    <div
                      key={i}
                      className={`rle__block${isSel ? ' is-sel' : ''}`}
                      style={{ left: `${left}%`, width: `${w}%` }}
                      onPointerDown={(e) => onBlockPointerDown(e, tr.key, i, 'move')}
                      onClick={() => seek(it.start)}
                      title={blockLabel(tr.key, it)}
                    >
                      <span className="rle__handle rle__handle--l" onPointerDown={(e) => onBlockPointerDown(e, tr.key, i, 'l')} />
                      <span className="rle__block-txt">{blockLabel(tr.key, it)}</span>
                      <span className="rle__handle rle__handle--r" onPointerDown={(e) => onBlockPointerDown(e, tr.key, i, 'r')} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── inspector ──────────────────────────────────────────────────────────────
function Row({ label, children }) {
  return (
    <label className="rle-field">
      <span className="rle-field__label">{label}</span>
      {children}
    </label>
  );
}

function TimeRow({ item, onPatch, onSeek, duration }) {
  return (
    <div className="rle-field-row">
      <Row label="Start (s)">
        <input
          type="number" step="0.1" min="0" max={duration}
          value={item.start}
          onChange={(e) => { const v = clamp(Number(e.target.value) || 0, 0, item.end - 0.3); onPatch({ start: round2(v) }); onSeek(v); }}
        />
      </Row>
      <Row label="End (s)">
        <input
          type="number" step="0.1" min="0" max={duration}
          value={item.end}
          onChange={(e) => { const v = clamp(Number(e.target.value) || 0, item.start + 0.3, duration); onPatch({ end: round2(v) }); }}
        />
      </Row>
    </div>
  );
}

function Inspector({ track, item, captions, onPatch, onPatchCaptions, onSeek, onDelete, duration }) {
  return (
    <div className="rle-insp">
      <div className="rle-insp__head">
        <span className="rle-insp__kind">{track === 'animations' ? item.type : track.slice(0, -1)}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onDelete}><Icon name="trash" size={12} /></button>
      </div>

      {track === 'captions' && (
        <>
          <Row label="Text">
            <textarea rows={2} value={item.text || ''} onChange={(e) => onPatch({ text: e.target.value })} />
          </Row>
          <Row label="Emphasis words (comma-separated)">
            <input
              type="text"
              value={(item.emphasis || []).join(', ')}
              onChange={(e) => onPatch({ emphasis: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            />
          </Row>
          <div className="rle-field-row">
            <Row label="Style">
              <select value={captions?.style || 'boxed'} onChange={(e) => onPatchCaptions({ style: e.target.value })}>
                {CAP_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Row>
            <Row label="Position">
              <select value={captions?.position || 'bottom'} onChange={(e) => onPatchCaptions({ position: e.target.value })}>
                {CAP_POS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Row>
          </div>
        </>
      )}

      {track === 'animations' && (
        <>
          <Row label="Type">
            <select value={item.type} onChange={(e) => onPatch({ type: e.target.value })}>
              {ANIM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Row>
          {TEXT_TYPES.has(item.type) && (
            <Row label="Text"><input type="text" value={item.text || ''} onChange={(e) => onPatch({ text: e.target.value })} /></Row>
          )}
          {item.type === 'emoji' && (
            <Row label="Emoji"><input type="text" value={item.emoji || ''} onChange={(e) => onPatch({ emoji: e.target.value })} /></Row>
          )}
          {item.type !== 'progress' && item.type !== 'zoom' && (
            <div className="rle-field-row">
              <Row label={`X · ${Math.round(item.position?.x ?? 50)}%`}>
                <input type="range" min="0" max="100" value={item.position?.x ?? 50}
                  onChange={(e) => onPatch({ position: { ...(item.position || {}), x: Number(e.target.value) } })} />
              </Row>
              <Row label={`Y · ${Math.round(item.position?.y ?? 50)}%`}>
                <input type="range" min="0" max="100" value={item.position?.y ?? 50}
                  onChange={(e) => onPatch({ position: { ...(item.position || {}), y: Number(e.target.value) } })} />
              </Row>
            </div>
          )}
          <div className="rle-field-row">
            <Row label="Motion">
              <select value={item.motion || 'pop'} onChange={(e) => onPatch({ motion: e.target.value })}>
                {MOTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Row>
            <Row label="Emphasis">
              <input type="checkbox" checked={!!item.emphasis} onChange={(e) => onPatch({ emphasis: e.target.checked })} />
            </Row>
          </div>
        </>
      )}

      {track === 'sections' && (
        <>
          <Row label="Eyebrow"><input type="text" value={item.eyebrow || ''} onChange={(e) => onPatch({ eyebrow: e.target.value.toUpperCase() })} /></Row>
          <Row label="Headline"><input type="text" value={item.headline || ''} onChange={(e) => onPatch({ headline: e.target.value })} /></Row>
          <Row label="Chips (comma-separated)">
            <input type="text" value={(item.chips || []).join(', ')}
              onChange={(e) => onPatch({ chips: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6) })} />
          </Row>
        </>
      )}

      <TimeRow item={item} onPatch={onPatch} onSeek={onSeek} duration={duration} />
    </div>
  );
}
