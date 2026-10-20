/*
 * The floating text card on a Theme Apply render — ported from bauhly-v3
 * `src/pages/app/editor/ShotSpots.jsx` (the `.shotask--bar` / `edm-selbar--spot`
 * card, Oct 13–14).
 *
 * A themed slide is one picture, so a text block can't be styled in place:
 * the card collects what the studio wants as a HELD change, and the Editor's
 * chat Send redraws every held region. The card is one white bar:
 *
 *   × · wand · Aa ▾ · B ▾ · U ▾ · align ▾ · colour ▾ │ reset · trash
 *   [ the words, drawn the way the picture sets them      ]
 *                                          [Apply changes]
 *
 * Marks (size, weight, italic / underline / strike, colour, alignment,
 * removing the text) are held as soon as they are picked, on the words
 * selected in the field or the whole text (size and alignment are always the
 * whole block). New WORDS are a draft until Apply changes (or Enter). With
 * `onApply`, Apply changes redraws this text straight away (the held marks
 * plus the new words) instead of holding it for the chat's Send. The wand turns the card into an ask: "make it shorter" rewrites the
 * draft (with back / forward through the versions), and Apply holds it.
 *
 * Controlled: `change` is { text, marks:[{id, words, off?}], remove, asks:[{say, what}] }
 * or null, and every edit reports the next one through `onChange` (null when
 * the region is back to what the picture says). `onAsk(text, instruction)`
 * resolves to the rewritten words.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';

export const TEXT_FORMS = [
  { id: 'bold', label: 'Bold', icon: 'format-bold', what: 'bold' },
  { id: 'italic', label: 'Italic', glyph: 'I', icon: 'format-italic', what: 'italic' },
  { id: 'underline', label: 'Underline', glyph: 'U', icon: 'format-underline', what: 'underlined' },
  { id: 'strike', label: 'Crossed out', glyph: 'S', icon: 'format-strike', what: 'struck through' },
];
const TEXT_SIZES = [
  { id: 'xsmall', label: 'Extra small', what: 'set at an extra-small type size' },
  { id: 'small', label: 'Small', what: 'set at a small type size' },
  { id: 'medium', label: 'Medium', what: 'set at a medium type size' },
  { id: 'large', label: 'Large', what: 'set at a large type size' },
  { id: 'statement', label: 'Statement', what: 'set very large, as a statement' },
];
const TEXT_WEIGHTS = [
  { id: 'wregular', label: 'Regular' },
  { id: 'wmedium', label: 'Medium', what: 'set in a medium weight' },
  { id: 'bold', label: 'Bold' },
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
  { id: 'alignl', label: 'Left', icon: 'align-left', what: 'aligned left' },
  { id: 'alignc', label: 'Centre', icon: 'align-center', what: 'centred' },
  { id: 'alignr', label: 'Right', icon: 'align-right', what: 'aligned right' },
];
const SIZE_IDS = TEXT_SIZES.map((z) => z.id);
// one of each of these at a time, per run of words
const GROUPS = [TEXT_INKS.map((c) => c.id), TEXT_HILITES.map((c) => c.id), TEXT_ALIGNS.map((a) => a.id), SIZE_IDS];
const groupOf = (id) => GROUPS.find((g) => g.includes(id)) || [id];
// size and alignment belong to the whole block, never to a few words
const WHOLE = [...TEXT_ALIGNS.map((a) => a.id), ...SIZE_IDS];

const ALIGN_OF = { alignl: 'left', alignc: 'center', alignr: 'right' };
const FORM_IDS = TEXT_FORMS.map((f) => f.id);

/* ── The look of the words (bauhly-v3 `spot.runs` + the studio's marks) ──────
 * A look is { bold, medium, italic, underline, strike, color, highlight }. The
 * region map read the picture's own (`region.style`, `region.runs`); the
 * studio's marks are laid over it: a form mark sets its field (`off` = turns it
 * off), a colour mark sets the palette colour. Order: the block → its runs →
 * whole-text marks → marks on words, so the last word said wins. */
const lookOfStyle = (st = {}) => ({
  bold: Boolean(st.bold),
  medium: false,
  italic: Boolean(st.italic),
  underline: Boolean(st.underline),
  strike: Boolean(st.strike),
  color: st.color || '',
  highlight: st.highlight || '',
});
function applyMark(look, m, palette) {
  if (m.id === 'wmedium') return { ...look, bold: false, medium: !m.off };
  if (FORM_IDS.includes(m.id)) return { ...look, [m.id]: !m.off, ...(m.id === 'bold' ? { medium: false } : {}) };
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
  return { bold: every('bold'), medium: every('medium'), italic: every('italic'), underline: every('underline'), strike: every('strike'), color: one('color'), highlight: one('highlight') };
}

// the picture's own colour, drawn as is on the white card — only very light
// ink (which would vanish on it) falls back to the card's ink
function readableOnLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(v >> 16) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255) <= 0.6;
}
const weightOf = (l) => (l.bold ? 800 : (l.medium ? 600 : undefined));
const cssOf = (l, keepMetrics = null) => ({
  fontWeight: weightOf(keepMetrics || l),
  fontStyle: (keepMetrics ? keepMetrics.italic : l.italic) ? 'italic' : undefined,
  textDecoration: [l.underline ? 'underline' : '', l.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
  color: l.highlight ? (l.color || undefined) : (readableOnLight(l.color) ? l.color : undefined),
  background: l.highlight || undefined,
  borderRadius: l.highlight ? 3 : undefined,
});

/** What a mark asks for, in the words the redraw prompt uses. */
export function describeMark(m, palette) {
  const ink = TEXT_INKS.find((c) => c.id === m.id);
  if (ink) return m.off ? 'back in its original colour' : `in the colour ${palette?.[ink.key] || ink.label}`;
  const hl = TEXT_HILITES.find((c) => c.id === m.id);
  if (hl) return m.off ? 'with no highlight behind the letters' : `with a ${palette?.[hl.key] || hl.label} highlight behind the letters`;
  const what = (TEXT_FORMS.find((f) => f.id === m.id) || TEXT_ALIGNS.find((a) => a.id === m.id)
    || TEXT_SIZES.find((z) => z.id === m.id) || TEXT_WEIGHTS.find((w) => w.id === m.id) || {}).what || m.id;
  return m.off ? `no longer ${what}` : what;
}
/** The palette hex a colour mark names ('' for the rest). */
export function markHex(m, palette) {
  const c = TEXT_INKS.find((x) => x.id === m.id) || TEXT_HILITES.find((x) => x.id === m.id);
  return c && !m.off ? palette?.[c.key] || '' : '';
}

/* above the region (under it when there is no room above), centred on it and
   held inside the card — bauhly-v3 ShotSpots `place()` */
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
      const top = above >= pad ? above : (below + h <= fh - pad ? below : Math.max(pad, fh - pad - h));
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
  if (change.kind === 'logo') return Boolean(change.remove || change.key);
  return Boolean(change.remove || change.marks?.length || change.asks?.length
    || String(change.text ?? region?.text ?? '').trim() !== String(region?.text || '').trim());
}

const Caret = () => <Icon name="chevron-down" size={12} strokeWidth={2.4} />;

export default function RegionTextPanel({ region, palette = null, busy = false, change = null, onChange, onClose, onAsk = null, onApply = null }) {
  const held = change?.text ?? region.text ?? '';
  // [{ id, words }] — words '' = the whole text
  const marks = change?.marks || [];
  const wipe = Boolean(change?.remove);
  const [draft, setDraft] = useState(held);
  const [pop, setPop] = useState(null);
  const [sel, setSel] = useState('');
  const [typing, setTyping] = useState(false);
  // the wand: an ask about the words, with the versions it has written
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [note, setNote] = useState('');
  const [gens, setGens] = useState([]);
  const [genAt, setGenAt] = useState(0);
  const box = useRef(null);
  const field = useRef(null);
  const mirror = useRef(null);

  useEffect(() => {
    setPop(null); setSel(''); setDraft(change?.text ?? region.text ?? '');
    setAsking(false); setAsk(''); setNote(''); setGens([]); setGenAt(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.id]);
  // a revert / clear from outside puts the words back
  useEffect(() => {
    if (change == null) setDraft(region.text || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change == null]);
  // the field takes the caret when the card opens (the reference's autofocus)
  useEffect(() => {
    const t = setTimeout(() => field.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [region.id]);

  const put = (patch) => {
    const next = { text: held, marks, remove: wipe, asks: change?.asks || [], ...patch };
    onChange?.(changeIsLive(next, region) ? next : null);
  };
  const setMarks = (fn) => put({ marks: fn(marks) });
  const text = draft;
  const wordsMoved = Boolean(draft.trim()) && draft.trim() !== String(held).trim();
  const base = { text: held, marks, remove: wipe, asks: change?.asks || [] };
  const pending = wordsMoved ? { ...base, text: draft } : base;
  const canApply = !busy && (wordsMoved || (Boolean(onApply) && changeIsLive(pending, region)));
  const applyDraft = () => {
    if (!canApply) return;
    setAsking(false); setAsk(''); setNote('');
    if (onApply) { onApply(pending); return; }
    put({ text: draft });
  };

  const look = lookAt(text, sel, region, marks, palette);
  const align = ALIGN_OF[(marks.find((m) => ALIGN_OF[m.id]) || {}).id] || region.style?.align || 'left';
  const isOn = (id) => {
    if (id === 'wmedium') return look.medium;
    if (id === 'wregular') return !look.bold && !look.medium;
    if (FORM_IDS.includes(id)) return Boolean(look[id]);
    if (ALIGN_OF[id]) return ALIGN_OF[id] === align;
    if (SIZE_IDS.includes(id)) return marks.some((m) => m.id === id);
    return marks.some((m) => m.id === id && m.words === sel);
  };
  // the line drawn in the field: one span per run of characters set alike.
  // While the caret is in it, weight/italic follow the whole block so the
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
    const words = WHOLE.includes(id) ? '' : readSel();
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
  // the weight is one choice of three: whatever the words show, made into it
  const setWeight = (id) => {
    setPop(null);
    const words = readSel();
    setMarks((cur) => {
      const rest = cur.filter((m) => !(m.words === words && (m.id === 'bold' || m.id === 'wmedium')));
      const now = lookAt(text, words, region, rest, palette);
      if (id === 'bold') return now.bold ? rest : [...rest, { id: 'bold', words }];
      if (id === 'wmedium') return [...rest, { id: 'wmedium', words }];
      return now.bold ? [...rest, { id: 'bold', words, off: true }] : rest;
    });
  };
  const revert = () => {
    setPop(null);
    setDraft(region.text || '');
    setAsking(false); setAsk(''); setNote('');
    onChange?.(null);
  };

  // the wand: one ask rewrites the draft; back / forward step through the versions
  const runAsk = async () => {
    const want = ask.trim();
    if (!want || askBusy || !onAsk) return;
    setAskBusy(true);
    setNote('');
    try {
      const out = String((await onAsk(draft, want)) || '').trim();
      if (!out || out === draft.trim()) {
        setNote('That would leave the text as it is.');
      } else {
        const base = gens.length ? gens.slice(0, genAt + 1) : [draft];
        setGens([...base, out]);
        setGenAt(base.length);
        setDraft(out);
        setAsk('');
      }
    } catch (err) {
      setNote(err?.message || 'Could not rewrite that just now.');
    } finally {
      setAskBusy(false);
    }
  };
  const genStep = (to) => {
    if (to < 0 || to >= gens.length || askBusy) return;
    setGenAt(to);
    setDraft(gens[to]);
    setNote('');
  };
  const openAsk = () => {
    setPop(null);
    if (asking) { setAsking(false); setAsk(''); setNote(''); return; }
    setGens([draft]);
    setGenAt(0);
    setAsking(true);
  };

  usePanelPlace(box, region);
  useEscape(pop, setPop, onClose);

  const label = String(region.role || 'Text').replace(/^./, (c) => c.toUpperCase());
  const off = busy || wipe;
  const touched = changeIsLive(change, region) || wordsMoved;
  const menu = (id, q, list) => pop === id && (
    <span className="wv-sa__pop" role="group" aria-label={q}>
      <span className="wv-sa__popq">{q}</span>
      {list}
    </span>
  );
  const opt = (key, on, onClick, body, title) => (
    <button
      key={key}
      type="button"
      className={`wv-sa__opt${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {body}
      {on && <Icon name="check" size={14} strokeWidth={2.4} className="wv-sa__optok" />}
    </button>
  );
  const tool = (id, aria, body, extra = '') => (
    <button
      type="button"
      className={`wv-sa__btn wv-sa__btn--menu${pop === id ? ' is-open' : ''}${extra}`}
      aria-expanded={pop === id}
      aria-label={aria}
      title={aria}
      disabled={off}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setPop((v) => (v === id ? null : id))}
    >
      {body}
      <Caret />
    </button>
  );

  return (
    <div
      ref={box}
      className={`wv-sa wv-sa--bar${asking ? ' is-asking' : ''}`}
      role="dialog"
      aria-label={`Edit the ${label.toLowerCase()}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="wv-sa__forms">
        <button type="button" className="wv-sa__btn wv-sa__shut" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="x" size={15} strokeWidth={2.2} />
        </button>
        {onAsk && (
          <button
            type="button"
            className={`wv-sa__btn wv-sa__ai${asking ? ' is-shut' : ''}`}
            aria-label={asking ? 'Back to the text tools' : 'Ask for a change to this'}
            aria-expanded={asking}
            title={asking ? 'Back' : 'Ask'}
            disabled={off}
            onMouseDown={(e) => e.preventDefault()}
            onClick={openAsk}
          >
            <Icon name={asking ? 'arrow-left' : 'wand'} size={asking ? 17 : 15} strokeWidth={asking ? 1.9 : 1.7} />
          </button>
        )}
        {asking ? (
          <span className="wv-sa__gens">
            <button type="button" className="wv-sa__btn" onClick={() => genStep(genAt - 1)} disabled={genAt <= 0 || askBusy} aria-label="The version before this" title="Back">
              <Icon name="arrow-left" size={15} strokeWidth={1.9} />
            </button>
            <button type="button" className="wv-sa__btn" onClick={() => genStep(genAt + 1)} disabled={genAt >= gens.length - 1 || askBusy} aria-label="The version after this" title="Forward">
              <Icon name="arrow-right" size={15} strokeWidth={1.9} />
            </button>
          </span>
        ) : (
          <>
            <span className="wv-sa__wrap">
              {tool('siz', 'Text size', <span className="wv-sa__glyph">Aa</span>, SIZE_IDS.some(isOn) ? ' is-on' : '')}
              {menu('siz', `${label} size`, TEXT_SIZES.map((z) => opt(z.id, isOn(z.id), () => toggle(z.id), z.label, z.label)))}
            </span>
            <span className="wv-sa__wrap">
              {tool('wgt', 'Text weight', <span className="wv-sa__glyph wv-sa__glyph--b">B</span>)}
              {menu('wgt', `${label} weight`, TEXT_WEIGHTS.map((w) => opt(w.id, isOn(w.id), () => setWeight(w.id), w.label, w.label)))}
            </span>
            <span className="wv-sa__wrap">
              {tool('mks', 'Italic, underline, crossed out', <Icon name="format-underline" size={15} strokeWidth={1.9} />)}
              {menu('mks', 'Marks', TEXT_FORMS.filter((f) => f.id !== 'bold').map((f) => opt(
                f.id,
                isOn(f.id),
                () => toggle(f.id),
                <><i className={`wv-sa__mark wv-sa__mark--${f.id}`} aria-hidden="true">{f.glyph}</i>{f.label}</>,
                f.label,
              )))}
            </span>
            <span className="wv-sa__wrap">
              {tool('aln', 'Alignment', <Icon name={(TEXT_ALIGNS.find((a) => isOn(a.id)) || TEXT_ALIGNS[0]).icon} size={15} strokeWidth={1.9} />)}
              {menu('aln', `${label} alignment`, TEXT_ALIGNS.map((a) => opt(
                a.id,
                isOn(a.id),
                () => toggle(a.id),
                <><Icon name={a.icon} size={16} strokeWidth={2} />{a.label}</>,
                a.label,
              )))}
            </span>
            {palette && (
              <span className="wv-sa__wrap">
                {tool('ink', 'Colour', <Icon name="droplet" size={15} strokeWidth={1.9} />)}
                {menu('ink', 'Text colour', TEXT_INKS.filter((c) => palette[c.key]).map((c) => opt(
                  c.id,
                  isOn(c.id),
                  () => toggle(c.id),
                  <><i className="wv-sa__dot" style={{ background: palette[c.key] }} aria-hidden="true" />{c.label}</>,
                  `${c.label} colour`,
                )))}
              </span>
            )}
            <span className="wv-sa__rule" aria-hidden="true" />
            <button
              type="button"
              className="wv-sa__btn"
              aria-label="Put the line back as it was"
              title="Reset"
              disabled={busy || !touched}
              onClick={revert}
            >
              <Icon name="reset" size={15} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className={`wv-sa__btn is-bad${wipe ? ' is-on' : ''}`}
              aria-pressed={wipe}
              title="Remove text"
              aria-label="Remove text"
              disabled={busy}
              onClick={() => { setPop(null); put({ remove: !wipe }); }}
            >
              <Icon name="trash" size={15} strokeWidth={1.9} />
            </button>
          </>
        )}
      </div>

      {asking ? (
        <>
          <p className="wv-sa__plain">{draft || region.text || ''}</p>
          <span className={`wv-sa__ask${ask ? '' : ' is-hint'}`}>
            {!ask && <Icon name="wand" size={15} strokeWidth={1.7} className="wv-sa__askmark" />}
            <textarea
              className="wv-sa__askin"
              rows={1}
              value={ask}
              autoFocus
              disabled={askBusy}
              placeholder="Ask for changes, e.g. “make it shorter”"
              aria-label="Ask for changes"
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAsk(); }
                if (e.key === 'Escape') { e.preventDefault(); setAsking(false); }
              }}
            />
            <button
              type="button"
              className={`wv-sa__asksend${askBusy ? ' is-busy' : ''}`}
              onClick={runAsk}
              disabled={askBusy || !ask.trim()}
              aria-label={askBusy ? 'Writing' : 'Send'}
              title="Send"
            >
              <Icon name={askBusy ? 'refresh' : 'arrow-up'} size={16} strokeWidth={2} />
            </button>
          </span>
          {note && <p className="wv-sa__hint">{note}</p>}
        </>
      ) : (
        <div className={`wv-sa__fieldwrap${wipe ? ' is-wiped' : ''}`} style={{ textAlign: align }}>
          {/* the words as the picture sets them, under a see-through textarea */}
          <div ref={mirror} className="wv-sa__mirror" aria-hidden="true">
            {spans}
            {'​'}
          </div>
          <textarea
            ref={field}
            className="wv-sa__field"
            value={text}
            disabled={off}
            aria-label={`The ${label.toLowerCase()} on this slide`}
            placeholder="What should this say?"
            spellCheck={false}
            style={{ fontWeight: weightOf(block), fontStyle: block.italic ? 'italic' : undefined, textAlign: align }}
            onChange={(e) => setDraft(e.target.value)}
            onSelect={() => setSel(readSel())}
            onFocus={() => setTyping(true)}
            onBlur={() => { setSel(''); setTyping(false); }}
            onScroll={(e) => { if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop; }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyDraft(); }
            }}
          />
        </div>
      )}

      {wipe && !asking && <p className="wv-sa__hint">The text comes off and the background is filled in when you {onApply ? 'apply' : 'send'}.</p>}
      {!asking && (
        <span className="wv-sa__commit">
          <button
            type="button"
            className="btn btn--primary btn--sm wv-sa__apply"
            onClick={applyDraft}
            disabled={!canApply}
          >
            Apply changes
          </button>
        </span>
      )}
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
