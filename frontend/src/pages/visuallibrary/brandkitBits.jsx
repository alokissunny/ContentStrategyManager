/*
 * The small parts every Brand Kit section is built from — ported from
 * bauhly-v3's `pages/app/brandkit/bits.jsx` + `hooks.jsx` (see the
 * [[bauhly-v3-design-source]]), adapted to the live app: assets resolve to a
 * plain URL (S3/object URL) rather than through a media repository, and the
 * icons come from `brand/Icon.jsx`.
 *
 *   SectionCard   the card, its title row and the one action top-right
 *   Popover       ONE floating surface for every menu and editor on the page,
 *                 portalled to the body so no card's overflow can clip it
 *   MenuPopover   the menu a ⋯ opens
 *   TileMenu      the ⋯ on a tile or a row, and the menu it opens
 *   Pager         prev / dots / next under a paged list
 *   DefaultChip   the small "Default" mark
 *   ExampleTile   an empty slot that IS the button to fill it
 *   TextField     label + input, used by Rename
 *   EditorActions Cancel · Done under a temporary editor
 *   RenamePopover name + description in a popover
 *   ColourPopover one role, one colour
 *   usePager / useFilePick   the shared hooks
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon.jsx';

export function SectionCard({ title, lead, action, className = '', children }) {
  return (
    <section className={`bk-card ${className}`}>
      <div className="bk-card__head">
        <div className="bk-card__text">
          <h2 className="bk-card__title">{title}</h2>
          {lead && <p className="bk-card__lead">{lead}</p>}
        </div>
        {action && <div className="bk-card__acts">{action}</div>}
      </div>
      {children}
    </section>
  );
}

const elOf = (a) => (typeof a === 'function' ? a() : a && 'current' in a ? a.current : a);

export function Popover({ anchor, align = 'left', place = 'below', onClose, label, role = 'dialog', className = '', children }) {
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  const sheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 560px)').matches;

  useLayoutEffect(() => {
    if (sheet) { setPos({}); return undefined; }
    const settle = () => {
      const a = elOf(anchor);
      const b = box.current;
      if (!a || !b) return;
      const r = a.getBoundingClientRect();
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      const gap = 8;
      if (place === 'side') {
        let side = r.right + gap;
        if (side + w > window.innerWidth - 8) side = r.left - gap - w;
        setPos({
          left: Math.max(8, Math.min(side, window.innerWidth - w - 8)),
          top: Math.max(8, Math.min(r.top, window.innerHeight - h - 8)),
        });
        return;
      }
      let left = align === 'right' ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = r.bottom + gap;
      if (top + h > window.innerHeight - 8 && r.top - gap - h > 8) top = r.top - gap - h;
      setPos({ left, top });
    };
    settle();
    window.addEventListener('resize', settle);
    window.addEventListener('scroll', settle, true);
    return () => { window.removeEventListener('resize', settle); window.removeEventListener('scroll', settle, true); };
  }, [anchor, align, place, sheet]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);

  return createPortal(
    <>
      <span className="bk-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        ref={box}
        className={`bk-pop ${role === 'menu' ? 'pe-menu' : ''} ${sheet ? 'bk-pop--sheet' : ''} ${className}`}
        role={role}
        aria-label={label}
        style={sheet ? undefined : { left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

export function MenuPopover({ anchor, items, onPick, onClose, label = 'More', align = 'right' }) {
  return (
    <Popover anchor={anchor} align={align} role="menu" label={label} className="bk-menu" onClose={onClose}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          className={it.danger ? 'is-danger' : undefined}
          disabled={!!it.disabled}
          onClick={(e) => { e.stopPropagation(); onClose(); onPick(it.id); }}
        >
          {it.icon && <Icon name={it.icon} size={16} strokeWidth={2} />}
          <span className="pe-menu__grow">{it.label}</span>
        </button>
      ))}
    </Popover>
  );
}

export function TileMenu({ items, onPick, label = 'More', align = 'right', className = '' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  return (
    <span className={`bk-more ${className}`}>
      <button
        ref={btn}
        type="button"
        className="bk-more__btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Icon name="more" size={16} strokeWidth={2.25} />
      </button>
      {open && (
        <MenuPopover anchor={btn} align={align} label={label} items={items} onPick={onPick} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}

export function Pager({ page, pages, onPage, label }) {
  if (pages <= 1) return null;
  return (
    <div className="bk-pager" role="group" aria-label={label}>
      <button type="button" className="bk-pager__arrow" aria-label="Previous" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <Icon name="chevron-left" size={16} strokeWidth={2.25} />
      </button>
      <span className="bk-pager__dots">
        {Array.from({ length: pages }, (_, i) => (
          <button key={i} type="button" className={`bk-pager__dot ${i === page ? 'is-on' : ''}`} aria-label={`Page ${i + 1}`} aria-current={i === page ? 'true' : undefined} onClick={() => onPage(i)} />
        ))}
      </span>
      <button type="button" className="bk-pager__arrow" aria-label="Next" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>
        <Icon name="chevron-right" size={16} strokeWidth={2.25} />
      </button>
    </div>
  );
}

export function DefaultChip() {
  return <span className="bk-chip">Default</span>;
}

/* An empty slot shows what belongs in it as an example, and the slot itself is
   the button: press it and the file picker opens for that variant. */
export function ExampleTile({ tone = 'light', slot = null, onClick, className = '', children }) {
  return (
    <li className={`bk-example bk-example--${tone} ${className}`}>
      <button
        type="button"
        className="bk-example__hit"
        onClick={onClick}
        aria-label={slot ? `Add ${slot} logo` : 'Add'}
      >
        <span className="bk-example__art" aria-hidden="true">{children}</span>
        {slot && <span className="bk-example__slot" aria-hidden="true">{slot}</span>}
      </button>
    </li>
  );
}

export function TextField({ label, value, max, placeholder, autoFocus = false, optional = false, onChange }) {
  return (
    <label className="bk-field">
      <span className="bk-field__label">{label}{optional && <em> (optional)</em>}</span>
      <input className="input" value={value} maxLength={max} placeholder={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function EditorActions({ canDone, doneLabel = 'Done', onCancel, onDone }) {
  return (
    <div className="bk-pop__acts">
      <button type="button" className="btn btn--tertiary btn--sm" onClick={onCancel}>Cancel</button>
      <button type="button" className="btn btn--primary btn--sm" disabled={!canDone} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

export function RenamePopover({ anchor, title, name, note, onClose, onDone }) {
  const [n, setN] = useState(name);
  const [d, setD] = useState(note);
  const changed = n.trim() !== name || d.trim() !== note;
  const can = changed && n.trim().length > 0;
  return (
    <Popover anchor={anchor} align="right" label={title} className="bk-pop--editor" onClose={onClose}>
      <span className="bk-pop__title">{title}</span>
      <TextField label="Name" value={n} max={40} autoFocus onChange={setN} />
      <TextField label="Description" value={d} max={120} optional onChange={setD} />
      <EditorActions canDone={can} onCancel={onClose} onDone={() => onDone({ name: n.trim(), note: d.trim() })} />
    </Popover>
  );
}

const asHex = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/* the colour popover: one role, one colour */
export function ColourPopover({ anchor, role, value, onClose, onDone }) {
  const [hex, setHex] = useState(value);
  const [text, setText] = useState(value.toUpperCase());
  const typeHex = (v) => { setText(v.toUpperCase()); const h = asHex(v.trim()); if (h) setHex(h); };
  const changed = hex !== value;
  return (
    <Popover anchor={anchor} align="left" place="side" label={`${role.label} colour`} className="bk-pop--colour" onClose={onClose}>
      <span className="bk-pop__title">{role.label}</span>
      <span className="bk-pop__hint">{role.use}</span>
      <input
        className="bk-picker__field"
        type="color"
        value={hex}
        aria-label="Colour spectrum"
        onChange={(e) => { setHex(e.target.value); setText(e.target.value.toUpperCase()); }}
      />
      <input
        className="bk-picker__hex input"
        type="text"
        value={text}
        spellCheck="false"
        aria-label="Hex value"
        onChange={(e) => typeHex(e.target.value)}
      />
      <EditorActions canDone={changed} onCancel={onClose} onDone={() => onDone(hex)} />
    </Popover>
  );
}

/* pages of `size`; the page follows the list so a delete on the last page
   never leaves an empty one showing */
export function usePager(count, size) {
  const pages = Math.max(1, Math.ceil(count / size));
  const [page, setPage] = useState(0);
  useEffect(() => { if (page > pages - 1) setPage(pages - 1); }, [page, pages]);
  return { page, pages, setPage, slice: (list) => list.slice(page * size, page * size + size) };
}
