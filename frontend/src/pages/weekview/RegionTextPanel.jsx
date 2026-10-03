/*
 * The floating text panel on a Theme Apply render — ported from bauhly-v3
 * `src/pages/app/editor/ShotSpots.jsx` (the `.shotask` panel, Oct 1–2).
 *
 * A themed slide is one picture, so a text block can't be styled in place:
 * the panel collects what the studio wants (new words, bold / italic /
 * underline / strike, a colour, a highlight, an alignment, or removing the
 * text) as a HELD change. Nothing is drawn from here: the Editor's chat keeps
 * the count ("1 change ready") and its Send redraws every held region (bauhly-v3:
 * `Keep change` is not `Apply`). Marks apply to the words selected in the
 * field, or to the whole text when nothing is selected — except alignment,
 * which is always the whole block.
 *
 * Controlled: `change` is { text, marks:[{id, words}], remove, asks:[{say, what}] }
 * or null, and every edit reports the next one through `onChange` (null when
 * the region is back to what the picture says).
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

const ALIGN_OF = { alignl: 'left', alignc: 'center', alignr: 'right' };
const FORM_IDS = TEXT_FORMS.map((f) => f.id);

/* ── The look of the words (bauhly-v3 `spot.runs` + the studio's marks) ──────
 * A look is { bold, italic, underline, strike, color, highlight }. The region
 * map read the picture's own (`region.style`, `region.runs`); the studio's marks
 * are laid over it: a form mark sets its field (`off` = turns it off), a colour
 * mark sets the palette colour. Order: the block → its runs → whole-text marks
 * → marks on words, so the last word said wins. */
const lookOfStyle = (st = {}) => ({
  bold: Boolean(st.bold),
  italic: Boolean(st.italic),
  underline: Boolean(st.underline),
  strike: Boolean(st.strike),
  color: st.color || '',
  highlight: st.highlight || '',
});
function applyMark(look, m, palette) {
  if (FORM_IDS.includes(m.id)) return { ...look, [m.id]: !m.off };
  const ink = TEXT_INKS.find((c) => c.id === m.id);
  if (ink) return { ...look, color: m.off ? '' : (palette?.[ink.key] || look.color) };
  const hl = TEXT_HILITES.find((c) => c.id === m.id);
  if (hl) return { ...look, highlight: m.off ? '' : (palette?.[hl.key] || look.highlight) };
  return look;
}
const applyRun = (look, r) => {
  const out = { ...look };
  ['bold', 'italic', 'underline', 'strike'].forEach((k) => { if (typeof r[k] === 'boolean') out[k] = r[k]; });
  if (r.color) out.color = r.color;
  if (r.highlight) out.highlight = r.highlight;
  return out;
};
// every index `words` covers in `text` (first match)
const rangeOf = (text, words) => {
  const at = words ? text.indexOf(words) : -1;
  return at < 0 ? null : [at, at + words.length];
};
/** One look per character of `text`. */
function looksOf(text, region, marks, palette) {
  const base = lookOfStyle(region.style);
  const out = Array.from({ length: text.length }, () => ({ ...base }));
  const over = (range, fn) => { if (range) for (let i = range[0]; i < range[1]; i += 1) out[i] = fn(out[i]); };
  (region.runs || []).forEach((r) => over(rangeOf(text, r.words), (l) => applyRun(l, r)));
  marks.filter((m) => !m.words).forEach((m) => over([0, text.length], (l) => applyMark(l, m, palette)));
  marks.filter((m) => m.words).forEach((m) => over(rangeOf(text, m.words), (l) => applyMark(l, m, palette)));
  return out;
}
/** The look of `words` (or the whole block): what the toolbar shows lit. */
function lookAt(text, words, region, marks, palette) {
  const all = looksOf(text, region, marks, palette);
  const r = words ? rangeOf(text, words) : [0, text.length];
  const part = r ? all.slice(r[0], r[1]) : all;
  if (!part.length) return lookOfStyle(region.style);
  const every = (k) => part.every((l) => l[k]);
  const one = (k) => (part.every((l) => l[k] === part[0][k]) ? part[0][k] : '');
  return { bold: every('bold'), italic: every('italic'), underline: every('underline'), strike: every('strike'), color: one('color'), highlight: one('highlight') };
}

// the picture's own colour, drawn as is — only near-black ink (which would
// vanish on the dark panel) is shown in the panel's white
function readableOnDark(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(v >> 16) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255) >= 0.03;
}
const cssOf = (l, keepMetrics = null) => ({
  fontWeight: (keepMetrics ? keepMetrics.bold : l.bold) ? 800 : undefined,
  fontStyle: (keepMetrics ? keepMetrics.italic : l.italic) ? 'italic' : undefined,
  textDecoration: [l.underline ? 'underline' : '', l.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
  color: l.highlight ? (l.color || undefined) : (readableOnDark(l.color) ? l.color : undefined),
  background: l.highlight || undefined,
  borderRadius: l.highlight ? 3 : undefined,
});

/** What a mark asks for, in the words the redraw prompt uses. */
export function describeMark(m, palette) {
  const ink = TEXT_INKS.find((c) => c.id === m.id);
  if (ink) return m.off ? 'back in its original colour' : `in the colour ${palette?.[ink.key] || ink.label}`;
  const hl = TEXT_HILITES.find((c) => c.id === m.id);
  if (hl) return m.off ? 'with no highlight behind the letters' : `with a ${palette?.[hl.key] || hl.label} highlight behind the letters`;
  const what = (TEXT_FORMS.find((f) => f.id === m.id) || TEXT_ALIGNS.find((a) => a.id === m.id) || {}).what || m.id;
  return m.off ? `no longer ${what}` : what;
}
/** The palette hex a colour mark names ('' for the rest). */
export function markHex(m, palette) {
  const c = TEXT_INKS.find((x) => x.id === m.id) || TEXT_HILITES.find((x) => x.id === m.id);
  return c && !m.off ? palette?.[c.key] || '' : '';
}

/* placed under the region (over it when the region sits low), centred on it
   and held inside the card */
function usePanelPlace(box, region) {
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
  }, [box, region.id, region.box]);
}

// Escape closes a popover, then the panel — captured on the document so the
// Editor's own Escape (which would close the chat) doesn't also run
function useEscape(pop, setPop, onClose) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (pop) setPop(null);
      else onClose?.();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [pop, setPop, onClose]);
}

/** Whether a held change asks for anything at all. */
export function changeIsLive(change, region) {
  if (!change) return false;
  if (change.kind === 'image') return Boolean(change.act || change.asks?.length);
  if (change.kind === 'colours') return Boolean(change.setId && change.palette);
  return Boolean(change.remove || change.marks?.length || change.asks?.length
    || String(change.text ?? region?.text ?? '').trim() !== String(region?.text || '').trim());
}

export default function RegionTextPanel({ region, palette = null, busy = false, change = null, onChange, onClose }) {
  const text = change?.text ?? region.text ?? '';
  // [{ id, words }] — words '' = the whole text
  const marks = change?.marks || [];
  const wipe = Boolean(change?.remove);
  const [pop, setPop] = useState(null);
  const [sel, setSel] = useState('');
  const [typing, setTyping] = useState(false);
  const box = useRef(null);
  const field = useRef(null);
  const mirror = useRef(null);

  useEffect(() => { setPop(null); setSel(''); }, [region.id]);

  const put = (patch) => {
    const next = { text, marks, remove: wipe, asks: change?.asks || [], ...patch };
    onChange?.(changeIsLive(next, region) ? next : null);
  };
  const setText = (v) => put({ text: v });
  const setMarks = (fn) => put({ marks: fn(marks) });
  const setWipe = (fn) => put({ remove: fn(wipe) });
  const touched = changeIsLive(change, region);
  const look = lookAt(text, sel, region, marks, palette);
  const align = ALIGN_OF[(marks.find((m) => ALIGN_OF[m.id]) || {}).id] || region.style?.align || 'left';
  const isOn = (id) => {
    if (FORM_IDS.includes(id)) return Boolean(look[id]);
    if (ALIGN_OF[id]) return ALIGN_OF[id] === align;
    return marks.some((m) => m.id === id && m.words === sel);
  };
  // the line drawn in the field: one span per run of characters set alike.
  // While the caret is in it, bold/italic follow the whole block so the
  // mirror wraps exactly where the textarea does (the reference's `typing`).
  const looks = looksOf(text, region, marks, palette);
  const block = lookAt(text, '', region, marks, palette);
  const spans = [];
  for (let i = 0, from = 0; i <= looks.length; i += 1) {
    const same = i < looks.length && JSON.stringify(looks[i]) === JSON.stringify(looks[from]);
    if (i === looks.length || !same) {
      if (i > from) spans.push(<span key={from} style={cssOf(looks[from], typing ? block : null)}>{text.slice(from, i)}</span>);
      from = i;
    }
  }

  const readSel = () => {
    const el = field.current;
    if (!el || typeof el.selectionStart !== 'number') return '';
    return el.value.slice(el.selectionStart, el.selectionEnd).trim();
  };
  const toggle = (id) => {
    setPop(null);
    const words = groupOf(id) === GROUPS[2] ? '' : readSel();
    setMarks((cur) => {
      if (FORM_IDS.includes(id)) {
        // flip what the words show now: drop this mark, then add one only if
        // the picture's own look doesn't already give the flipped state
        const now = lookAt(text, words, region, cur, palette)[id];
        const rest = cur.filter((m) => !(m.id === id && m.words === words));
        if (lookAt(text, words, region, rest, palette)[id] === !now) return rest;
        return [...rest, { id, words, off: now }];
      }
      if (ALIGN_OF[id] && ALIGN_OF[id] === (region.style?.align || 'left')) {
        return cur.filter((m) => !ALIGN_OF[m.id]);
      }
      if (cur.some((m) => m.id === id && m.words === words)) return cur.filter((m) => !(m.id === id && m.words === words));
      const group = groupOf(id);
      return [...cur.filter((m) => !(m.words === words && group.includes(m.id))), { id, words }];
    });
  };
  const revert = () => {
    setPop(null);
    onChange?.(null);
  };

  usePanelPlace(box, region);

  useEscape(pop, setPop, onClose);

  const label = String(region.role || 'Text').replace(/^./, (c) => c.toUpperCase());
  const swatch = (list) => palette?.[(list.find((c) => isOn(c.id)) || list[0]).key];
  const inkNow = TEXT_INKS.some((c) => isOn(c.id)) ? swatch(TEXT_INKS) : look.color;
  const hlNow = TEXT_HILITES.some((c) => isOn(c.id)) ? swatch(TEXT_HILITES) : look.highlight;

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
              <i style={{ background: inkNow || 'transparent' }} aria-hidden="true" />
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
              {hlNow && <i style={{ background: hlNow }} aria-hidden="true" />}
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

      <div className={`wv-sa__fieldwrap${wipe ? ' is-wiped' : ''}`} style={{ textAlign: align }}>
        {/* the words as the picture sets them, under a see-through textarea */}
        <div ref={mirror} className="wv-sa__mirror" aria-hidden="true">
          {spans}
          {'\u200b'}
        </div>
        <textarea
          ref={field}
          className="wv-sa__field"
          value={text}
          disabled={busy || wipe}
          aria-label={`${label} text`}
          spellCheck={false}
          style={{ fontWeight: block.bold ? 800 : undefined, fontStyle: block.italic ? 'italic' : undefined, textAlign: align }}
          onChange={(e) => setText(e.target.value)}
          onSelect={() => setSel(readSel())}
          onFocus={() => setTyping(true)}
          onBlur={() => { setSel(''); setTyping(false); }}
          onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
        />
      </div>

      {wipe && <p className="wv-sa__hint">The text comes off and the background is filled in when you send.</p>}
    </div>
  );
}

/* ── The picture's panel (bauhly-v3 ShotSpots `.shotask--acts`) ──────────────
 * Three acts a flattened picture can take — replaced with one the studio
 * chooses, generated again, or taken off — one at a time, held like the text
 * changes and redrawn by the chat's Send. A chosen picture shows on a plate
 * under the acts, with × to drop it.
 * `change` is { kind:'image', act: 'replace'|'generate'|'remove'|'ref'|'asvisual'|null,
 * photoKey, photoUrl, refKey, refUrl, asks } or null. */
export const IMAGE_ACTS = [
  { id: 'replace', label: 'Replace image', icon: 'image-plus' },
  { id: 'generate', label: 'Generate image', icon: 'sparkle' },
  { id: 'remove', label: 'Remove image', icon: 'trash', bad: true },
];

export function RegionImagePanel({ region, busy = false, change = null, onChange, onReplace, onClose }) {
  const box = useRef(null);
  const [pop, setPop] = useState(null);
  usePanelPlace(box, region);
  useEscape(pop, setPop, onClose);
  const act = change?.act || null;
  const touched = changeIsLive(change, region);
  const put = (patch) => {
    const next = { kind: 'image', act, asks: change?.asks || [], ...(change || {}), ...patch };
    onChange?.(changeIsLive(next, region) ? next : null);
  };
  // the generate family (generate / from a reference / as a graphic) all light the sparkle
  const isOn = (id) => (id === 'generate' ? ['generate', 'ref', 'asvisual'].includes(act) : act === id);
  const plate = act === 'replace' ? change?.photoUrl : (act === 'ref' ? change?.refUrl : '');

  return (
    <div
      ref={box}
      className="wv-sa wv-sa--acts"
      role="dialog"
      aria-label="Edit the picture"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="wv-sa__head">
        <span className="wv-sa__what">
          Image
          {touched && <em className="wv-sa__done">Updated</em>}
        </span>
        {touched && (
          <button type="button" className="wv-sa__x" aria-label="Revert this picture" title="Revert" disabled={busy} onClick={() => onChange?.(null)}>
            <Icon name="undo" size={16} strokeWidth={2} />
          </button>
        )}
        <button type="button" className="wv-sa__x" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} strokeWidth={2} />
        </button>
      </div>
      <div className="wv-sa__acts">
        {IMAGE_ACTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`wv-sa__btn${a.bad ? ' is-bad' : ''}${isOn(a.id) ? ' is-on' : ''}`}
            aria-pressed={isOn(a.id)}
            title={a.label}
            aria-label={a.label}
            disabled={busy}
            onClick={() => {
              if (a.id === 'replace') { onReplace?.(); return; }
              put({ act: isOn(a.id) ? null : a.id });
            }}
          >
            <Icon name={a.icon} size={17} strokeWidth={1.9} />
          </button>
        ))}
      </div>
      {plate ? (
        <span className="wv-sa__put">
          <span className="wv-sa__pic"><img src={plate} alt={act === 'ref' ? 'the reference you added' : 'the picture you chose'} /></span>
          {act === 'ref' && <em className="wv-sa__putlab">Reference</em>}
          <button
            type="button"
            className="wv-sa__putx"
            aria-label="Take this picture off again"
            title="Take this picture off again"
            disabled={busy}
            onClick={() => put({ act: null, photoKey: '', photoUrl: '', refKey: '', refUrl: '' })}
          >
            <Icon name="x" size={11} strokeWidth={2.6} />
          </button>
        </span>
      ) : null}
      {act === 'remove' && <p className="wv-sa__hint">The picture comes off and the background is filled in when you send.</p>}
    </div>
  );
}
