import React, { useRef, useState } from 'react';
import PodcastCutPreview from './PodcastCutPreview';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export default function PodcastEditView({ assets, plan, edits, onChange, aspectRatio, primaryAudioSource, onExit, onExport, busy }) {
  const [selected, setSelected] = useState(null), [history, setHistory] = useState([]);
  const [time, setTime] = useState(0), [seekRequest, setSeekRequest] = useState(null);
  const [filter, setFilter] = useState('');
  const latest = useRef(edits); latest.current = edits;
  const drag = useRef(null);
  const duration = plan.durationSec;
  const [type, index] = selected?.split(':') || [];
  const item = type ? edits[type]?.[Number(index)] : null;
  const remember = () => setHistory(h => [...h.slice(-29), structuredClone(latest.current)]);
  function change(next, record = true) { if (record) remember(); latest.current = next; onChange(next); }
  function patch(values) { const next = structuredClone(edits); Object.assign(next[type][index], values); change(next); }
  function select(key) {
    setSelected(key); const [track, i] = key.split(':'); const event = edits[track][i];
    setSeekRequest({ time: clamp(event.start + Math.min(.25, (event.end - event.start) / 2), 0, duration) });
  }
  function add(track) {
    const next = structuredClone(edits), start = Math.min(time, Math.max(0, duration - .5));
    next[track].push({ text: 'Your text', start, end: Math.min(duration, start + 3), motion: track === 'captions' ? 'fade' : 'slide' });
    change(next); setSelected(`${track}:${next[track].length - 1}`); setSeekRequest({ time: start + Math.min(.2, (duration - start) / 2) });
  }
  const invalid = [...edits.captions, ...edits.overlays].some(e => !e.text.trim() || e.end <= e.start || e.end > duration || e.start < 0);
  const width = aspectRatio === '9:16' ? 720 : 1280;
  const overlays = now => ['captions', 'overlays'].flatMap(track => edits[track].map((event, i) => {
    if (now < event.start || now >= event.end) return null;
    const key = `${track}:${i}`, caption = track === 'captions';
    const p = event.position || { x: 50, y: caption ? 78 : 20 };
    const motion = event.motion || (caption ? 'fade' : 'slide');
    const fade = caption ? .06 : .18;
    const opacity = motion === 'none' ? 1 : Math.min(1, (now - event.start) / fade, (event.end - now) / fade);
    const offset = motion === 'slide' ? 12 * Math.max(0, 1 - (now - event.start) / .18) / (aspectRatio === '9:16' ? 1280 : 720) * 100 : 0;
    return <button key={key} type="button" data-podcast-text={key} aria-label={`Edit ${caption ? 'caption' : 'overlay'}: ${event.text}`}
      className={`podcast-edit-text ${caption ? 'is-caption' : 'is-overlay'} ${selected === key ? 'is-selected' : ''}`}
      style={{ left: `${p.x}%`, top: `${p.y + offset}%`, opacity: Math.max(0, opacity), transform: caption ? 'translate(-50%, -100%)' : 'translate(-50%, 0)', fontSize: `${(event.fontSize || (aspectRatio === '9:16' ? 32 : 34) + (caption ? 0 : 4)) / width * 100}cqw` }}
      onClick={() => setSelected(key)}
      onPointerDown={e => { e.preventDefault(); setSelected(key); setSeekRequest({ time: now }); remember(); const rect = e.currentTarget.closest('.podcast-cut-screen').getBoundingClientRect(); drag.current = { key, x: e.clientX, y: e.clientY, position: p, rect }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const d = drag.current; if (!d) return; const next = structuredClone(latest.current), [t, n] = d.key.split(':'); next[t][n].position = { x: clamp(d.position.x + (e.clientX - d.x) / d.rect.width * 100, 5, 95), y: clamp(d.position.y + (e.clientY - d.y) / d.rect.height * 100, 5, 95) }; change(next, false); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>{event.text}</button>;
  }));
  return <section className="podcast-editor" aria-label="Podcast edit mode">
    <div className="podcast-edit-toolbar"><div><h2>Edit podcast</h2><p>Choose text to edit, or drag it in the preview. Changes save automatically.</p></div><button type="button" onClick={onExit}>Done</button></div>
    <fieldset disabled={busy} className="podcast-edit-fields">
      <label>Episode title<input value={edits.title} maxLength={120} onChange={e => change({ ...edits, title: e.target.value })} /></label>
      <div className="podcast-edit-layout"><PodcastCutPreview assets={assets} plan={plan} layout="side-by-side" simple primaryAudioSource={primaryAudioSource} aspectRatio={aspectRatio} overlayRenderer={overlays} onTimeChange={setTime} seekRequest={seekRequest} />
      <div className="podcast-edit-inspector"><div className="podcast-edit-toolbar"><button type="button" onClick={() => add('captions')} disabled={edits.captions.length >= 3000}>Add caption</button><button type="button" onClick={() => add('overlays')} disabled={edits.overlays.length >= 50}>Add overlay</button><button type="button" disabled={!history.length} onClick={() => { onChange(history.at(-1)); setHistory(h => h.slice(0, -1)); setSelected(null); }}>Undo</button></div>
      {item && <div className="podcast-edit-properties">
        <label>Text<textarea aria-label="Text" rows={3} value={item.text} maxLength={180} onChange={e => patch({ text: e.target.value })} /></label>
        <div className="podcast-fields"><label>Start (sec)<input type="number" step="0.01" min="0" max={duration} value={item.start} onChange={e => patch({ start: Number(e.target.value) })} /></label><label>End (sec)<input type="number" step="0.01" min="0" max={duration} value={item.end} onChange={e => patch({ end: Number(e.target.value) })} /></label></div>
        <div className="podcast-fields"><label>Text size<input type="number" min="16" max="80" value={item.fontSize || (aspectRatio === '9:16' ? 32 : 34) + (type === 'captions' ? 0 : 4)} onChange={e => patch({ fontSize: clamp(Number(e.target.value), 16, 80) })} /></label><label>Animation<select aria-label="Animation" value={item.motion || (type === 'captions' ? 'fade' : 'slide')} onChange={e => patch({ motion: e.target.value })}><option value="none">None</option><option value="fade">Fade</option><option value="slide">Slide in</option></select></label></div>
        <div className="podcast-edit-toolbar">{[['Top', 20], ['Middle', 50], ['Bottom', 78]].map(([label, y]) => <button type="button" key={label} onClick={() => patch({ position: { x: 50, y } })}>{label}</button>)}<button type="button" onClick={() => { const next = structuredClone(edits); next[type].splice(Number(index), 1); change(next); setSelected(null); }}>Delete text</button></div>
      </div>}
      <label>Find text<input value={filter} onChange={e => setFilter(e.target.value)} /></label>
      <div className="podcast-edit-list">{['captions', 'overlays'].flatMap(track => edits[track].map((event, i) => event.text.toLowerCase().includes(filter.toLowerCase()) && <button type="button" key={`${track}:${i}`} aria-pressed={selected === `${track}:${i}`} onClick={() => select(`${track}:${i}`)}><b>{track === 'captions' ? 'Caption' : 'Overlay'} · {event.start.toFixed(2)}–{event.end.toFixed(2)}s</b><span>{event.text}</span></button>))}</div>
      </div></div>
      {invalid && <p role="alert">Each text item needs text and an end time after its start, within the episode.</p>}
      <button type="button" className="podcast-primary" disabled={invalid || busy} onClick={onExport}>Export edited MP4</button><p className="podcast-muted">Re-renders your saved source videos with these edits. Speech and editorial agents do not run again. Brand Kit and audio cleanup are applied during export.</p>
    </fieldset>
  </section>;
}
