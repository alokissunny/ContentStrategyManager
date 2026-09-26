import React, { useEffect, useRef, useState } from 'react';
import { PHONE_STYLE, fmtTime, TITLE_END } from './reelOverlay';
import { promptEditReel } from '../../api/reels';
import ReelScene from './ReelScene';
import './reelEditView.css';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const list = (s, t) => t === 'captions' ? s.captions?.cues : s[t];
const get = (s, key) => { const [t, i] = key.split(':'); return ['strategy', 'brand'].includes(t) ? s[t] : list(s, t)?.[+i]; };
function texts(s) {
  const rows = [];
  if (s.strategy?.hook) rows.push({ key: 'strategy:0', text: s.strategy.hook, start: 0, end: TITLE_END });
  if (s.brand?.name && !s.brandKit) rows.push({ key: 'brand:0', text: s.brand.name, start: 0, end: s.meta.durationSec });
  for (const t of ['captions', 'animations', 'sections']) (list(s, t) || []).forEach((v, i) => {
    if (t === 'animations' && !['callout', 'cta', 'lower-third', 'label', 'emoji'].includes(v.type)) return;
    rows.push({ key: `${t}:${i}`, text: v.text || v.emoji || v.chips?.join(' · ') || v.headline || v.eyebrow || 'Text', start: v.start, end: v.end });
  });
  return rows.sort((a, b) => a.start - b.start);
}
export default function ReelEditView({ videoUrl, spec, onChange, onExit }) {
  const video = useRef(null), screen = useRef(null), drag = useRef(null), latest = useRef(spec);
  latest.current = spec;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [prompt, setPrompt] = useState(''), [applying, setApplying] = useState(false), [reply, setReply] = useState(''), [promptError, setPromptError] = useState('');
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [selected, setSelected] = useState(null), [history, setHistory] = useState([]);
  const duration = spec.meta?.durationSec || 0, rows = texts(spec), item = selected ? get(spec, selected) : null, track = selected?.split(':')[0];
  useEffect(() => {
    if (!playing) return;
    let frame;
    const tick = () => { setTime(video.current?.currentTime || 0); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const remember = () => setHistory((h) => [...h.slice(-29), structuredClone(latest.current)]);
  const change = (next, save = true) => { if (save) remember(); latest.current = next; onChange(next); };
  const applyPrompt = async (event) => {
    event.preventDefault();
    if (!prompt.trim() || applying) return;
    pause(); setApplying(true); setReply(''); setPromptError('');
    const snapshot = JSON.stringify(latest.current);
    try {
      const assets = [...(spec.sourceVisualAssets || []), ...(spec.visualAssets || [])].map(({ id, name, kind, duration }) => ({ id, name, kind, duration }));
      const result = await promptEditReel({ spec: latest.current, prompt: prompt.trim(), time, selected, assets });
      if (!mounted.current) return;
      if (JSON.stringify(latest.current) !== snapshot) throw new Error('Your reel changed while this request was running. Please try again.');
      if (result.changed) { change(result.spec); setSelected(null); }
      setReply(result.summary); setPrompt('');
    } catch (error) { setPromptError(error.response?.data?.message || error.message || 'Could not apply this edit. Please try again.'); }
    finally { setApplying(false); }
  };
  const patch = (p) => { const next = structuredClone(spec); Object.assign(get(next, selected), p); change(next); };
  const pause = () => { video.current?.pause(); setPlaying(false); };
  const seek = (t) => { t = clamp(t, 0, duration); if (video.current) video.current.currentTime = t; setTime(t); };
  const select = (key) => { pause(); setSelected(key); const r = rows.find((r) => r.key === key); if (r && (time < r.start || time >= r.end)) seek(Math.min(r.end - .01, r.start + .4)); };
  const remove = () => { const next = structuredClone(spec); if (track === 'strategy') next.strategy.hook = ''; else if (track === 'brand') next.brand.name = ''; else list(next, track).splice(+selected.split(':')[1], 1); change(next); setSelected(null); };
  const add = () => { pause(); const next = structuredClone(spec); next.animations ||= []; const start = Math.max(0, Math.min(time, duration - 1)); setSelected(`animations:${next.animations.length}`); next.animations.push({ type: 'callout', text: 'Your text', start, end: Math.min(duration, start + 3), position: { x: 50, y: 50 }, motion: 'fade' }); change(next); seek(start + .4); };
  const down = (e) => { const el = e.target.closest('[data-reel-text]'); if (!el) return; e.preventDefault(); pause(); const key = el.dataset.reelText; setSelected(key); remember(); const r = el.getBoundingClientRect(), s = screen.current.getBoundingClientRect(), p = get(spec, key)?.position; drag.current = { key, x: e.clientX, y: e.clientY, s, p: p && typeof p === 'object' ? p : { x: (r.left + r.width / 2 - s.left) / s.width * 100, y: (r.top + r.height / 2 - s.top) / s.height * 100 } }; screen.current.setPointerCapture(e.pointerId); };
  const move = (e) => { const d = drag.current; if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return; const next = structuredClone(latest.current); get(next, d.key).position = { x: clamp(d.p.x + (e.clientX - d.x) / d.s.width * 100, 10, 90), y: clamp(d.p.y + (e.clientY - d.y) / d.s.height * 100, 8, 92) }; change(next, false); };
  const field = (label, prop) => <label className="rle-field"><span>{label}</span><textarea rows={2} value={item[prop] || ''} onChange={(e) => patch({ [prop]: e.target.value })} /></label>;
  return <div className="rle rle--simple">
    <form className="rle__prompt" onSubmit={applyPrompt} aria-busy={applying}>
      <label className="rle-field"><span>Edit with a prompt</span><textarea value={prompt} disabled={applying} maxLength={2000} onChange={(e) => setPrompt(e.target.value)} placeholder={'Try “At 12 seconds, add a bouncing callout saying Big idea for 3 seconds”'} rows={2} /></label>
      <div className="rle__prompt-actions"><span className="reel-field__hint">“Here” means {fmtTime(time)}. Changes appear in the preview and can be undone.</span><button className="btn btn--primary" disabled={applying || !prompt.trim()}>{applying ? 'Applying edit…' : 'Apply edit'}</button></div>
      {reply && <p role="status">{reply}</p>}{promptError && <p className="reel-err" role="alert">{promptError}</p>}
      <p className="reel-field__hint">Request an uploaded photo/video, or describe a scene to create an AI image. Image creation may take a minute. Visual overlays are included when you export the reel.</p>
    </form>
    <fieldset className="rle__edit-controls" disabled={applying}>
    {(spec.mediaOverlays || []).length > 0 && <div className="rle__text-list" aria-label="Visual overlays">{spec.mediaOverlays.map((o, index) => <div className="rle__text-item" key={index}><button className="btn btn--ghost" onClick={() => { pause(); seek(o.start + .05); }}>{[...(spec.visualAssets || []), ...(spec.sourceVisualAssets || [])].find((a) => a.id === o.assetId)?.name || 'Visual'} · {fmtTime(o.start)}–{fmtTime(o.end)}</button><button className="btn btn--ghost" onClick={() => { const next = structuredClone(spec); next.mediaOverlays.splice(index, 1); change(next); }}>Remove visual</button></div>)}</div>}
    <div className="rle__toolbar"><div className="rle__spacer"><h2>Edit text</h2><p>Tap text to edit. Drag it to move.</p></div><button className="btn btn--primary" onClick={onExit}>Done</button></div>
    <div className="rle__top">
      <div className="rle__stage"><div className="reel-phone" style={PHONE_STYLE}><ReelScene screenRef={screen} className="rle__canvas" videoRef={video} videoUrl={videoUrl} spec={spec} time={time} playing={playing}
        onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        videoProps={{ onTimeUpdate: (e) => setTime(e.currentTarget.currentTime), onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => setPlaying(false) }} /></div><div className="rle__playback"><button className="btn btn--ghost" onClick={() => playing ? pause() : video.current?.play().catch(() => setPlaying(false))}>{playing ? 'Pause' : 'Play'}</button><input aria-label="Preview position" type="range" min="0" max={duration} step=".01" value={time} onChange={(e) => { pause(); seek(+e.target.value); }} /><span>{fmtTime(time)} / {fmtTime(duration)}</span></div><p className="reel-field__hint">Changes save automatically.</p></div>
      <div className="rle__inspector"><div className="rle__toolbar"><button className="btn btn--ghost" onClick={add}>+ Add text</button><button className="btn btn--ghost" disabled={!history.length} onClick={() => { onChange(history.at(-1)); setHistory((h) => h.slice(0, -1)); setSelected(null); }}>Undo</button></div>
        {item ? <div className="rle-insp rle__form">{track === 'strategy' ? <>{field('Text', 'hook')}{field('Small heading', 'hookEyebrow')}</> : track === 'brand' ? <>{field('Text', 'name')}{field('Tagline', 'tag')}</> : track === 'sections' ? <>{field('Text', 'headline')}{field('Small heading', 'eyebrow')}<label className="rle-field"><span>Labels (one per line)</span><textarea value={(item.chips || []).join('\n')} onChange={(e) => patch({ chips: e.target.value.split('\n').filter(Boolean) })} /></label></> : field('Text', item.type === 'emoji' ? 'emoji' : 'text')}
          <div className="rle__positions">{[['Top', 23], ['Middle', 50], ['Bottom', 78]].map(([label, y]) => <button className="btn btn--ghost" key={label} onClick={() => patch({ position: { x: 50, y } })}>{label}</button>)}</div><p className="reel-field__hint">Or drag the text on the video.</p>
          {!['strategy', 'brand'].includes(track) && <details><summary>When it appears</summary><div className="rle-field-row"><label className="rle-field">From (seconds)<input type="number" step=".1" value={item.start} min="0" max={item.end - .1} onChange={(e) => { const start = clamp(+e.target.value, 0, item.end - .1); patch({ start }); seek(start + .05); }} /></label><label className="rle-field">Until (seconds)<input type="number" step=".1" value={item.end} min={item.start + .1} max={duration} onChange={(e) => patch({ end: clamp(+e.target.value, item.start + .1, duration) })} /></label></div></details>}
          <button className="btn btn--ghost rle__delete" onClick={remove}>Delete text</button></div> : <p className="reel-field__hint rle__form">Choose text on the video or from the list below.</p>}
        <div className="rle__text-list" aria-label="Text in this reel">{rows.map((r) => <button key={r.key} className="rle__text-item" aria-pressed={selected === r.key} onClick={() => select(r.key)}><span>{r.text}</span><small>{fmtTime(r.start)}</small></button>)}{!rows.length && <p>No text yet. Add your first line above.</p>}</div>
      </div>
    </div>
    </fieldset>
  </div>;
}
