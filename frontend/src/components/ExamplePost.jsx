/*
 * The landing example's post: the one-slide preview in the conversation and the `Try editing` view
 * (bauhly-v3, Nov 6–10 — decisions 675, 677, 707–709, 733–748).
 *
 * In the mock the editing view is the product's own Editor over a demo store. The live Editor works on the
 * carousel agent's HTML slides, and the example is never generated or filed, so this is a self-contained
 * demo of the same view and the same popups, read off the mock (Nov 10):
 *   Ask          the chat field under the discs, examples typing in it
 *   Layout       `Layout style: <name>` over a rail of five wireframe cards; a card asks `this slide` /
 *                `all slides`, and the slide blurs under `Generating layout…` with `Stop this`
 *   Colours      `Colour palette` (the three sets, Current ✓), Swap colours, Create a colour set (three
 *                swatches + Save and use it), Bauhly decides (off in the demo)
 *   Add element  Image › (Upload a photo, Choose from library, Background › textures), Logo ›, Add a slide ›
 *   More         Copy settings › (Text size, Layout, Colours → toast, then Paste settings), Reset edits ›
 *                (This slide only / All slides), Remove slide
 *   A press on the words selects them, with the mock's bar: ×, Ask, Aa (size), B (weight), U (italic,
 *   underline, crossed out), alignment, colour, put back, remove. A double press edits the words.
 * Every tool really changes the example. Done carries the edits back into the conversation's preview; Cancel
 * puts it back. Nothing is saved anywhere.
 *
 * One renderer (`ExampleSlide`) draws both views: its type is sized off the slide's width (container units).
 */
import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { useTypedPlaceholder } from './ui/typing';
import './examplepost.css';

/* the Brand Kit's three demo sets (bauhly-v3 data/brandkit-demo.js) */
export const EX_SETS = {
  primary: { name: 'Primary', ink: '#1b100d', accent: '#ff5227', ground: '#f4f2ee' },
  nature: { name: 'Nature', ink: '#1f4a3d', accent: '#8aa695', ground: '#efe6d9' },
  minimal: { name: 'Minimal', ink: '#14245c', accent: '#a9c4f2', ground: '#eef0f3' },
};
const setOf = (slide, custom) => (slide.set === 'custom' && custom ? custom : EX_SETS[slide.set] || EX_SETS.nature);

const LAYOUTS = [
  { id: 'bleed', label: 'Full bleed', photo: true },
  { id: 'band', label: 'Split band', photo: true },
  { id: 'panel', label: 'Floating panel', photo: true },
  { id: 'editorial', label: 'Editorial', photo: true },
  { id: 'type', label: 'One block', photo: false },
];
const BACKGROUNDS = [
  { id: null, label: 'Plain canvas' },
  { id: '/assets/brand/bg-offwhite.svg', label: 'Off-white' },
  { id: '/assets/brand/bg-stone.svg', label: 'Stone' },
  { id: '/assets/brand/bg-wood.svg', label: 'Wood' },
  { id: '/assets/brand/bg-concrete.svg', label: 'Concrete' },
];
const SIZES = ['medium', 'large', 'statement'];
const EL_SIZES = [{ id: 's', label: 'Small', k: 0.8 }, { id: 'm', label: 'Medium', k: 1 }, { id: 'l', label: 'Large', k: 1.2 }, { id: 'xl', label: 'Extra large', k: 1.45 }];
const WEIGHTS = [{ id: 400, label: 'Regular' }, { id: 600, label: 'Semibold' }, { id: 800, label: 'Bold' }];
const ELS = { eyebrow: 'kicker', headline: 'title', body: 'text' };

const layoutOf = (sl) => (!sl.photo || sl.layout === 'type' || sl.kind === 'type' ? 'type' : sl.layout || 'bleed');
const sizeOf = (sl) => sl.tune?.title?.textProminence || 'medium';
const posOf = (sl) => sl.pos || (['bleed', 'panel'].includes(layoutOf(sl)) ? 'bottom' : 'center');

/* ── THE SLIDE ───────────────────────────────────────────────────────────────────────────────────── */
export function ExampleSlide({ slide, custom = null, n, of, selected = null, editing = null, onSelect = null, onEdit = null, onText = null }) {
  const set = setOf(slide, custom);
  const dark = slide.tone === 'dark';
  const bg = dark ? set.ink : set.ground;
  const fg = dark ? set.ground : set.ink;
  const layout = layoutOf(slide);
  const pic = layout !== 'type' && slide.photo ? {
    backgroundImage: `url(${slide.photo})`,
    backgroundPosition: slide.picture?.at || 'center',
    backgroundSize: slide.picture?.zoom ? `${slide.picture.zoom * 100}%` : 'cover',
  } : null;
  const colourOf = (c) => (c === 'ink' ? set.ink : c === 'ground' ? set.ground : c === 'accent' ? set.accent : c === 'white' ? '#fff' : undefined);
  const el = (key, cls) => {
    if (slide.hide?.[key] || !slide[key]) return null;
    const st = slide.els?.[key] || {};
    const k = EL_SIZES.find((s) => s.id === st.size)?.k || 1;
    const style = {
      '--k': k,
      fontWeight: st.weight || undefined,
      fontStyle: st.italic ? 'italic' : undefined,
      textDecoration: [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
      textAlign: st.align || undefined,
      color: colourOf(st.color),
    };
    const live = editing === key;
    return (
      <span
        className={`${cls}${selected === key ? ' is-sel' : ''}${onSelect ? ' is-pickable' : ''}`}
        style={style}
        data-el={key}
        contentEditable={live || undefined}
        suppressContentEditableWarning
        onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(key); } : undefined}
        onDoubleClick={onEdit ? (e) => { e.stopPropagation(); onEdit(key); } : undefined}
        onBlur={live ? (e) => onText?.(key, e.currentTarget.innerText.trim()) : undefined}
        onKeyDown={live ? (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); } } : undefined}
      >
        {slide[key]}
      </span>
    );
  };
  const align = slide.els?.headline?.align;
  return (
    <figure
      className={`exs exs--${layout} is-${sizeOf(slide)} at-${posOf(slide)}${dark ? ' is-dark' : ''}${align ? ` al-${align}` : ''}`}
      style={{ '--ex-bg': bg, '--ex-fg': fg, '--ex-accent': set.accent, ...(slide.bgTex ? { '--ex-tex': `url(${slide.bgTex})` } : {}) }}
      onClick={onSelect ? () => onSelect(null) : undefined}
    >
      {slide.bgTex && <span className="exs__tex" aria-hidden="true" />}
      {pic && <span className="exs__pic" style={pic} aria-hidden="true" />}
      <figcaption className="exs__words">
        <span className="exs__rule" aria-hidden="true" />
        {el('eyebrow', 'exs__eyebrow')}
        {el('headline', 'exs__head')}
        {el('body', 'exs__body')}
      </figcaption>
      {slide.logo && <img className="exs__logo" src={layout === 'bleed' || dark ? '/assets/brand/mark-noor-light.svg' : '/assets/brand/mark-noor-dark.svg'} alt="" />}
      {n != null && <span className="sr-only">Slide {n} of {of}</span>}
    </figure>
  );
}

/* ── IN THE CONVERSATION: one slide at a time, the arrows and the dots ─────────────────────────── */
export function ExamplePreview({ post, at, onAt }) {
  const slides = post?.slides || [];
  const i = Math.min(at, slides.length - 1);
  return (
    <div className="exp" role="group" aria-roledescription="carousel" aria-label="Example post">
      <ExampleSlide slide={slides[i]} custom={post.custom} n={i + 1} of={slides.length} />
      {i > 0 && (
        <button type="button" className="exp__arrow exp__arrow--prev" onClick={() => onAt(i - 1)} aria-label="Previous slide">
          <Icon name="arrow-left" size={14} strokeWidth={2.2} />
        </button>
      )}
      {i < slides.length - 1 && (
        <button type="button" className="exp__arrow exp__arrow--next" onClick={() => onAt(i + 1)} aria-label="Next slide">
          <Icon name="arrow-right" size={14} strokeWidth={2.2} />
        </button>
      )}
      <span className="exp__dots" aria-hidden="true">
        {slides.map((s, k) => <i key={k} className={k === i ? 'is-on' : ''} />)}
      </span>
    </div>
  );
}

/* ── THE EDITING VIEW ─────────────────────────────────────────────────────────────────────────── */
const TOOLS = [
  { id: 'ask', icon: 'wand', label: 'Ask', says: 'Ask Bauhly' },
  { id: 'layout', icon: 'blocks', label: 'Layout', says: 'Layout style' },
  { id: 'colour', icon: 'droplet', label: 'Colours', says: 'Colours' },
  { id: 'add', icon: 'plus', label: 'Add element', says: 'Add element' },
  { id: 'more', icon: 'more', label: 'More', says: 'More' },
];
const REFINE = 'Refine your post';
const ASKS = [
  'Give the elements more breathing room…',
  'Reduce the overall text size…',
  'Make the headline bigger…',
  'Move the words to the top…',
  'Put this slide on a dark ground…',
];
const GEN_MS = 1500;

/* what the Ask field understands in the demo: a few plain requests, done the way the tools do them */
function readAsk(text, slide) {
  const t = text.toLowerCase();
  const size = sizeOf(slide);
  const up = SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(size) + 1)];
  const down = SIZES[Math.max(0, SIZES.indexOf(size) - 1)];
  /* a headline with its own size (the Aa menu, or pasted) steps that size; otherwise the slide's prominence */
  const own = slide.els?.headline?.size;
  const steps = EL_SIZES.map((x) => x.id);
  const stepOwn = (d) => {
    const i = Math.min(steps.length - 1, Math.max(0, steps.indexOf(own) + d));
    return steps[i] === own ? null : { ...slide, els: { ...slide.els, headline: { ...slide.els.headline, size: steps[i] } } };
  };
  const withSize = (p) => ({ ...slide, tune: { ...slide.tune, title: { ...slide.tune?.title, textProminence: p } } });
  if (own && /(bigger|larger|louder|stand out|bolder)/.test(t)) return stepOwn(1);
  if (own && /(smaller|reduce|quieter|calmer|less)/.test(t)) return stepOwn(-1);
  if (/(bigger|larger|louder|stand out|bolder)/.test(t)) return size === up ? null : withSize(up);
  if (/(smaller|reduce|quieter|calmer|less)/.test(t)) return size === down ? null : withSize(down);
  if (/(breathing|space|room)/.test(t)) return { ...withSize(down), pos: 'center' };
  if (/\btop\b/.test(t)) return { ...slide, pos: 'top' };
  if (/(cent(er|re)|middle)/.test(t)) return { ...slide, pos: 'center' };
  if (/(bottom|foot|lower)/.test(t)) return { ...slide, pos: 'bottom' };
  if (/(dark)/.test(t)) return { ...slide, tone: 'dark' };
  if (/(light|bright)/.test(t)) return { ...slide, tone: undefined };
  return null;
}

/* one menu level: a title with a way back, then its rows */
function Menu({ title, onBack, children, className = '' }) {
  return (
    <div className={`exm ${className}`.trim()} role="menu" onPointerDown={(e) => e.stopPropagation()}>
      {(title || onBack) && (
        <div className="exm__head">
          {onBack && <button type="button" className="exm__back" onClick={onBack} aria-label="Back"><Icon name="chevron-left" size={15} /></button>}
          <b>{title}</b>
        </div>
      )}
      {children}
    </div>
  );
}
function Row({ icon, title, sub, onClick, disabled, more, on, tag, children }) {
  return (
    <button type="button" role="menuitem" className={`exm__row${on ? ' is-on' : ''}`} onClick={onClick} disabled={disabled}>
      {children || (icon && <Icon name={icon} size={15} />)}
      <span className="exm__txt"><span className="exm__title">{title}</span>{sub && <span className="exm__sub">{sub}</span>}</span>
      {tag && <span className="exm__tag">{tag}</span>}
      {on && <Icon name="check" size={14} strokeWidth={2.4} />}
      {more && <Icon name="chevron-right" size={14} />}
    </button>
  );
}
const Tri = ({ set }) => (
  <span className="exm__tri" aria-hidden="true"><i style={{ background: set.ink }} /><i style={{ background: set.accent }} /><i style={{ background: set.ground }} /></span>
);
/* the layout cards are wireframes, hatched where the picture goes */
const Wire = ({ id }) => (
  <span className={`exw exw--${id}`} aria-hidden="true"><i className="exw__pic" /><i className="exw__txt" /></span>
);

export function ExampleEditor({ post, original, at, onAt, onCancel, onDone, leaving = false }) {
  /* the edits are a history, so undo and redo walk it; Cancel drops all of it */
  const [hist, setHist] = useState({ list: [post], i: 0 });
  const now = hist.list[hist.i];
  const slides = now.slides;
  const [cur, setCur] = useState(Math.min(at, slides.length - 1));
  const [grid, setGrid] = useState(false);
  const [tool, setTool] = useState(null);
  const [level, setLevel] = useState(null); // a sub-level of the open tool's menu
  const [layPick, setLayPick] = useState(null); // the layout card whose `this slide / all slides` is open
  const [gen, setGen] = useState(null); // `Generating layout…` while it runs
  const genT = useRef(0);
  const [sel, setSel] = useState(null); // the element selected on the slide
  const [selMenu, setSelMenu] = useState(null);
  const [editing, setEditing] = useState(null);
  /* where the selection bar stands: just above the selected words, as the mock's does */
  const [selAt, setSelAt] = useState(null);
  const slideBox = useRef(null);
  const [toast, setToast] = useState(null);
  const toastT = useRef(0);
  const [copied, setCopied] = useState(null); // { from, what: [] }
  const [copyWhat, setCopyWhat] = useState({ size: true, layout: true, colours: true });
  const [draftSet, setDraftSet] = useState(null);
  const [ask, setAsk] = useState('');
  const askRef = useRef(null);
  const fileRef = useRef(null);
  const slide = slides[Math.min(cur, slides.length - 1)];
  const [askShow] = useTypedPlaceholder(ASKS, tool === 'ask' && !ask);

  useEffect(() => () => { clearTimeout(genT.current); clearTimeout(toastT.current); }, []);
  useEffect(() => { if (cur > slides.length - 1) setCur(slides.length - 1); }, [cur, slides.length]);
  useEffect(() => { setSel(null); setSelMenu(null); setEditing(null); }, [cur, grid]);
  useEffect(() => {
    if (!sel) { setSelAt(null); return; }
    const box = slideBox.current;
    const node = box?.querySelector(`.exs [data-el="${sel}"]`);
    if (!box || !node) return;
    const b = box.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    setSelAt({ top: Math.max(6, r.top - b.top - 46), left: r.left - b.left + r.width / 2 });
  }, [sel, hist.i]);

  const say = (text) => { setToast(text); clearTimeout(toastT.current); toastT.current = setTimeout(() => setToast(null), 3200); };
  const commit = (next) => setHist((h) => ({ list: [...h.list.slice(0, h.i + 1), next], i: h.i + 1 }));
  const editSlide = (fn, k = cur) => commit({ ...now, slides: slides.map((s, j) => (j === k ? fn(s) : s)) });
  const editEl = (key, patch) => editSlide((s) => ({ ...s, els: { ...s.els, [key]: { ...s.els?.[key], ...patch } } }));
  const undo = () => setHist((h) => ({ ...h, i: Math.max(0, h.i - 1) }));
  const redo = () => setHist((h) => ({ ...h, i: Math.min(h.list.length - 1, h.i + 1) }));
  const go = (k) => { setCur(k); onAt?.(k); };
  const closeTool = () => { setTool(null); setLevel(null); setLayPick(null); setDraftSet(null); };
  const pickTool = (id) => {
    setSel(null); setSelMenu(null); setLayPick(null); setLevel(null); setDraftSet(null);
    setTool((on) => (on === id ? null : id));
    if (id === 'ask') requestAnimationFrame(() => askRef.current?.focus({ preventScroll: true }));
  };
  /* what the mock's Editor shows while a change is being made: the slide blurred, a line and `Stop this` */
  const generate = (say_, apply) => {
    closeTool();
    setGen(say_);
    clearTimeout(genT.current);
    genT.current = setTimeout(() => { setGen(null); apply(); }, GEN_MS);
  };

  /* Escape: the open thing first, then the view, as Cancel */
  useEffect(() => {
    const keys = (e) => {
      if (editing) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (gen) { clearTimeout(genT.current); setGen(null); } else if (sel) { setSel(null); setSelMenu(null); } else if (tool) closeTool(); else onCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
    };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  });

  /* a press outside what is open closes it */
  useEffect(() => {
    if (!tool && !sel) return undefined;
    const away = (e) => {
      if (e.target.closest('.exe__tools, .exm, .exe__rail, .exe__ask, .exsb, .exs__words, input[type=color]')) return;
      if (tool && tool !== 'ask') closeTool();
      if (sel && !e.target.closest('.exs')) { setSel(null); setSelMenu(null); }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  });

  const sendAsk = () => {
    const text = ask.trim();
    if (!text) return;
    const next = readAsk(text, slide);
    if (!next) { say('That change isn’t available in this demo.'); return; }
    setAsk('');
    generate('Making your change…', () => editSlide(() => next));
  };

  /* ── the levels each disc opens ── */
  const colourMenu = () => {
    if (level === 'newset') {
      const d = draftSet || { ...setOf(slide, now.custom) };
      const sw = [
        { k: 'ink', label: 'Primary', note: 'Type, and every dark surface.' },
        { k: 'accent', label: 'Accent', note: 'The one colour that points.' },
        { k: 'ground', label: 'Neutral', note: 'The ground a layout sits on.' },
      ];
      return (
        <Menu title="New colour set" onBack={() => { setLevel(null); setDraftSet(null); }} className="exm--wide">
          <p className="exm__note">Press a colour to change it.</p>
          <div className="exm__swatches">
            {sw.map((s) => (
              <label key={s.k} className="exm__swatch">
                <span className="exm__chip" style={{ background: d[s.k] }}>
                  <span className="exm__pen"><Icon name="edit" size={11} /></span>
                  <input type="color" value={d[s.k]} onChange={(e) => setDraftSet({ ...d, [s.k]: e.target.value })} aria-label={s.label} />
                </span>
                <b>{s.label}</b>
                <span className="exm__hex">{d[s.k].toUpperCase()}</span>
                <span className="exm__sub">{s.note}</span>
              </label>
            ))}
          </div>
          <button type="button" className="exm__go" disabled={!draftSet} onClick={() => {
            const custom = { name: 'Your set', ...d };
            commit({ ...now, custom, slides: slides.map((s, j) => (j === cur ? { ...s, set: 'custom' } : s)) });
            closeTool();
            say('Your colour set is on this slide.');
          }}>
            <Icon name="check" size={13} strokeWidth={2.4} /> Save and use it
          </button>
        </Menu>
      );
    }
    return (
      <Menu title="Colour palette">
        {Object.entries(EX_SETS).map(([id, set]) => (
          <Row key={id} title={set.name} on={slide.set === id} tag={slide.set === id ? 'Current' : null} onClick={() => { editSlide((s) => ({ ...s, set: id })); }}>
            <Tri set={set} />
          </Row>
        ))}
        {now.custom && (
          <Row title={now.custom.name} on={slide.set === 'custom'} tag={slide.set === 'custom' ? 'Current' : null} onClick={() => editSlide((s) => ({ ...s, set: 'custom' }))}>
            <Tri set={now.custom} />
          </Row>
        )}
        <hr className="exm__rule" />
        <Row icon="refresh" title="Swap colours" sub="The same three, in other places" onClick={() => editSlide((s) => ({ ...s, tone: s.tone === 'dark' ? undefined : 'dark' }))} />
        <Row icon="plus" title="Create a colour set" sub="Three of your own" more onClick={() => setLevel('newset')} />
        <Row icon="sparkle" title="Bauhly decides" sub="One set per beat" more disabled />
      </Menu>
    );
  };

  const addMenu = () => {
    if (level === 'image') {
      return (
        <Menu title="Images" onBack={() => setLevel(null)}>
          <Row icon="upload" title="Upload a photo" sub="Use your own image" onClick={() => fileRef.current?.click()} />
          <Row icon="image" title="Choose from library" sub="Images you can use" disabled more />
          <Row icon="layers" title="Background" sub="The ground behind it" more onClick={() => setLevel('bg')} />
        </Menu>
      );
    }
    if (level === 'bg') {
      return (
        <Menu title="Background" onBack={() => setLevel('image')} className="exm--wide">
          <div className="exm__bgs">
            {BACKGROUNDS.map((b) => {
              const on = (slide.bgTex || null) === b.id;
              return (
                <button type="button" key={b.label} className={`exm__bg${on ? ' is-on' : ''}`} aria-label={b.label} title={b.label}
                  style={b.id ? { backgroundImage: `url(${b.id})` } : undefined}
                  onClick={() => editSlide((s) => ({ ...s, bgTex: b.id }))}>
                  {!b.id && <span className="exm__plain"><Icon name="image-off" size={15} />Plain canvas</span>}
                  {on && <span className="exm__cur">Current</span>}
                </button>
              );
            })}
          </div>
          <Row icon="upload" title="Upload a background" sub="Saved to your kit, and on this slide" more disabled />
        </Menu>
      );
    }
    if (level === 'logo') {
      return (
        <Menu title="Logo" onBack={() => setLevel(null)}>
          <Row icon="upload" title="Add new logo" sub="Saved to your kit, and on this slide" disabled />
          <Row icon="copy" title={slide.logo ? 'Remove the logo' : 'Use logo from Brand Kit'} sub={slide.logo ? 'Take your mark off this slide' : 'Placed where this composition has room'}
            onClick={() => { editSlide((s) => ({ ...s, logo: !s.logo })); closeTool(); }} />
        </Menu>
      );
    }
    if (level === 'slide') {
      const blank = (dir) => {
        const fresh = { kind: 'type', layout: 'type', photo: null, set: slide.set, tone: slide.tone === 'dark' ? undefined : 'dark', eyebrow: 'A new slide', headline: 'Say what happens next.', body: 'Double-click any words to change them.' };
        const k = dir === 'before' ? cur : cur + 1;
        commit({ ...now, slides: [...slides.slice(0, k), fresh, ...slides.slice(k)] });
        go(k);
        closeTool();
      };
      return (
        <Menu title="Add a slide" onBack={() => setLevel(null)}>
          <Row icon="arrow-left" title="Before this one" sub={`A new slide ${cur + 1}`} onClick={() => blank('before')} />
          <Row icon="arrow-right" title="After this one" sub={`A new slide ${cur + 2}`} onClick={() => blank('after')} />
        </Menu>
      );
    }
    return (
      <Menu>
        <Row icon="image" title="Image" sub="A photograph on this slide" more onClick={() => setLevel('image')} />
        <Row icon="pin" title="Logo" sub="Your mark on this slide" more onClick={() => setLevel('logo')} />
        <Row icon="plus" title="Add a slide" sub="Before or after this one" more onClick={() => setLevel('slide')} />
      </Menu>
    );
  };

  const settingsOf = (s, what) => ({
    ...(what.size ? { tune: s.tune, els: s.els } : {}),
    ...(what.layout ? { layout: s.layout, kind: s.kind, pos: s.pos } : {}),
    ...(what.colours ? { set: s.set, tone: s.tone, bgTex: s.bgTex } : {}),
  });
  const COPY_ROWS = [
    { k: 'size', title: 'Text size', sub: 'How large the type is set' },
    { k: 'layout', title: 'Layout', sub: 'How this slide is arranged' },
    { k: 'colours', title: 'Colours', sub: 'The colours this slide wears' },
  ];
  const named = (what) => COPY_ROWS.filter((r) => what[r.k]).map((r) => r.title).join(', ');
  const moreMenu = () => {
    if (level === 'copy') {
      const n = Object.values(copyWhat).filter(Boolean).length;
      return (
        <Menu title="Copy settings" onBack={() => setLevel(null)}>
          {COPY_ROWS.map((r) => (
            <Row key={r.k} title={r.title} sub={r.sub} onClick={() => setCopyWhat((w) => ({ ...w, [r.k]: !w[r.k] }))}>
              <span className={`exm__box${copyWhat[r.k] ? ' is-on' : ''}`} aria-hidden="true">{copyWhat[r.k] && <Icon name="check" size={11} strokeWidth={3} />}</span>
            </Row>
          ))}
          <button type="button" className="exm__go exm__go--lime" disabled={!n} onClick={() => {
            setCopied({ from: cur, what: { ...copyWhat }, settings: settingsOf(slide, copyWhat) });
            closeTool();
            say(`${named(copyWhat)} copied — open another slide to paste`);
          }}>
            <Icon name="copy" size={13} /> Copy {n} setting{n === 1 ? '' : 's'}
          </button>
        </Menu>
      );
    }
    if (level === 'reset') {
      return (
        <Menu title="Reset edits" onBack={() => setLevel(null)}>
          <Row icon="file-plus" title="This slide only" sub="The others keep theirs" onClick={() => {
            const was = original.slides[cur] || slide;
            editSlide(() => ({ ...was }));
            closeTool();
          }} />
          <Row icon="copy" title="All slides" sub={`All ${original.slides.length} go back`} onClick={() => { commit(original); go(Math.min(cur, original.slides.length - 1)); closeTool(); }} />
        </Menu>
      );
    }
    return (
      <Menu>
        <Row icon="copy" title="Copy settings" sub="Choose what goes to another slide" more onClick={() => setLevel('copy')} />
        {copied && (
          <Row icon="download" title="Paste settings" sub={`${named(copied.what)}, copied from slide ${copied.from + 1}`} disabled={copied.from === cur} onClick={() => {
            editSlide((s) => ({ ...s, ...copied.settings }));
            closeTool();
          }} />
        )}
        <Row icon="undo" title="Reset edits" sub="Put back what Bauhly made" more onClick={() => setLevel('reset')} />
        <hr className="exm__rule" />
        <Row icon="trash" title="Remove slide" sub="Takes this frame out of the carousel" disabled={slides.length <= 1} onClick={() => {
          commit({ ...now, slides: slides.filter((_, j) => j !== cur) });
          go(Math.max(0, cur - 1));
          closeTool();
        }} />
      </Menu>
    );
  };

  /* ── the bar over a selected element (the mock's `.edm-selbar`) ── */
  const selBar = () => {
    if (!sel) return null;
    const st = slide.els?.[sel] || {};
    const name = ELS[sel];
    const drop = (id, label, children) => (
      <span className="exsb__hold">
        <button type="button" className={`exsb__btn${selMenu === id ? ' is-on' : ''}`} onClick={() => setSelMenu((m) => (m === id ? null : id))} aria-label={label} title={label}>
          {children}<Icon name="chevron-down" size={11} />
        </button>
        {selMenu === id && <div className="exsb__menu exm" onPointerDown={(e) => e.stopPropagation()}>{({
          size: EL_SIZES.map((s) => <Row key={s.id} title={s.label} on={(st.size || 'm') === s.id} onClick={() => { editEl(sel, { size: s.id }); setSelMenu(null); }} />),
          weight: WEIGHTS.map((w) => <Row key={w.id} title={w.label} on={(st.weight || 0) === w.id} onClick={() => { editEl(sel, { weight: w.id }); setSelMenu(null); }} />),
          deco: [
            <Row key="i" title="Italic" on={Boolean(st.italic)} onClick={() => editEl(sel, { italic: !st.italic })} />,
            <Row key="u" title="Underline" on={Boolean(st.underline)} onClick={() => editEl(sel, { underline: !st.underline })} />,
            <Row key="s" title="Crossed out" on={Boolean(st.strike)} onClick={() => editEl(sel, { strike: !st.strike })} />,
          ],
          align: ['left', 'center', 'right'].map((a) => <Row key={a} icon={`align-${a}`} title={a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)} on={(st.align || 'left') === a} onClick={() => { editEl(sel, { align: a }); setSelMenu(null); }} />),
          color: ['ink', 'accent', 'ground', 'white'].map((c) => {
            const set = setOf(slide, now.custom);
            const hex = c === 'white' ? '#fff' : set[c];
            return (
              <Row key={c} title={c === 'ink' ? 'Primary' : c === 'ground' ? 'Neutral' : c[0].toUpperCase() + c.slice(1)} on={st.color === c} onClick={() => { editEl(sel, { color: c }); setSelMenu(null); }}>
                <span className="exm__dot" style={{ background: hex }} />
              </Row>
            );
          }),
        })[id]}</div>}
      </span>
    );
    return (
      <div className="exsb" role="toolbar" aria-label={`Edit the ${name}`} style={selAt ? { top: selAt.top, left: selAt.left } : undefined} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="exsb__btn exsb__btn--x" onClick={() => { setSel(null); setSelMenu(null); }} aria-label="Close"><Icon name="x" size={13} /></button>
        <button type="button" className="exsb__btn" onClick={() => { setSel(null); pickTool('ask'); }} aria-label="Ask for changes" title="Ask for changes"><Icon name="wand" size={14} /></button>
        {drop('size', `${name[0].toUpperCase() + name.slice(1)} size`, <span className="exsb__aa">Aa</span>)}
        {drop('weight', `${name[0].toUpperCase() + name.slice(1)} weight`, <Icon name="format-bold" size={14} />)}
        {drop('deco', 'Italic, underline, crossed out', <Icon name="format-underline" size={14} />)}
        {drop('align', `${name[0].toUpperCase() + name.slice(1)} alignment`, <Icon name={`align-${st.align || 'left'}`} size={14} />)}
        {drop('color', 'Text colour', <Icon name="droplet" size={14} />)}
        <i className="exsb__sep" />
        <button type="button" className="exsb__btn" onClick={() => editSlide((s) => {
          const was = original.slides[cur] || {};
          const els = { ...s.els }; delete els[sel];
          return { ...s, els, [sel]: was[sel] ?? s[sel] };
        })} aria-label="Put this element back" title="Put this element back"><Icon name="reset" size={14} /></button>
        <button type="button" className="exsb__btn" onClick={() => { editSlide((s) => ({ ...s, hide: { ...s.hide, [sel]: true } })); setSel(null); }} aria-label={`Remove the ${name}`} title={`Remove the ${name}`}><Icon name="trash" size={14} /></button>
      </div>
    );
  };

  const curLayout = LAYOUTS.find((l) => l.id === layoutOf(slide));
  const caption = tool === 'layout'
    ? <>Layout style: <b>{curLayout?.label}</b></>
    : (TOOLS.find((t) => t.id === tool)?.says ?? REFINE);

  return (
    <div className={`exe${leaving ? ' is-leaving' : ''}${tool ? ` has-${tool}` : ''}`} role="dialog" aria-label="Edit the example post">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        const url = URL.createObjectURL(f);
        editSlide((s) => ({ ...s, photo: url, picture: { at: 'center' }, kind: 'hero', layout: layoutOf(s) === 'type' ? 'bleed' : s.layout }));
        closeTool();
      }} />
      <div className="exe__head">
        <button type="button" className="exe__pill" onClick={onCancel}>Cancel</button>
        {!gen && (
          <div className="exe__mid">
            <button type="button" className="exe__disc" onClick={undo} disabled={hist.i === 0} aria-label="Undo"><Icon name="undo" size={18} /></button>
            <button type="button" className="exe__disc exe__disc--redo" onClick={redo} disabled={hist.i === hist.list.length - 1} aria-label="Redo"><Icon name="undo" size={18} /></button>
            <button type="button" className={`exe__disc${grid ? ' is-on' : ''}`} onClick={() => { setGrid((g) => !g); closeTool(); }} aria-label={grid ? 'Show one slide' : 'Show all slides'} aria-pressed={grid}><Icon name="grid" size={18} /></button>
          </div>
        )}
        <button type="button" className="exe__pill exe__pill--ink" onClick={() => onDone(now)}>Done</button>
      </div>

      {grid ? (
        <div className="exe__grid">
          {slides.map((s, k) => (
            <button type="button" key={k} className={`exe__cell${k === cur ? ' is-on' : ''}`} onClick={() => { go(k); setGrid(false); }} aria-label={`Edit slide ${k + 1}`}>
              <ExampleSlide slide={s} custom={now.custom} />
              <span className="exe__cell-n">{k + 1}</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          {!gen && <span className="exe__badge">Slide {cur + 1}/{slides.length}</span>}
          <div className="exe__stage">
            <button type="button" className="exe__arrow" style={cur > 0 && !gen ? undefined : { visibility: 'hidden' }} onClick={() => go(cur - 1)} aria-label="Previous slide"><Icon name="arrow-left" size={18} /></button>
            <div className={`exe__slide${gen ? ' is-gen' : ''}`} ref={slideBox}>
              <ExampleSlide
                slide={slide}
                custom={now.custom}
                n={cur + 1}
                of={slides.length}
                selected={sel}
                editing={editing}
                onSelect={gen ? null : (k) => { setSel(k); setSelMenu(null); if (k && tool !== 'ask') closeTool(); }}
                onEdit={(k) => { setSel(k); setEditing(k); requestAnimationFrame(() => {
                  const node = document.querySelector(`.exe .exs [data-el="${k}"]`);
                  if (!node) return;
                  node.focus({ preventScroll: true });
                  const r = document.createRange(); r.selectNodeContents(node); r.collapse(false);
                  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
                }); }}
                onText={(k, text) => { setEditing(null); if (text && text !== slide[k]) editSlide((s) => ({ ...s, [k]: text })); }}
              />
              {sel && !gen && selBar()}
              {gen && (
                <div className="exe__gen" role="status">
                  <Icon name="file-plus" size={18} />
                  <span className="exe__gen-say">{gen}</span>
                  <button type="button" className="exe__stop" onClick={() => { clearTimeout(genT.current); setGen(null); }}>
                    <span className="exe__stop-mark" aria-hidden="true" /> Stop this
                  </button>
                </div>
              )}
            </div>
            <button type="button" className="exe__arrow" style={cur < slides.length - 1 && !gen ? undefined : { visibility: 'hidden' }} onClick={() => go(cur + 1)} aria-label="Next slide"><Icon name="arrow-right" size={18} /></button>
          </div>
          {!gen && (
            <div className="exe__tools">
              <span className="exe__say">{caption}</span>
              <div className="exe__discs">
                {(tool === 'colour' || tool === 'add' || tool === 'more') && (
                  <div className={`exe__pop exe__pop--${tool}`}>
                    {tool === 'colour' ? colourMenu() : tool === 'add' ? addMenu() : moreMenu()}
                  </div>
                )}
                {TOOLS.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={`exe__disc exe__disc--tool${tool === t.id ? ' is-on' : ''}`}
                    onClick={() => pickTool(t.id)}
                    aria-label={tool === t.id ? `Close ${t.says}` : t.label}
                    aria-expanded={tool === t.id}
                    title={t.says}
                  >
                    <Icon name={tool === t.id ? 'x' : t.icon} size={19} />
                  </button>
                ))}
              </div>
              {tool === 'layout' && (
                <div className="exe__rail" role="listbox" aria-label="Layout style">
                  {LAYOUTS.map((l) => {
                    const on = l.id === curLayout?.id;
                    const can = !l.photo || Boolean(slide.photo);
                    return (
                      <span className="exe__railhold" key={l.id}>
                        <button type="button" role="option" aria-selected={on} className={`exe__lay${on ? ' is-on' : ''}${layPick === l.id ? ' is-picked' : ''}`} disabled={!can} aria-label={l.label} title={l.label}
                          onClick={() => { if (!on) setLayPick((p) => (p === l.id ? null : l.id)); }}>
                          <Wire id={l.id} />
                          {on && <span className="exe__lay-cur">Current</span>}
                        </button>
                        {layPick === l.id && (
                          <Menu className="exm--lay">
                            <Row icon="file-plus" title="Apply layout to this slide" sub="The others keep theirs" onClick={() => generate('Generating layout…', () => editSlide((s) => ({ ...s, layout: l.id, kind: l.id === 'type' ? 'type' : 'hero', pos: undefined })))} />
                            <Row icon="copy" title="Apply layout to all slides" sub="The whole carousel takes it" onClick={() => generate('Generating layout…', () => commit({ ...now, slides: slides.map((s) => (l.photo && !s.photo ? s : { ...s, layout: l.id, kind: l.id === 'type' ? 'type' : 'hero', pos: undefined })) }))} />
                          </Menu>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {tool === 'ask' && (
                <form className="exe__ask" onSubmit={(e) => { e.preventDefault(); sendAsk(); }}>
                  <Icon name="plus" size={16} />
                  <input ref={askRef} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={askShow ?? 'Ask for a change…'} aria-label="Ask Bauhly for a change" />
                  <span className="exe__ask-mic" aria-hidden="true"><Icon name="mic" size={16} /></span>
                  <button type="submit" className="exe__ask-go" disabled={!ask.trim()} aria-label="Send"><Icon name="arrow-up" size={15} strokeWidth={2.2} /></button>
                </form>
              )}
            </div>
          )}
        </>
      )}
      {toast && <div className="exe__toast" role="status"><Icon name="check" size={13} strokeWidth={2.4} /> {toast}</div>}
    </div>
  );
}
