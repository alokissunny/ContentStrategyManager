/*
 * The floating text panel on a Theme Apply render — ported from bauhly-v3
 * `src/pages/app/editor/ShotSpots.jsx` (the `.shotask` panel, Oct 1–2).
 *
 * A themed slide is one picture, so a text block can't be styled in place:
 * the panel collects what the studio wants (new words, bold / italic /
 * underline / strike, a colour, a highlight, an alignment, or removing the
 * text) and Apply sends it as ONE region redraw (`action: 'text'` on
 * /theme-region). Marks apply to the words selected in the field, or to the
 * whole text when nothing is selected — except alignment, which is always the
 * whole block.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';

export const TEXT_FORMS = [
  { id: 'bold', label: 'Bold', icon: 'format-bold', what: 'bold' },
  { id: 'italic', label: 'Italic', icon: 'format-italic', what: 'italic' },
  { id: 'underline', label: 'Underline', icon: 'format-underline', what: 'underlined' },
  { id: 'strike', label: 'Strikethrough', icon: 'format-strike', what: 'struck through' },
];
const TEXT_INKS = [
  { id: 'ink', label: 'Ink', key: 'ink' },
  { id: 'accent', label: 'Accent', key: 'accent' },
  { id: 'ground', label: 'Ground', key: 'ground' },
];
const TEXT_HILITES = [
  { id: 'hl-ink', label: 'Ink', key: 'ink' },
  { id: 'hl-accent', label: 'Accent', key: 'accent' },
  { id: 'hl-ground', label: 'Ground', key: 'ground' },
];
const TEXT_ALIGNS = [
  { id: 'alignl', label: 'Align left', icon: 'align-left', what: 'aligned left' },
  { id: 'alignc', label: 'Align centre', icon: 'align-center', what: 'centred' },
  { id: 'alignr', label: 'Align right', icon: 'align-right', what: 'aligned right' },
];
// one of each of these at a time, per run of words
const GROUPS = [TEXT_INKS.map((c) => c.id), TEXT_HILITES.map((c) => c.id), TEXT_ALIGNS.map((a) => a.id)];
const groupOf = (id) => GROUPS.find((g) => g.includes(id)) || [id];

const styleOf = (ids, palette) => ({
  fontWeight: ids.includes('bold') ? 800 : undefined,
  fontStyle: ids.includes('italic') ? 'italic' : undefined,
  textDecoration: [ids.includes('underline') ? 'underline' : '', ids.includes('strike') ? 'line-through' : '']
    .filter(Boolean).join(' ') || undefined,
  color: palette?.[(TEXT_INKS.find((c) => ids.includes(c.id)) || {}).key] || undefined,
  background: palette?.[(TEXT_HILITES.find((c) => ids.includes(c.id)) || {}).key] || undefined,
});

/** What a mark asks for, in the words the redraw prompt uses. */
export function describeMark(m, palette) {
  const ink = TEXT_INKS.find((c) => c.id === m.id);
  if (ink) return `in the colour ${palette?.[ink.key] || ink.label}`;
  const hl = TEXT_HILITES.find((c) => c.id === m.id);
  if (hl) return `with a ${palette?.[hl.key] || hl.label} highlight behind the letters`;
  return (TEXT_FORMS.find((f) => f.id === m.id) || TEXT_ALIGNS.find((a) => a.id === m.id) || {}).what || m.id;
}

export default function RegionTextPanel({ region, palette = null, busy = false, err = '', onApply, onClose }) {
  const [text, setText] = useState(region.text || '');
  // [{ id, words }] — words '' = the whole text
  const [marks, setMarks] = useState([]);
  const [wipe, setWipe] = useState(false);
  const [pop, setPop] = useState(null);
  const [sel, setSel] = useState('');
  const box = useRef(null);
  const field = useRef(null);

  useEffect(() => {
    setText(region.text || '');
    setMarks([]);
    setWipe(false);
    setPop(null);
    setSel('');
  }, [region.id, region.text]);

  const touched = wipe || marks.length > 0 || text.trim() !== String(region.text || '').trim();
  const isOn = (id) => marks.some((m) => m.id === id && m.words === (groupOf(id) === GROUPS[2] ? '' : sel));
  const lineIds = marks.filter((m) => !m.words).map((m) => m.id);
  const runs = marks.filter((m) => m.words);

  const readSel = () => {
    const el = field.current;
    if (!el || typeof el.selectionStart !== 'number') return '';
    return el.value.slice(el.selectionStart, el.selectionEnd).trim();
  };
  const toggle = (id) => {
    setPop(null);
    const words = groupOf(id) === GROUPS[2] ? '' : readSel();
    setMarks((cur) => {
      if (cur.some((m) => m.id === id && m.words === words)) return cur.filter((m) => !(m.id === id && m.words === words));
      const group = groupOf(id);
      return [...cur.filter((m) => !(m.words === words && group.includes(m.id))), { id, words }];
    });
  };
  const revert = () => {
    setText(region.text || '');
    setMarks([]);
    setWipe(false);
    setPop(null);
  };
  const apply = () => {
    if (!touched || busy) return;
    onApply?.({
      text: text.trim(),
      remove: wipe,
      marks: marks.map((m) => ({ ...m, what: describeMark(m, palette) })),
    });
  };

  /* placed under the region (over it when the region sits low), centred on
     it and held inside the card */
  useLayoutEffect(() => {
    const el = box.current;
    const frame = el?.parentElement;
    if (!el || !frame) return undefined;
    const place = () => {
      const fw = frame.clientWidth;
      const fh = frame.clientHeight;
      const half = el.offsetWidth / 2;
      const pad = 8;
      const want = ((region.box.left + region.box.width / 2) / 100) * fw;
      const x = fw - 2 * pad < 2 * half ? fw / 2 : Math.min(Math.max(want, pad + half), fw - pad - half);
      el.style.left = `${Math.round(x)}px`;
      const h = el.offsetHeight;
      const below = ((region.box.top + region.box.height) / 100) * fh + 8;
      const above = (region.box.top / 100) * fh - h - 8;
      const top = below + h <= fh - pad ? below : (above >= pad ? above : Math.max(pad, fh - pad - h));
      el.style.top = `${Math.round(top)}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [region.id, region.box]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (pop) setPop(null);
      else onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pop, onClose]);

  const label = String(region.role || 'Text').replace(/^./, (c) => c.toUpperCase());
  const swatch = (list) => palette?.[(list.find((c) => isOn(c.id)) || list[0]).key];

  return (
    <div
      ref={box}
      className="wv-sa"
      role="dialog"
      aria-label={`Edit the ${label.toLowerCase()}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="wv-sa__head">
        <span className="wv-sa__what">
          {label}
          {touched && <em className="wv-sa__done">Updated</em>}
        </span>
        {touched && (
          <button type="button" className="wv-sa__x" aria-label="Revert this text" title="Revert" disabled={busy} onClick={revert}>
            <Icon name="undo" size={16} strokeWidth={2} />
          </button>
        )}
        <button type="button" className="wv-sa__x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="wv-sa__forms">
        {TEXT_FORMS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`wv-sa__btn${isOn(f.id) ? ' is-on' : ''}`}
            aria-pressed={isOn(f.id)}
            title={f.label}
            aria-label={f.label}
            disabled={busy || wipe}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle(f.id)}
          >
            <Icon name={f.icon} size={19} strokeWidth={2.3} />
          </button>
        ))}
        {palette && (
          <span className="wv-sa__wrap">
            <button
              type="button"
              className={`wv-sa__btn wv-sa__inkbtn${pop === 'ink' ? ' is-open' : ''}${TEXT_INKS.some((c) => isOn(c.id)) ? ' is-on' : ''}`}
              aria-expanded={pop === 'ink'}
              aria-label="Text colour"
              title="Colour"
              disabled={busy || wipe}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPop((v) => (v === 'ink' ? null : 'ink'))}
            >
              <i style={{ background: TEXT_INKS.some((c) => isOn(c.id)) ? swatch(TEXT_INKS) : 'transparent' }} aria-hidden="true" />
            </button>
            {pop === 'ink' && (
              <span className="wv-sa__pop" role="group" aria-label="Text colour">
                {TEXT_INKS.filter((c) => palette[c.key]).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`wv-sa__sw${isOn(c.id) ? ' is-on' : ''}`}
                    aria-pressed={isOn(c.id)}
                    title={c.label}
                    aria-label={`${c.label} colour`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(c.id)}
                  >
                    <i style={{ background: palette[c.key] }} aria-hidden="true" />
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
        {palette && (
          <span className="wv-sa__wrap">
            <button
              type="button"
              className={`wv-sa__btn wv-sa__hlbtn${pop === 'hl' ? ' is-open' : ''}${TEXT_HILITES.some((c) => isOn(c.id)) ? ' is-on' : ''}`}
              aria-expanded={pop === 'hl'}
              aria-label="Colour behind the words"
              title="Highlight"
              disabled={busy || wipe}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPop((v) => (v === 'hl' ? null : 'hl'))}
            >
              <Icon name="format-highlight" size={19} strokeWidth={2.3} />
              {TEXT_HILITES.some((c) => isOn(c.id)) && <i style={{ background: swatch(TEXT_HILITES) }} aria-hidden="true" />}
            </button>
            {pop === 'hl' && (
              <span className="wv-sa__pop" role="group" aria-label="Colour behind the words">
                {TEXT_HILITES.filter((c) => palette[c.key]).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`wv-sa__sw wv-sa__sw--hl${isOn(c.id) ? ' is-on' : ''}`}
                    aria-pressed={isOn(c.id)}
                    title={`${c.label} behind the words`}
                    aria-label={`${c.label} behind the words`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(c.id)}
                  >
                    <i style={{ background: palette[c.key] }} aria-hidden="true" />
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
        <span className="wv-sa__wrap">
          <button
            type="button"
            className={`wv-sa__btn${pop === 'aln' ? ' is-open' : ''}${TEXT_ALIGNS.some((a) => isOn(a.id)) ? ' is-on' : ''}`}
            aria-expanded={pop === 'aln'}
            aria-label="Alignment"
            title="Alignment"
            disabled={busy || wipe}
            onClick={() => setPop((v) => (v === 'aln' ? null : 'aln'))}
          >
            <Icon name={(TEXT_ALIGNS.find((a) => isOn(a.id)) || TEXT_ALIGNS[0]).icon} size={16} strokeWidth={2} />
          </button>
          {pop === 'aln' && (
            <span className="wv-sa__pop" role="group" aria-label="Alignment">
              {TEXT_ALIGNS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`wv-sa__btn${isOn(a.id) ? ' is-on' : ''}`}
                  aria-pressed={isOn(a.id)}
                  title={a.label}
                  aria-label={a.label}
                  onClick={() => toggle(a.id)}
                >
                  <Icon name={a.icon} size={17} strokeWidth={2} />
                </button>
              ))}
            </span>
          )}
        </span>
        <button
          type="button"
          className={`wv-sa__btn is-bad${wipe ? ' is-on' : ''}`}
          aria-pressed={wipe}
          title="Remove text"
          aria-label="Remove text"
          disabled={busy}
          onClick={() => { setPop(null); setWipe((v) => !v); }}
        >
          <Icon name="trash" size={16} strokeWidth={2} />
        </button>
      </div>

      <textarea
        ref={field}
        className={`wv-sa__field${wipe ? ' is-wiped' : ''}`}
        value={text}
        rows={Math.min(5, Math.max(2, Math.ceil(text.length / 38)))}
        disabled={busy || wipe}
        aria-label={`${label} text`}
        style={{
          ...styleOf(lineIds, palette),
          textAlign: lineIds.includes('alignc') ? 'center' : (lineIds.includes('alignr') ? 'right' : undefined),
        }}
        onChange={(e) => setText(e.target.value)}
        onSelect={() => setSel(readSel())}
        onBlur={() => setSel('')}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) apply(); }}
      />

      {runs.length > 0 && !wipe && (
        <ul className="wv-sa__runs">
          {[...new Set(runs.map((m) => m.words))].map((w) => {
            const ids = runs.filter((m) => m.words === w).map((m) => m.id);
            return (
              <li key={w}>
                <span style={styleOf(ids, palette)}>{w}</span>
                <em>{ids.map((id) => describeMark({ id }, null)).join(' · ')}</em>
              </li>
            );
          })}
        </ul>
      )}

      {(touched || err) && (
        <div className="wv-sa__foot">
          <span className={`wv-sa__hint${err ? ' is-err' : ''}`} role={err ? 'alert' : undefined}>
            {err || (wipe ? 'The text is taken off and the background filled in.' : 'Redrawn on the picture in the same lettering · ~20s')}
          </span>
          {touched && (
            <button type="button" className="wv-sa__go" disabled={busy} onClick={apply}>
              {busy ? 'Redrawing…' : 'Apply'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
