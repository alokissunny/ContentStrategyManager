/*
 * Select images — the Visual Library sheet, carrying picture places instead
 * of shapes (bauhly-v3 YourWeek `ImagePicker`, §821/§890).
 *
 * Two columns from the tablet up: the project's photographs on the left, the
 * composition being filled on the right. Apply writes nothing until it is
 * pressed; closing leaves the slide as it was.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon';
import { Preview } from '../visuallibrary/LayoutArt';
import { useBodyScrollLock } from '../visualbrand/useBodyScrollLock';

function LayoutSlots({ layout, slots, at, onAt }) {
  const wrap = useRef(null);
  const from = useRef(null);
  useLayoutEffect(() => {
    const nodes = [...(wrap.current?.querySelectorAll('.vl-ph') || [])];
    nodes.forEach((n, i) => {
      n.dataset.slot = String(i + 1);
      n.classList.toggle('is-at', i === at);
      n.classList.toggle('is-taken', Boolean(slots[i]));
    });
  });
  if (!layout) return null;
  const n = Math.max(slots.length, layout.imgs?.length || 0);
  const imgs = Array.from({ length: n }, (_, i) => slots[i] || null);
  return (
    <div
      className="wv-imgs__lay"
      ref={wrap}
      onPointerDown={(e) => { from.current = { x: e.clientX, y: e.clientY }; }}
      onClick={(e) => {
        const ph = e.target.closest('.vl-ph');
        if (!ph || !wrap.current) return;
        const start = from.current;
        from.current = null;
        if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) return;
        const i = [...wrap.current.querySelectorAll('.vl-ph')].indexOf(ph);
        if (i >= 0) onAt(i);
      }}
    >
      <Preview l={{ ...layout, imgs }} mood />
    </div>
  );
}

function Pic({ url, thumb, on, onClick }) {
  return (
    <li>
      <button
        type="button"
        className={`wv-imgs__pic${on ? ' is-on' : ''}`}
        onClick={onClick}
        aria-pressed={on}
        aria-label={on ? 'Selected — press to remove' : 'Use this photo'}
      >
        <img src={thumb || url} alt="" loading="lazy" />
        {on && (
          <span className="wv-imgs__tick">
            <Icon name="check" size={13} strokeWidth={3} />
          </span>
        )}
      </button>
    </li>
  );
}

export default function ImagePicker({
  layout,
  need,
  slots,
  at,
  pool,
  suggested,
  uploading,
  hold,
  paint,
  onAt,
  onPut,
  onUpload,
  onGenerate,
  onApply,
  onClose,
}) {
  useBodyScrollLock();
  const filled = slots.filter(Boolean).length;
  const chosen = slots.filter(Boolean);
  const fileRef = useRef(null);
  const list = useRef(null);
  const suggestKeys = new Set(suggested.map((img) => img.url));
  const rest = pool.filter((img) => img.url && !suggestKeys.has(img.url));
  const isOn = (url) => chosen.includes(url);
  const single = need === 1;

  useEffect(() => {
    if (hold) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hold]);

  return createPortal(
    <>
      <div className="wv-vlib__scrim" onClick={onClose} />
      <div
        className="wv-vlib wv-vlib--imgs"
        style={paint}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wv-imgs-t"
      >
        <div className="wv-imgs__top">
          <h1 className="wv-imgs__title" id="wv-imgs-t">Select images</h1>
          <button type="button" className="vl-pickhead__x" onClick={onClose} aria-label="Close" title="Close">
            <Icon name="x" size={17} strokeWidth={2} />
          </button>
        </div>

        <div className="wv-vlib__body wv-imgs">
          <div className="wv-imgs__body">
            <div
              className="wv-imgs__ctx"
              onWheel={(e) => {
                const el = list.current;
                if (el) el.scrollTop += e.deltaY;
              }}
            >
              <div className="wv-imgs__ctxin">
                <p className="wv-imgs__head wv-imgs__prevtitle">
                  <span className="wv-imgs__headline">Preview</span>
                </p>
                {!single && (
                  <p className="wv-imgs__prevhead">
                    <span className="wv-imgs__hint">
                      <Icon name="arrow-up" size={12} strokeWidth={2.5} />
                      Choose a slot to add an image
                    </span>
                  </p>
                )}
                <LayoutSlots layout={layout} slots={slots} at={at} onAt={onAt} />
              </div>
            </div>

            <div className="wv-imgs__scroll" ref={list}>
              {suggested.length > 0 && (
                <section className="wv-imgs__sect">
                  <p className="wv-imgs__head">
                    <span className="wv-imgs__headline">
                      Bauhly suggests for this slot <span>({suggested.length})</span>
                    </span>
                  </p>
                  <ul className="wv-imgs__grid">
                    {suggested.map((img) => (
                      <Pic
                        key={img.key || img.url}
                        url={img.url}
                        thumb={img.thumb}
                        on={isOn(img.url)}
                        onClick={() => onPut(img.url)}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {rest.length > 0 && (
                <section className="wv-imgs__sect">
                  <p className="wv-imgs__head">
                    <span className="wv-imgs__headline">
                      {suggested.length ? 'Everything else in this project' : 'This project’s photos'}
                      <span>({rest.length})</span>
                    </span>
                  </p>
                  <ul className="wv-imgs__grid">
                    {rest.map((img) => (
                      <Pic
                        key={img.key || img.url}
                        url={img.url}
                        thumb={img.thumb}
                        on={isOn(img.url)}
                        onClick={() => onPut(img.url)}
                      />
                    ))}
                  </ul>
                </section>
              )}
              {!suggested.length && !rest.length && (
                <p className="wv-imgs__empty">
                  Add photos in Projects, then pick them here — or upload / generate one below.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="wv-vlib__foot wv-imgs__foot">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            disabled={uploading}
            onChange={(e) => { onUpload(e.target.files || []); e.target.value = ''; }}
          />
          <div className="wv-imgs__ways">
            <button type="button" className="btn btn--tertiary" onClick={onGenerate}>
              Generate image
            </button>
            <button
              type="button"
              className="btn btn--tertiary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
          </div>
          <button
            type="button"
            className="btn btn--primary wv-imgs__apply"
            onClick={onApply}
            disabled={!filled}
            title={!filled ? 'Choose a picture first' : undefined}
          >
            Apply {filled} of {need}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
