/*
 * Photo editor — crop · adjust · replace · download (bauhly-v3 PhotoEditor).
 * Opened from Week View's Edit image: a slot's measured shape frames the crop
 * when one is passed, otherwise the studio picks an aspect.
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import { useBodyScrollLock } from '../visualbrand/useBodyScrollLock';

const ED_ASPECTS = [['original', 'Original'], ['1', 'Square'], ['4:5', '4:5'], ['16:9', '16:9'], ['3:2', '3:2']];
const ED_SLIDERS = [
  ['brightness', 'Brightness', 50, 150, 100, 'sun'],
  ['contrast', 'Contrast', 50, 150, 100, 'contrast'],
  ['warmth', 'Warmth', 0, 100, 0, 'thermometer'],
];

export function PhotoEditor({ src, slot = null, onCancel, onDone, onReplace, onDownload }) {
  const [tab, setTab] = useState(slot ? 'crop' : 'adjust');
  const [active, setActive] = useState('brightness');
  const [adj, setAdj] = useState({ brightness: 100, contrast: 100, saturate: 100, warmth: 0 });
  const [aspect, setAspect] = useState('original');
  const [frame, setFrame] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const imgRef = useRef(null);
  const drag = useRef(null);
  const filter = `brightness(${adj.brightness}%) contrast(${adj.contrast}%) saturate(${adj.saturate}%) sepia(${adj.warmth / 100})`;

  useBodyScrollLock();

  useEffect(() => { setReady(false); }, [src]);
  useEffect(() => {
    if (imgRef.current?.complete) setReady(true);
  }, [src]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !ready || (aspect === 'original' && !slot)) { setFrame({ x: 0, y: 0, w: 1, h: 1 }); return; }
    const [rw, rh] = slot ? [slot.ratio, 1] : (aspect === '1' ? [1, 1] : aspect.split(':').map(Number));
    const r = rw / rh;
    const R = img.clientWidth / img.clientHeight;
    const w = r >= R ? 1 : r / R;
    const h = r >= R ? R / r : 1;
    setFrame({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  }, [aspect, slot, ready]);

  const onPointerDown = (e) => {
    e.preventDefault();
    const img = imgRef.current;
    drag.current = { sx: e.clientX, sy: e.clientY, fx: frame.x, fy: frame.y, w: img.clientWidth, h: img.clientHeight };
    const move = (ev) => {
      const d = drag.current; if (!d) return;
      const dx = (ev.clientX - d.sx) / d.w;
      const dy = (ev.clientY - d.sy) / d.h;
      setFrame((f) => ({ ...f, x: Math.min(Math.max(0, d.fx + dx), 1 - f.w), y: Math.min(Math.max(0, d.fy + dy), 1 - f.h) }));
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const apply = async () => {
    setBusy(true);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      await img.decode();
      const nW = img.naturalWidth, nH = img.naturalHeight;
      const sw = Math.max(1, Math.round(frame.w * nW));
      const sh = Math.max(1, Math.round(frame.h * nH));
      const canvas = document.createElement('canvas');
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext('2d');
      ctx.filter = filter;
      ctx.drawImage(img, frame.x * nW, frame.y * nH, frame.w * nW, frame.h * nH, 0, 0, sw, sh);
      canvas.toBlob((b) => { onDone(URL.createObjectURL(b)); }, 'image/jpeg', 0.92);
    } catch {
      setBusy(false);
      onCancel();
    }
  };

  return (
    <div className="ed" role="dialog" aria-modal="true" aria-label="Edit photo">
      <div className="ed__bar">
        <button type="button" className="btn btn--quiet btn--sm" onClick={onCancel}>Cancel</button>
        <div className="ed__quick">
          <label className="ed__icon" title="Replace photo">
            <Icon name="refresh" size={18} />
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && onReplace(e.target.files[0])} />
          </label>
          <button type="button" className="ed__icon" title="Download" onClick={onDownload}><Icon name="download" size={18} /></button>
        </div>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={apply}>Done</button>
      </div>

      <div className="ed__stage">
        <div className="ed__imgwrap">
          <img ref={imgRef} src={src} alt="" style={{ filter }} draggable={false} onLoad={() => setReady(true)} />
          {tab === 'crop' && (
            <div
              className={`ed__frame ${slot ? 'ed__frame--slot' : ''}`}
              style={{
                left: `${frame.x * 100}%`,
                top: `${frame.y * 100}%`,
                width: `${frame.w * 100}%`,
                height: `${frame.h * 100}%`,
                ...(slot?.radius ? { borderRadius: slot.radius } : null),
              }}
              onPointerDown={onPointerDown}
            />
          )}
        </div>
      </div>

      {tab === 'adjust' ? (
        (() => {
          const [key, label, min, max, neutral] = ED_SLIDERS.find((s) => s[0] === active);
          const val = adj[active];
          const pct = (v) => ((v - min) / (max - min)) * 100;
          const from = Math.min(pct(neutral), pct(val));
          const to = Math.max(pct(neutral), pct(val));
          return (
            <div className="ed__panel">
              <div className="ed__readout">
                <span className="ed__paramlabel">{label}</span>
                <b className={`ed__value ${val === neutral ? 'is-neutral' : ''}`}>
                  {key === 'warmth' ? val : val - 100 > 0 ? `+${val - 100}` : val - 100}
                </b>
              </div>
              <div className="ed__rangewrap" style={{ '--from': `${from}%`, '--to': `${to}%` }}>
                <span className="ed__ticks" aria-hidden="true" />
                <span className="ed__fill" aria-hidden="true" />
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={val}
                  aria-label={label}
                  onChange={(e) => setAdj((a) => ({ ...a, [active]: +e.target.value }))}
                  onDoubleClick={() => setAdj((a) => ({ ...a, [active]: neutral }))}
                />
              </div>
              <div className="ed__params">
                {ED_SLIDERS.map(([k, l, , , n, icon]) => (
                  <button
                    key={k}
                    type="button"
                    className={`ed__param ${active === k ? 'is-on' : ''} ${adj[k] !== n ? 'is-touched' : ''}`}
                    aria-label={l}
                    aria-pressed={active === k}
                    onClick={() => setActive(k)}
                  >
                    <Icon name={icon} size={19} strokeWidth={2} />
                    <span>{l}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })()
      ) : (
        <div className="ed__aspects">
          {slot ? (
            <span className="ed__slotnote">
              Framed to {slot.name ? `the ${slot.name} slot` : 'this layout’s picture area'}
            </span>
          ) : ED_ASPECTS.map(([k, l]) => (
            <button key={k} type="button" className={aspect === k ? 'is-on' : ''} onClick={() => setAspect(k)}>{l}</button>
          ))}
        </div>
      )}

      <div className="ed__tabs">
        <button type="button" className={tab === 'adjust' ? 'is-on' : ''} onClick={() => setTab('adjust')}><Icon name="dial" size={20} /> Adjust</button>
        <button type="button" className={tab === 'crop' ? 'is-on' : ''} onClick={() => setTab('crop')}><Icon name="crop" size={20} /> Crop</button>
      </div>
    </div>
  );
}

/* Multi-place layouts open this set first (bauhly-v3 §982/§984): pick which
 * photograph to edit, then the editor opens on that place's measured shape. */
export function SlotPack({ items, onPick, onClose }) {
  useBodyScrollLock();
  return (
    <>
      <div className="wv-pack__scrim" onClick={onClose} />
      <aside className="wv-pack" role="dialog" aria-modal="true" aria-label="Select image">
        <header className="wv-pack__bar">
          <span className="wv-pack__title">Select image</span>
          <button type="button" className="wv-pack__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} strokeWidth={2.25} />
          </button>
        </header>
        <div className="wv-pack__body">
          <div className="wv-pack__grid">
            {items.map((item) => (
              <button
                key={item.i}
                type="button"
                className="wv-pack__cell"
                onClick={() => onPick(item.i, item.url)}
                aria-label={`Edit image ${item.i + 1} of ${items.length}`}
              >
                <span className="wv-pack__media">
                  <img src={item.url} alt="" />
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
