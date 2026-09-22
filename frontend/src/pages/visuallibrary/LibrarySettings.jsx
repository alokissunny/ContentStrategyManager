/*
 * Brand Kit — the studio's visual identity, in one page (formerly "Library
 * Settings"). A faithful port of bauhly-v3's `pages/app/brandkit/` look (see
 * [[bauhly-v3-design-source]]), wired to the LIVE model and backend:
 *
 *   · themes / palette / type / fonts / logo position  → `libraryEdits`
 *     (identity.js), autosaved through the store on every change;
 *   · logos and Visual Mood images                     → S3 (api/visualBrand),
 *     written through the moment they land, exactly as before.
 *
 * IT AUTOSAVES. There is no page-level Save or "Update Library": a change is
 * written the moment it is made. Colour edits hold a local copy behind the
 * popover's Cancel / Done; everything else is immediate.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../brand/Icon.jsx';
import { useStore, setState } from '../../lib/store.js';
import {
  TYPE_SLOTS, COLOUR_ROLES, DEFAULT_PALETTE, THEME_CAP, identityOf, paintOf, slotFace,
  facesWith, registerFont, newThemeId, nextThemeName, activeThemeOf, commitIdentity,
  LOGO_SLOTS, LOGO_POSITIONS, markForTone,
} from '../../lib/identity.js';
import { uploadLogo, listLogos, deleteLogo } from '../../api/visualBrand.js';
import { BrandMark } from './BrandMark.jsx';
import {
  SectionCard, TileMenu, Pager, DefaultChip, RenamePopover, ColourPopover, ExampleTile, usePager,
} from './brandkitBits.jsx';
import Backgrounds from './Backgrounds.jsx';
import VisualMood from './VisualMood.jsx';
import './visuallibrary.css';
import './librarysettings.css';
import './brandkit.css';

/* how many fonts of their own a studio may carry (identity's own cap) */
const FONT_SLOTS = 3;

/* short corner codes so the position cards can draw the right corner
   (`.bk-position--tl` …); the live ids are the long form */
const POS_CODE = { 'top-left': 'tl', 'top-right': 'tr', 'bottom-left': 'bl', 'bottom-right': 'br' };

/* ── LIVE PREVIEW ──────────────────────────────────────────────────────────
 * Four real library compositions in the library's own CSS, so the page shows
 * what the library draws rather than a drawing of it. */
const PREVIEWS = [
  { eyebrow: 'Hook', kind: 'statement', tone: 'ground', art: { eyebrow: 'Prinsengracht', head: 'Beautiful projects aren’t enough', accent: 'anymore.' } },
  { eyebrow: 'Explanation', kind: 'steps', tone: 'ground', art: { head: '3 things to get right in your next project.', items: ['The light', 'The floor', 'The one wall'] } },
  { eyebrow: 'Evidence', kind: 'statement', tone: 'ground', art: { eyebrow: 'Case study', head: 'From empty space to a home that', accent: 'feels like them.' } },
  { eyebrow: 'CTA', kind: 'stat', tone: 'accent', art: { big: '70%', body: 'of clients choose designers who show their process.' } },
];

function Preview({ eyebrow, kind, tone, art, logos, logoPosition }) {
  const mark = markForTone(logos, tone);
  return (
    <div className="bk-prev">
      <span className="bk-prev__label">{eyebrow}</span>
      <span className={`vl-a vl-a--${kind} vl-a--${tone}`}>
        {kind === 'stat' ? (
          <>
            <span className="vl-big">{art.big}</span>
            <span className="vl-w__b">{art.body}</span>
          </>
        ) : kind === 'steps' ? (
          <>
            <span className="vl-w__h">{art.head}</span>
            <span className="vl-list">
              {art.items.map((t, i) => (
                <span key={t} className="vl-list__row"><i>{String(i + 1).padStart(2, '0')}</i>{t}</span>
              ))}
            </span>
          </>
        ) : (
          <span className="vl-w">
            {art.eyebrow && <span className="vl-w__eyebrow">{art.eyebrow}</span>}
            <span className="vl-w__h">
              {art.head}
              {art.accent && <><br /><em>{art.accent}</em></>}
            </span>
          </span>
        )}
        <BrandMark mark={mark} position={logoPosition} />
      </span>
    </div>
  );
}

/* ── THEME SETS ────────────────────────────────────────────────────────────
 * One set → the three colours expanded, full width, no carousel. Two or more →
 * a compact row per set with its swatches, name, the Default mark and a ⋯. */
const PAGE = 3;
const roleHex = (theme, roleId) => theme.palette[roleId] || DEFAULT_PALETTE[roleId];

function Swatches({ theme, onPick }) {
  const refs = useRef({});
  return (
    <span className="bk-swatches bk-swatches--md">
      {COLOUR_ROLES.map((r) => {
        const hex = roleHex(theme, r.id);
        return (
          <button
            key={r.id}
            ref={(el) => { refs.current[r.id] = el; }}
            type="button"
            className="bk-swatch bk-swatch--btn"
            style={{ background: hex }}
            aria-label={`${r.label} — ${hex.toUpperCase()}`}
            title={`${r.label} · ${hex.toUpperCase()}`}
            onClick={(e) => { e.stopPropagation(); onPick(r, refs.current[r.id]); }}
          />
        );
      })}
    </span>
  );
}

/* the three colours as big cards — the single-set view */
function ColorRoles({ theme, onHex, size = 'md' }) {
  const [colour, setColour] = useState(null); // { role, anchor }
  const refs = useRef({});
  return (
    <div className={`bk-roles ${size === 'lg' ? 'bk-roles--lg' : ''}`}>
      {COLOUR_ROLES.map((r) => {
        const hex = roleHex(theme, r.id);
        return (
          <div className="bk-role" key={r.id}>
            <button
              ref={(el) => { refs.current[r.id] = el; }}
              type="button"
              className="bk-swatch bk-swatch--card"
              style={{ background: hex }}
              aria-label={`${r.label} — ${hex.toUpperCase()}`}
              onClick={() => setColour({ role: r, anchor: refs.current[r.id] })}
            />
            <b>{r.label}</b>
            <em>{hex.toUpperCase()}</em>
            <span className="bk-role__use">{r.use}</span>
          </div>
        );
      })}
      {colour && (
        <ColourPopover
          anchor={colour.anchor}
          role={colour.role}
          value={roleHex(theme, colour.role.id)}
          onClose={() => setColour(null)}
          onDone={(hex) => { onHex(colour.role.id, hex); setColour(null); }}
        />
      )}
    </div>
  );
}

function ThemeSets({ themes, activeThemeId, onHex, onRename, onDefault, onDuplicate, onDelete, onAdd }) {
  const { page, pages, setPage, slice } = usePager(themes.length, PAGE);
  const [colour, setColour] = useState(null); // { themeId, role, anchor }
  const [renaming, setRenaming] = useState(null); // theme id
  const rowRefs = useRef({});
  const singleRef = useRef(null);
  const single = themes.length === 1;
  const rows = slice(themes);
  const renamingTheme = renaming ? themes.find((t) => t.id === renaming) : null;
  const colourTheme = colour ? themes.find((t) => t.id === colour.themeId) : null;

  const act = (t, id) => {
    if (id === 'rename') setRenaming(t.id);
    if (id === 'default') onDefault(t.id);
    if (id === 'duplicate') onDuplicate(t.id);
    if (id === 'delete') onDelete(t.id);
  };
  const add = () => {
    const id = onAdd();
    if (id) { setPage(Math.floor(themes.length / PAGE)); setRenaming(id); }
  };

  return (
    <SectionCard
      title="Theme sets"
      lead="Manage the colour themes Bauhly can use across your content."
      className="bk-card--themes"
      action={(
        <button type="button" className="btn btn--tertiary btn--sm" onClick={add} disabled={themes.length >= THEME_CAP} title={themes.length >= THEME_CAP ? `There is room for ${THEME_CAP} themes` : undefined}>
          <Icon name="plus" size={15} strokeWidth={2.5} />
          Add theme
        </button>
      )}
    >
      {single ? (
        <div className="bk-single" ref={singleRef}>
          <div className="bk-single-head">
            <span className="bk-single-head__name">{themes[0].name}</span>
            <TileMenu
              label={`More for ${themes[0].name}`}
              items={[
                { id: 'rename', label: 'Rename', icon: 'edit' },
                { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
                { id: 'delete', label: 'Delete', icon: 'trash', danger: true, disabled: true },
              ]}
              onPick={(id) => act(themes[0], id)}
            />
          </div>
          <ColorRoles theme={themes[0]} onHex={(roleId, hex) => onHex(themes[0].id, roleId, hex)} size="lg" />
        </div>
      ) : (
        <>
          <ul className="bk-themes">
            {rows.map((t) => {
              const isDefault = t.id === activeThemeId;
              return (
                <li key={t.id} className="bk-theme" ref={(el) => { rowRefs.current[t.id] = el; }}>
                  <Swatches theme={t} onPick={(role, anchor) => setColour({ themeId: t.id, role, anchor })} />
                  <span className="bk-theme__text">
                    <b>{t.name}{isDefault && <DefaultChip />}</b>
                    <span>{t.note || 'Colour theme'}</span>
                  </span>
                  <TileMenu
                    label={`More for ${t.name}`}
                    className="bk-more--row"
                    items={[
                      { id: 'rename', label: 'Rename', icon: 'edit' },
                      { id: 'default', label: 'Set as default', icon: 'check', disabled: isDefault },
                      { id: 'duplicate', label: 'Duplicate', icon: 'copy' },
                      { id: 'delete', label: 'Delete', icon: 'trash', danger: true, disabled: themes.length <= 1 },
                    ]}
                    onPick={(id) => act(t, id)}
                  />
                </li>
              );
            })}
          </ul>
          <Pager page={page} pages={pages} onPage={setPage} label="Theme sets" />
        </>
      )}
      {colourTheme && (
        <ColourPopover
          anchor={colour.anchor}
          role={colour.role}
          value={roleHex(colourTheme, colour.role.id)}
          onClose={() => setColour(null)}
          onDone={(hex) => { onHex(colour.themeId, colour.role.id, hex); setColour(null); }}
        />
      )}
      {renamingTheme && (
        <RenamePopover
          anchor={single ? (() => singleRef.current) : (() => rowRefs.current[renamingTheme.id])}
          title="Rename theme"
          name={renamingTheme.name}
          note={renamingTheme.note || ''}
          onClose={() => setRenaming(null)}
          onDone={(v) => { onRename(renamingTheme.id, v); setRenaming(null); }}
        />
      )}
    </SectionCard>
  );
}

/* ── TYPOGRAPHY ────────────────────────────────────────────────────────────
 * Three faces, each a dropdown. Bauhly's own faces ship; the studio's own live
 * in the menu with a ✕ each, and "Add font" sits on the card's title row. */
function FontField({ slot, current, faces, onPick, onDrop }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const field = useRef(null);
  const toggle = () => {
    setOpen((was) => {
      if (!was) {
        const box = field.current?.getBoundingClientRect();
        const need = Math.min(320, 56 + (faces.length * 44));
        setUp(Boolean(box) && window.innerHeight - box.bottom < need && box.top > need);
      }
      return !was;
    });
  };
  const chosen = faces.find((f) => f.id === current) || faces[0];
  return (
    <div className="bk-type">
      <span className="bk-type__label">{slot.label}</span>
      <span className={`bk-type__wrap ${up ? 'is-up' : ''}`} ref={field}>
        <button type="button" className="bk-type__btn" aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
          <span style={{ fontFamily: chosen.stack }}>{chosen.label}</span>
          <Icon name="chevron-down" size={15} strokeWidth={2.25} />
        </button>
        {open && (
          <>
            <span className="bk-scrim" onClick={() => setOpen(false)} />
            <span className="pe-menu bk-fontmenu" role="listbox" aria-label={slot.label}>
              {faces.map((f, i) => (
                <span className="bk-fontmenu__row" key={f.id}>
                  {f.own && !faces[i - 1]?.own && <span className="pe-menu__sep" />}
                  <button type="button" className={`bk-fontmenu__opt ${f.id === current ? 'is-on' : ''}`} role="option" aria-selected={f.id === current} style={{ fontFamily: f.stack }} onClick={() => { onPick(f.id); setOpen(false); }}>
                    {f.label}
                    {f.id === current && <Icon name="check" size={14} strokeWidth={2.5} />}
                  </button>
                  {f.own && (
                    <button type="button" className="bk-fontmenu__x" aria-label={`Remove ${f.label}`} onClick={() => onDrop(f.id)}>
                      <Icon name="x" size={12} strokeWidth={2.5} />
                    </button>
                  )}
                </span>
              ))}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

function Typography({ draft, faces, canAdd, onPick, onDrop, onAdd }) {
  return (
    <SectionCard
      title="Typography"
      lead="Choose the fonts for your brand."
      className="bk-card--type"
      action={canAdd ? (
        <label className="btn btn--tertiary btn--sm">
          <Icon name="plus" size={15} strokeWidth={2.5} />
          Add font
          <input
            type="file"
            accept=".woff,.woff2,.ttf,.otf,font/*"
            hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onAdd(f); }}
          />
        </label>
      ) : null}
    >
      <div className="bk-types">
        {TYPE_SLOTS.map((slot) => (
          <FontField
            key={slot.id}
            slot={slot}
            current={slotFace(draft, slot)}
            faces={faces}
            onPick={(faceId) => onPick(slot.id, faceId)}
            onDrop={onDrop}
          />
        ))}
      </div>
    </SectionCard>
  );
}

/* ── LOGOS ─────────────────────────────────────────────────────────────────
 * The four named slots, always all four: filled slots show the mark, empty
 * slots stand as pressable examples. Position appears once a real logo exists. */
function Logos({ logos, logoPosition, busy, onUpload, onRemove, onPosition }) {
  const pending = useRef(null);
  const inputRef = useRef(null);
  const openFor = (slot) => { pending.current = slot.id; inputRef.current?.click(); };
  const onFile = (f) => { const id = pending.current; pending.current = null; if (id && f) onUpload(id, f); };

  const tiles = (
    <ul className="bk-tiles bk-tiles--logos">
      {LOGO_SLOTS.map((slot) => {
        const file = logos[slot.id];
        /* the reference labels an inverted slot with a middle dot */
        const label = slot.label.replace(/ inverted$/, ' · inverted');
        return file?.url ? (
          <li key={slot.id} className={`bk-tile bk-tile--logo ${slot.inverted ? 'is-dark' : ''}`}>
            <span className="bk-tile__art">
              <span className="bk-tile__slot">{label}</span>
              <img src={file.url} alt={label} className="bk-asset bk-asset--contain" draggable="false" />
              <TileMenu
                label={`More for ${label}`}
                items={[
                  { id: 'replace', label: 'Replace', icon: 'refresh' },
                  { id: 'remove', label: 'Remove', icon: 'trash', danger: true },
                ]}
                onPick={(id) => (id === 'replace' ? openFor(slot) : onRemove(slot.id))}
              />
            </span>
          </li>
        ) : (
          <ExampleTile key={slot.id} tone={slot.inverted ? 'dark' : 'light'} slot={label} onClick={() => openFor(slot)}>
            <span className="bk-example__word">{slot.kind === 'mark' ? 'B' : 'bauhly'}<i>.</i></span>
          </ExampleTile>
        );
      })}
    </ul>
  );

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/png,image/svg+xml,image/webp,image/jpeg,image/*"
      hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }}
    />
  );

  return (
    <SectionCard title="Logos" lead="Add your full logo and symbol, in regular and inverted versions." className="bk-card--logos">
      {input}
      {/* The two-column layout (tiles on the left, position on the right) is
          always shown so the section keeps the reference's proportions whether
          or not a logo has been uploaded — empty slots stay compact instead of
          stretching to the full card width. */}
      <div className="bk-logos">
        {tiles}
        <div className="bk-logos__pos" role="radiogroup" aria-label="Logo position">
          <span className="bk-logos__poslabel">Logo position</span>
          <div className="bk-positions">
            {LOGO_POSITIONS.map((p) => {
              const on = logoPosition === p.id;
              return (
                <label key={p.id} className={`bk-position bk-position--${POS_CODE[p.id] || 'tl'} ${on ? 'is-on' : ''}`}>
                  <input type="radio" name="bk-logo-position" value={p.id} checked={on} onChange={() => onPosition(p.id)} />
                  <span className="bk-position__card" aria-hidden="true"><i /></span>
                  <span className="bk-position__name">{p.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

export default function BrandKit() {
  const s = useStore();
  const saved = useMemo(() => identityOf(s), [s]);

  const [draft, setDraft] = useState(() => ({
    themes: saved.themes.map((t) => ({ ...t, palette: { ...t.palette } })),
    activeThemeId: saved.activeThemeId,
    type: JSON.parse(JSON.stringify(saved.type || {})),
    fonts: [...(saved.fonts || [])],
    logos: { ...(s.brandLogos || {}) },
    logoPosition: saved.logoPosition,
  }));
  const [toast, setToast] = useState(null);
  const note = (text) => setToast({ kind: 'note', text });

  /* ── AUTOSAVE (Sep 2026) ────────────────────────────────────────────────
   * Every identity change (themes, palette, type, fonts, logo position) is
   * written through to `libraryEdits` — the blob the whole app paints from —
   * shortly after it settles. Debounced so a colour drag does not spam the
   * backend; flushed on unmount so the last edit is never lost. Logos and mood
   * images write through on their own the moment they land (S3). */
  const identSig = JSON.stringify({
    themes: draft.themes,
    activeThemeId: draft.activeThemeId,
    type: draft.type,
    fonts: (draft.fonts || []).map((f) => ({ id: f.id, name: f.name })),
    logoPosition: draft.logoPosition,
  });
  /* the last identity actually written, so an unchanged commit (a mount, a
     StrictMode re-run, a store hydrate) never triggers a needless backend PUT */
  const lastSaved = useRef(null);
  if (lastSaved.current === null) lastSaved.current = JSON.stringify(commitIdentity(draft));
  const pendingWrite = useRef(null);
  useEffect(() => {
    const next = commitIdentity(draft);
    const sig = JSON.stringify(next);
    if (sig === lastSaved.current) { pendingWrite.current = null; return undefined; }
    pendingWrite.current = { next, sig };
    const t = window.setTimeout(() => {
      if (!pendingWrite.current) return;
      setState({ libraryEdits: pendingWrite.current.next });
      lastSaved.current = pendingWrite.current.sig;
      pendingWrite.current = null;
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identSig]);
  /* flush a pending edit if the studio leaves before the debounce fires */
  useEffect(() => () => {
    if (pendingWrite.current) { setState({ libraryEdits: pendingWrite.current.next }); lastSaved.current = pendingWrite.current.sig; }
  }, []);

  const previewVars = paintOf(draft);

  /* ── themes ── */
  const setThemeHex = (themeId, roleId, hex) => setDraft((d) => ({
    ...d, themes: d.themes.map((t) => (t.id === themeId ? { ...t, palette: { ...t.palette, [roleId]: hex } } : t)),
  }));
  const renameThemeFull = (id, { name, note }) => setDraft((d) => ({
    ...d, themes: d.themes.map((t) => (t.id === id ? { ...t, name: name || t.name, note } : t)),
  }));
  const setDefaultTheme = (id) => setDraft((d) => (d.themes.some((t) => t.id === id) ? { ...d, activeThemeId: id } : d));
  const duplicateTheme = (id) => setDraft((d) => {
    const t = d.themes.find((x) => x.id === id);
    if (!t) return d;
    const copy = { id: newThemeId(), name: `${t.name} copy`.slice(0, 40), note: t.note || '', palette: { ...t.palette } };
    const at = d.themes.findIndex((x) => x.id === id);
    return { ...d, themes: [...d.themes.slice(0, at + 1), copy, ...d.themes.slice(at + 1)] };
  });
  const dropTheme = (id) => setDraft((d) => {
    if (d.themes.length <= 1) return d;
    const themes = d.themes.filter((t) => t.id !== id);
    const activeThemeId = d.activeThemeId === id ? themes[0].id : d.activeThemeId;
    return { ...d, themes, activeThemeId };
  });
  /* returns the new theme's id so Theme sets can open Rename on it */
  const addTheme = () => {
    if (draft.themes.length >= THEME_CAP) {
      setToast({ kind: 'note', text: `There is room for ${THEME_CAP} themes — remove one to add another.` });
      return null;
    }
    const base = activeThemeOf(draft);
    const id = newThemeId();
    setDraft((d) => ({ ...d, themes: [...d.themes, { id, name: nextThemeName(d.themes), note: '', palette: { ...base.palette } }] }));
    return id;
  };

  /* ── type / fonts ── */
  const faces = facesWith(draft.fonts);
  const setSlot = (slotId, faceId) => setDraft((d) => ({ ...d, type: { ...d.type, [slotId]: { ...(d.type[slotId] || {}), face: faceId } } }));
  const addFont = (f) => {
    if (!f) return;
    if (draft.fonts.length >= FONT_SLOTS) {
      setToast({ kind: 'note', text: `There is room for ${FONT_SLOTS} fonts of your own — remove one to add another.` });
      return;
    }
    const name = f.name.replace(/\.(woff2?|ttf|otf)$/i, '').replace(/[-_]+/g, ' ').trim() || 'Custom font';
    const url = URL.createObjectURL(f);
    registerFont(name, url).then((ok) => {
      if (!ok) { setToast({ kind: 'note', text: `${name} could not be read — it needs to be a .woff2, .woff, .ttf or .otf file.` }); return; }
      setDraft((d) => (d.fonts.length >= FONT_SLOTS ? d : { ...d, fonts: [...d.fonts, { id: `own-${Date.now()}`, name, url }] }));
    });
  };
  const dropFont = (id) => setDraft((d) => ({
    ...d,
    fonts: d.fonts.filter((f) => f.id !== id),
    type: Object.fromEntries(Object.entries(d.type).filter(([, v]) => v.face !== id)),
  }));

  /* ── logos (S3) ── */
  const [logoBusy, setLogoBusy] = useState(null);
  const logosRef = useRef(draft.logos);
  useEffect(() => { logosRef.current = draft.logos; }, [draft.logos]);
  const setLogos = (next) => {
    logosRef.current = next;
    setDraft((d) => ({ ...d, logos: next }));
    setState({ brandLogos: next });
  };
  const setLogoPosition = (id) => setDraft((d) => ({ ...d, logoPosition: id }));
  const addLogo = async (slotId, f) => {
    if (!f) return;
    const localUrl = URL.createObjectURL(f);
    const prev = logosRef.current[slotId];
    setLogos({ ...logosRef.current, [slotId]: { ...(prev || {}), url: localUrl, title: f.name, uploading: true } });
    setLogoBusy(slotId);
    try {
      const next = await uploadLogo(slotId, f);
      setLogos({ ...next, [slotId]: { ...(next[slotId] || {}), url: localUrl } });
    } catch (err) {
      const revert = { ...logosRef.current };
      if (prev) revert[slotId] = prev; else delete revert[slotId];
      setLogos(revert);
      setToast({ kind: 'note', text: 'Bauhly could not save that logo. Please try again.' });
    } finally {
      setLogoBusy(null);
    }
  };
  const dropLogo = (slotId) => {
    const next = { ...logosRef.current };
    delete next[slotId];
    setLogos(next);
    deleteLogo(slotId).catch(() => {});
  };

  /* the logos are the one S3-backed thing this component still loads itself;
     Backgrounds and Visual Mood are self-contained sections with their own
     backend calls (api/visualBrand). */
  useEffect(() => {
    let alive = true;
    listLogos()
      .then((slots) => { if (alive) setLogos(slots); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast || toast.kind === 'busy') return undefined;
    const t = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* ── the live-preview carousel (phone) ── */
  const railRef = useRef(null);
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const max = el.scrollWidth - el.clientWidth;
      setSlide(max <= 1 ? 0 : Math.round((el.scrollLeft / max) * (PREVIEWS.length - 1)));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  const goSlide = (i) => {
    const el = railRef.current;
    const child = el?.children[i];
    if (!el || !child) return;
    const pad = parseFloat(window.getComputedStyle(el).paddingLeft) || 0;
    el.scrollBy({ left: child.getBoundingClientRect().left - el.getBoundingClientRect().left - pad, behavior: 'smooth' });
  };

  return (
    <div className="bk">
      <header className="bk-head">
        <div className="bk-head__text">
          <span className="eyebrow">Settings</span>
          <h1 className="bk-head__title">Brand Kit</h1>
          <p className="bk-head__lead">Edit your brand visuals below. Changes apply to every layout and plan as you make them.</p>
        </div>
      </header>

      {/* ── LIVE PREVIEW ── */}
      <section className="bk-card bk-card--preview">
        <div className="bk-card__head">
          <div className="bk-card__text">
            <h2 className="bk-card__title">Live preview</h2>
          </div>
        </div>
        <div className="bk-prevs" style={previewVars} ref={railRef}>
          {PREVIEWS.map((p) => (
            <Preview key={p.eyebrow} {...p} logos={draft.logos} logoPosition={draft.logoPosition} />
          ))}
        </div>
        <div className="bk-dots" role="tablist" aria-label="Live preview">
          {PREVIEWS.map((p, i) => (
            <button
              key={p.eyebrow}
              type="button"
              className={`bk-dot ${i === slide ? 'is-on' : ''}`}
              role="tab"
              aria-selected={i === slide}
              aria-label={p.eyebrow}
              onClick={() => goSlide(i)}
            />
          ))}
        </div>
      </section>

      {/* ── THEME SETS + TYPOGRAPHY ── */}
      <div className="bk-pair">
        <ThemeSets
          themes={draft.themes}
          activeThemeId={draft.activeThemeId}
          onHex={setThemeHex}
          onRename={renameThemeFull}
          onDefault={setDefaultTheme}
          onDuplicate={duplicateTheme}
          onDelete={dropTheme}
          onAdd={addTheme}
        />
        <Typography
          draft={draft}
          faces={faces}
          canAdd={draft.fonts.length < FONT_SLOTS}
          onPick={setSlot}
          onDrop={dropFont}
          onAdd={addFont}
        />
      </div>

      {/* ── LOGOS ── */}
      <Logos
        logos={draft.logos}
        logoPosition={draft.logoPosition}
        busy={logoBusy}
        onUpload={addLogo}
        onRemove={dropLogo}
        onPosition={setLogoPosition}
      />

      {/* ── BACKGROUNDS ── */}
      <Backgrounds onNote={note} />

      {/* ── VISUAL MOOD (sets) ── */}
      <VisualMood onNote={note} />

      {/* ── the toast ── */}
      {toast && createPortal(
        <div className={`ls-toast ${toast.kind === 'busy' ? 'is-busy' : ''}`} role="status">
          <span className="ls-toast__row">
            <Icon name={toast.kind === 'busy' ? 'refresh' : toast.kind === 'done' ? 'check' : 'info'} size={17} strokeWidth={2.25} />
            <span className="ls-toast__text">{toast.text}</span>
          </span>
          <button className="ls-toast__x" aria-label="Dismiss" onClick={() => setToast(null)}>
            <Icon name="x" size={14} strokeWidth={2.5} />
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
