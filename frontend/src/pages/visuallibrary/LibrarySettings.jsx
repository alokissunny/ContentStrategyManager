/*
 * Library Settings — the studio's visual identity, in one page.
 *
 * WHAT THIS PAGE IS (Leon, Aug 6–7).
 *
 * Bauhly draws every layout from three things: a palette, a set of type styles,
 * and the pictures the studio has given it. This is the one place all three are
 * edited, and it is ONE page — no tabs, no second editor, no wizard.
 *
 * ── NO THEMES (Leon, Aug 7) ───────────────────────────────────────────────
 *
 * There were four palettes with names, then three, then one. A studio has ONE
 * visual identity; a product that offers a menu of them is asking them to pick a
 * mood for their brand every time they open a page. So the palette is three
 * colours they set directly — background, text, accent — everything else in the
 * system derives from those, and the word "theme" appears nowhere in the UI.
 *
 * ── WHY SAVING IS EXPLICIT HERE, AND ONLY HERE ────────────────────────────
 *
 * Everything else in this product saves as you type. An identity is not one
 * decision but six or seven made together, and a library repainting between each
 * of them would be unreadable while you worked. So edits are a DRAFT — the
 * preview reads it, the library does not. Because a draft can be lost, leaving
 * with one unapplied asks first.
 *
 * ── THERE IS NO SAVE BUTTON (Leon, Aug 7) ─────────────────────────────────
 *
 * There were two commits on this page — Save, and then Update Visual Library —
 * and a studio could not tell what the second one added, because the first had
 * already repainted the library. One page, ONE commit: edits stay pending, a
 * compact note says so, and **Update Visual Library** is the only thing that
 * writes. It asks first, because it changes all of them at once.
 *
 * And it now writes EXACTLY WHAT IS ON SCREEN. It used to re-sample the palette
 * off the reference pictures as it applied, which was defensible while Save
 * existed and is not now: it would silently replace an accent the studio had
 * just chosen by hand. Reading the pictures is its own button in Image References,
 * it edits the DRAFT, and the preview shows the result before anything applies.
 *
 * ── FOUR DEPARTURES FROM THE ORIGINAL REFERENCE, ALL DELIBERATE ───────────
 *
 * 1 · No purple: it was rejected for this product and the primary action is an
 *     ink fill (CLAUDE.md §2, design system §1).
 * 2 · One sidebar, the app's own — a second nav would be the extra configuration
 *     layer the brief rules out.
 * 3 · Counts are read, never repeated from a picture.
 * 4 · No decorative "01 ___" under the previews; that was removed in 490.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../../brand/Icon.jsx';
import { useStore, setState } from '../../lib/store.js';
import { LAYOUTS } from '../../data/layouts.js';
import {
  TYPE_SLOTS, COLOUR_ROLES, DEFAULT_PALETTE, identityOf, paintOf, slotFace,
  facesWith, registerFont,
} from '../../lib/identity.js';
import { analyseNew, pendingOf, forgetRef, paletteFromAnalysis } from '../../lib/refanalysis.js';
import { uploadMoodImages, listMoodImages, deleteMoodImage } from '../../api/visualBrand.js';
import EmptyState from '../../components/ui/EmptyState.jsx';
import './visuallibrary.css';
import './librarysettings.css';

/* ── the colour picker, anchored to the swatch it belongs to ──────────────
 *
 * NO BRAND-COLOUR GRID FIRST (Leon, Aug 7). Pressing a swatch used to open a
 * menu of eight suggested colours with "Pick another" under a separator — so
 * choosing your own colour, which is the whole point of the control, was the
 * last item behind a list of the product's guesses. The grid is gone. Pressing
 * a swatch opens the picker itself.
 *
 * WHY THIS IS STILL A POPOVER and not the OS colour dialog on the swatch: an
 * `<input type="color">` opens a window the browser positions, which cannot be
 * anchored to anything and looks nothing like the rest of the app. This is the
 * app's own `.pe-menu`, anchored under the swatch like every other popover
 * here, holding the two things a colour needs — a spectrum and a hex — both
 * live, so the four previews move as the colour does.
 */
function Picker({ value, onPick, onClose }) {
  const [text, setText] = useState(value);
  /* the hex box accepts what is being TYPED, and only commits when it is a
     real colour — otherwise a half-typed "#1b1" repaints the library */
  const typeHex = (v) => {
    setText(v);
    if (/^#[0-9a-f]{6}$/i.test(v)) onPick(v);
  };
  return (
    <>
      <span className="ls-scrim" onClick={onClose} />
      <span className="pe-menu ls-picker" role="dialog" aria-label="Choose a colour">
        <input
          className="ls-picker__field"
          type="color"
          value={value}
          aria-label="Colour spectrum"
          onChange={(e) => { setText(e.target.value); onPick(e.target.value); }}
        />
        <input
          className="ls-picker__hex"
          type="text"
          value={text}
          spellCheck="false"
          aria-label="Hex value"
          onChange={(e) => typeHex(e.target.value.trim())}
        />
      </span>
    </>
  );
}

/* ── ONE FONT FIELD: A LABEL AND A DROPDOWN, AND NOTHING ELSE (Leon, Aug 7) ─
 *
 * Typography had grown a card of its own material: two rows of chips, a
 * specimen line under each, a strip of three upload slots, a Reset, and a
 * paragraph explaining which faces could be removed. Six controls and a
 * paragraph to answer two questions — what do headings use, what does body use.
 *
 * It is two dropdowns now. Everything that was scattered around them lives
 * INSIDE the menu, where it is only visible to someone already choosing a font:
 * Bauhly's four faces (no remove — they ship with the product), then the
 * studio's own with a ✕ each, then Add a font, which is simply absent at three
 * because an option that cannot be taken is a control that only disappoints. */
function FontField({ slot, current, faces, canAdd, onPick, onDrop, onAdd }) {
  const [open, setOpen] = useState(false);
  const chosen = faces.find((f) => f.id === current) || faces[0];
  return (
    <div className="ls-type">
      <span className="ls-type__label">{slot.label}</span>
      <span className="ls-type__wrap">
        <button
          type="button"
          className="ls-type__btn"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span style={{ fontFamily: chosen.stack }}>{chosen.label}</span>
          <Icon name="chevron-down" size={15} strokeWidth={2.25} />
        </button>
        {open && (
          <>
            <span className="ls-scrim" onClick={() => setOpen(false)} />
            <span className="pe-menu ls-fontmenu" role="listbox" aria-label={slot.label}>
              {faces.map((f, i) => (
                <span className="ls-fontmenu__row" key={f.id}>
                  {/* the first of the studio's own opens a rule above it, so the
                      four that ship and the ones they added read as two groups
                      without a heading over either */}
                  {f.own && !faces[i - 1]?.own && <span className="pe-menu__sep" />}
                  <button
                    type="button"
                    className={`ls-fontmenu__opt ${f.id === current ? 'is-on' : ''}`}
                    role="option"
                    aria-selected={f.id === current}
                    style={{ fontFamily: f.stack }}
                    onClick={() => { onPick(f.id); setOpen(false); }}
                  >
                    {f.label}
                    {f.id === current && <Icon name="check" size={14} strokeWidth={2.5} />}
                  </button>
                  {f.own && (
                    <button
                      type="button"
                      className="ls-fontmenu__x"
                      aria-label={`Remove ${f.label}`}
                      onClick={() => onDrop(f.id)}
                    >
                      <Icon name="x" size={12} strokeWidth={2.5} />
                    </button>
                  )}
                </span>
              ))}
              {canAdd && (
                <>
                  <span className="pe-menu__sep" />
                  <label className="ls-fontmenu__add">
                    <Icon name="plus" size={14} strokeWidth={2.5} />
                    Add a font
                    <input
                      type="file"
                      accept=".woff,.woff2,.ttf,.otf,font/*"
                      hidden
                      onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; setOpen(false); onAdd(file); }}
                    />
                  </label>
                </>
              )}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

/* ── one of the four previews ──────────────────────────────────────────────
 * Real library compositions in the library's own CSS, so the page shows what the
 * library draws rather than a drawing of it. */
function Preview({ eyebrow, kind, tone, art }) {
  return (
    <div className="ls-prev">
      <span className="ls-prev__label">{eyebrow}</span>
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
      </span>
    </div>
  );
}

const PREVIEWS = [
  { eyebrow: 'Hook', kind: 'statement', tone: 'ground', art: { eyebrow: 'Prinsengracht', head: 'Beautiful projects aren’t enough', accent: 'anymore.' } },
  { eyebrow: 'Educational', kind: 'steps', tone: 'ground', art: { head: '3 things to get right in your next project.', items: ['The light', 'The floor', 'The one wall'] } },
  { eyebrow: 'Client story', kind: 'statement', tone: 'ground', art: { eyebrow: 'Case study', head: 'From empty space to a home that', accent: 'feels like them.' } },
  { eyebrow: 'Result', kind: 'stat', tone: 'accent', art: { big: '70%', body: 'of clients choose designers who show their process.' } },
];

/* how many fonts of their own a studio may carry. Three is the brief's number
   and it is also the honest one: a visual identity that needs a fourth face is
   not an identity any more. */
const FONT_SLOTS = 3;

/* the luminance and saturation sums this page used to carry moved into
   `lib/refanalysis.js` with the rest of the reading — one implementation, used
   by this page and by the per-category Add flow (Leon, Aug 7) */

/* ── WHAT A MOOD IMAGE CAN BE (Leon, Aug 7 — decision 557, revising 554) ──
 *
 * Visual Mood used to answer this in prose: a sentence naming interiors,
 * website screenshots, Instagram posts, Pinterest saves, editorial spreads,
 * materials — and two more paragraphs about what the analysis reads off them.
 * It was the most-written and least-read part of the page.
 *
 * 554 replaced it with six DRAWN tiles — a browser window, a post, a pinboard,
 * a spread. They were legible and they were wrong: a diagram of a layout is a
 * picture of a STRUCTURE, and this section is not asking for structures. It is
 * asking what a room should FEEL like. The tiles read as layout references,
 * which is the one thing a mood image is not.
 *
 * Photographs instead, of the things a studio's own mood folder is made of:
 * a room, materials laid out, a floor with the light across it, light on
 * plaster, a niche with one object in it, a detail. 554 avoided photographs
 * because the product's own stills, on a page where every other picture is the
 * studio's, could read as content already there (546). The wash is what answers
 * that — every tile takes the same neutral overlay and the same reduced
 * saturation, so the row reads as one quiet band of examples rather than as six
 * pictures, and no single one of them can become the thing you look at.
 *
 * Nothing here is pressable and nothing here is data: `aria-hidden`, and the
 * title and the one sentence under it carry the meaning on their own. */
const MOOD_EXAMPLES = [
  { id: 'room', src: '/assets/photo/ph/ph-sat.jpg' },          /* an interior */
  { id: 'materials', src: '/assets/photo/ph/ph-mon-4.jpg' },   /* oak, stone, linen, plaster */
  { id: 'floor', src: '/assets/photo/ph/ph-tue-2.jpg' },       /* a texture, with the window on it */
  { id: 'light', src: '/assets/photo/ph/ph-mon-6.jpg' },       /* light across a wall */
  { id: 'styling', src: '/assets/photo/ph/ph-tue-4.jpg' },     /* a niche, one vase in it */
  { id: 'detail', src: '/assets/photo/canal-house-02-detail-ash.jpg' }, /* a detail */
];

function MoodExamples() {
  return (
    <span className="ls-moodex" aria-hidden="true">
      {MOOD_EXAMPLES.map((e) => (
        <span key={e.id} className="ls-moodex__t">
          <img src={e.src} alt="" loading="lazy" />
        </span>
      ))}
    </span>
  );
}

export default function LibrarySettings() {
  const s = useStore();
  const nav = useNavigate();
  const saved = useMemo(() => identityOf(s), [s]);

  /* THE REFERENCES ARE PART OF THE DRAFT (Leon, Aug 7). They used to write
     straight to the store, so removing one was instant and un-undoable while
     every other edit on the page waited for Save. One page, one rule: nothing
     here is real until Save changes. */
  const [draft, setDraft] = useState(() => ({
    palette: { ...saved.palette },
    type: JSON.parse(JSON.stringify(saved.type || {})),
    fonts: [...(saved.fonts || [])],
    refs: [...(s.visualRefs || [])],
    /* what has already been read off each picture — see lib/refanalysis.js */
    analysis: { ...(s.refAnalysis || {}) },
  }));
  const [picking, setPicking] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(null); // where the studio tried to go

  const draftSig = JSON.stringify(draft);
  const dirty = draftSig !== JSON.stringify({
    palette: saved.palette,
    type: saved.type,
    fonts: saved.fonts || [],
    refs: s.visualRefs || [],
    analysis: s.refAnalysis || {},
  });

  /* THE PENDING NOTE COMES BACK (Leon, Aug 7). It is dismissible, because a note
     that cannot be closed is a banner. But dismissing it must not be a way to
     lose the only route to applying — so it is remembered against the draft it
     was dismissed ON, and the next edit brings it back. */
  const [hushed, setHushed] = useState(null);

  /* ── THE PHONE COMMITS WITH A BUTTON, NOT A NOTE (Leon, Aug 7) ────────────
   *
   * On a desktop there is room beside the page for a standing note that says
   * "not applied yet" and carries the action. On a phone that note is a bar
   * across the bottom of a screen already carrying the tab bar, sitting over
   * the thing being edited for as long as the studio keeps editing.
   *
   * So the phone gets what a phone expects: **Save** in the header, where the
   * page's other two controls already are, applying directly with a brief
   * confirmation. The note is suppressed there entirely — the button IS the
   * note, and having both would be the same message twice.
   *
   * It is one commit either way, the same function, with the same guard on
   * leaving. Only the affordance differs, because the two screens do. */
  const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 800px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 800px)');
    const on = (e) => setPhone(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const pending = dirty && !phone && draftSig !== hushed;

  /* ── NOTHING IS DISCARDED WITHOUT BEING ASKED (Leon, Aug 7) ──────────────
   *
   * A draft can be lost three ways: this page's own Back, a link in the app's
   * sidebar, and the browser (a reload, a closed tab). All three are covered.
   *
   * The sidebar is the awkward one — this app mounts a `BrowserRouter`, not a
   * data router, so `useBlocker` does not exist. A capture-phase listener on the
   * document catches the anchor BEFORE the router sees it, which is the same
   * moment `useBlocker` would have fired. */
  useEffect(() => {
    if (!dirty) return undefined;
    const onClick = (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
      const to = a.getAttribute('href');
      if (!to || to.startsWith('http') || to === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving(to);
    };
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty]);

  const goBack = () => (dirty ? setLeaving('/dashboard/visual-library') : nav('/dashboard/visual-library'));
  const discard = () => {
    const to = leaving;
    setLeaving(null);
    setDraft({
      palette: { ...saved.palette },
      type: { ...saved.type },
      fonts: [...(saved.fonts || [])],
      refs: [...(s.visualRefs || [])],
      analysis: { ...(s.refAnalysis || {}) },
    });
    nav(to);
  };

  /* ── the palette ── */
  const roleValue = (role) => draft.palette[role] || DEFAULT_PALETTE[role];
  const setRole = (role, hex) => setDraft((d) => ({ ...d, palette: { ...d.palette, [role]: hex } }));

  /* ── type: three slots, each a face and a weight, edited in place ── */
  const setSlot = (slotId, patch) => setDraft((d) => ({
    ...d, type: { ...d.type, [slotId]: { ...(d.type[slotId] || {}), ...patch } },
  }));

  /* the preview reads the DRAFT — that is the whole point of a draft */
  const previewVars = paintOf(draft);

  /* ── references (Visual Mood) ───────────────────────────────────────────────
     Stored in S3 through the backend (see api/visualBrand): a picture uploads on
     add and its record is deleted on remove, so the mood board survives a reload
     rather than dying with the session's object URLs. `setRefs` keeps the local
     draft and the store in step, so a mood change never reads as an unsaved
     palette edit. `refsRef` gives the async handlers the latest list without a
     stale closure. */
  const refs = draft.refs;
  const refsRef = useRef(draft.refs);
  useEffect(() => { refsRef.current = draft.refs; }, [draft.refs]);
  const setRefs = (next) => {
    refsRef.current = next;
    setDraft((d) => ({ ...d, refs: next }));
    setState({ visualRefs: next });
  };
  /* the ones Bauhly has never read — the only ones any analysis will touch */
  const pendingRefs = pendingOf(refs, draft.analysis);

  /* load the saved mood images once, with fresh presigned URLs. Ids are the S3
     key, so a reading kept per id (refAnalysis) still lines up after a reload. */
  useEffect(() => {
    let alive = true;
    listMoodImages()
      .then((imgs) => {
        if (!alive) return;
        const loaded = imgs
          .filter((m) => m.url)
          .map((m) => ({ id: m.key, key: m.key, kind: 'reference', url: m.url, title: m.title || '', source: 'added', addedAt: m.addedAt || Date.now() }));
        setRefs(loaded);
      })
      .catch(() => { /* offline / no S3 — keep whatever the store had */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addRef = async (f) => {
    if (!f) return;
    const localUrl = URL.createObjectURL(f);
    const tmpId = `tmp-${Date.now()}`;
    /* show it straight away, marked uploading */
    setRefs([
      { id: tmpId, kind: 'reference', url: localUrl, title: f.name, source: 'added', addedAt: Date.now(), uploading: true },
      ...refsRef.current,
    ]);
    try {
      const [saved] = await uploadMoodImages([f]);
      if (!saved) throw new Error('no result');
      /* keep the local object URL for this session — same-origin, instant, and
         safe for the palette reader; the S3 key is what makes it persist */
      const finalRef = { id: saved.key, key: saved.key, kind: 'reference', url: localUrl, title: saved.title || f.name, source: 'added', addedAt: saved.addedAt || Date.now() };
      setRefs(refsRef.current.map((r) => (r.id === tmpId ? finalRef : r)));
    } catch (err) {
      setRefs(refsRef.current.filter((r) => r.id !== tmpId));
      setToast({ kind: 'note', text: 'Bauhly could not save that image. Please try again.' });
    }
  };
  /* A REMOVED PICTURE TAKES ITS OWN READING WITH IT, AND NOTHING ELSE'S
     (Leon, Aug 7). `forgetRef` drops that one record; every other picture keeps
     what was read off it, so the palette shifts by exactly the one reference
     that left. The picture also leaves S3. */
  const dropRef = (id) => {
    const gone = refsRef.current.find((r) => r.id === id);
    setRefs(refsRef.current.filter((r) => r.id !== id));
    setDraft((d) => ({ ...d, analysis: forgetRef(d.analysis, id) }));
    if (gone && gone.key) deleteMoodImage(gone.key).catch(() => {});
  };

  /* ── THE VIEWER REPLACED SELECT MODE (Leon, Aug 7) ──────────────────────
   *
   * The phone had a Select mode — tap Select, tap the ones to remove, tap
   * Remove — which is three steps and a mode to be in, for the one thing a
   * studio does to a reference after adding it. Tapping a picture now opens the
   * picture, at the size a picture deserves, with the only two actions there
   * are: Delete, and Replace.
   *
   * REPLACING FORGETS WHAT WAS READ. A different photograph is a different
   * palette, so the slot's reading is dropped with the old file and the
   * reference goes back to "Not read yet". Keeping the old record against a new
   * picture would be the product claiming to have read something it has not. */
  const [viewing, setViewing] = useState(null);
  const replaceRef = async (id, f) => {
    if (!f) return;
    const old = refsRef.current.find((r) => r.id === id);
    const localUrl = URL.createObjectURL(f);
    /* show the new picture in the slot straight away; its reading is dropped */
    setRefs(refsRef.current.map((r) => (r.id === id
      ? { ...r, url: localUrl, title: f.name, addedAt: Date.now(), uploading: true }
      : r)));
    setDraft((d) => ({ ...d, analysis: forgetRef(d.analysis, id) }));
    try {
      const [saved] = await uploadMoodImages([f]);
      if (!saved) throw new Error('no result');
      setRefs(refsRef.current.map((r) => (r.id === id
        ? { id: saved.key, key: saved.key, kind: 'reference', url: localUrl, title: saved.title || f.name, source: 'added', addedAt: saved.addedAt || Date.now() }
        : r)));
      setViewing((v) => (v === id ? saved.key : v));
      if (old && old.key && old.key !== saved.key) deleteMoodImage(old.key).catch(() => {});
    } catch (err) {
      setToast({ kind: 'note', text: 'Bauhly could not save that image. Please try again.' });
    }
  };
  /* the viewer follows the draft, so a replaced picture updates in place and a
     deleted one closes it */
  const viewed = viewing ? draft.refs.find((r) => r.id === viewing) : null;
  useEffect(() => { if (viewing && !viewed) setViewing(null); }, [viewing, viewed]);
  useEffect(() => {
    if (!viewed) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setViewing(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewed]);

  /* ── the studio's own faces ── */
  const faces = facesWith(draft.fonts);
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
    /* a slot pointing at a face that no longer exists falls back to the default
       rather than drawing whatever the browser guesses */
    type: Object.fromEntries(Object.entries(d.type).filter(([, v]) => v.face !== id)),
  }));

  /* ── READING THE PICTURES IS AN EDIT, NOT A COMMIT (Leon, Aug 7) ─────────
   *
   * `paletteOf` samples the studio's references and the colours that come out
   * become the palette. That used to happen INSIDE "Update Visual Library",
   * which meant applying could silently replace an accent chosen by hand a
   * moment earlier. It is its own action now, it writes to the DRAFT, and the
   * preview shows what it found before anything reaches the library. */
  const busyRef = useRef(false);
  const readReferences = async () => {
    if (busyRef.current) return;
    if (!pendingRefs.length) {
      setToast({
        kind: 'note',
        text: refs.length
          ? 'Every mood image has been read already — add a new one and Bauhly will read that one.'
          : 'Add some mood images first — there is nothing to read a palette from yet.',
      });
      return;
    }
    busyRef.current = true;
    const n = pendingRefs.length;
    setToast({ kind: 'busy', text: `Reading ${n} new mood image${n === 1 ? '' : 's'}…` });
    /* ONLY THE NEW ONES (Leon, Aug 7). `analyseNew` skips every picture that
       already has a record, so this decodes exactly what arrived since the last
       time and nothing else. The palette is then merged off ALL the records —
       what the old pictures taught is preserved rather than recomputed. */
    const { analysis, read, failed } = await analyseNew(refs, draft.analysis, Date.now());
    busyRef.current = false;
    if (!read) {
      setToast({ kind: 'note', text: `Bauhly could not read ${failed === 1 ? 'that reference' : 'those references'} — your colours are unchanged.` });
      return;
    }
    setDraft((d) => {
      const next = paletteFromAnalysis(analysis, d.palette.accent || DEFAULT_PALETTE.accent);
      return {
        ...d,
        analysis,
        palette: next ? { ...next, accent: next.accent || d.palette.accent || DEFAULT_PALETTE.accent } : d.palette,
      };
    });
    const kept = Object.keys(draft.analysis).length;
    setToast({
      kind: 'done',
      text: kept
        ? `Read ${read} new mood image${read === 1 ? '' : 's'} and merged ${read === 1 ? 'it' : 'them'} into your visual profile. Apply when you are ready.`
        : `Read ${read} mood image${read === 1 ? '' : 's'} — the preview shows the colours they gave. Apply when you are ready.`,
    });
  };

  /* the one commit on this page: exactly what is on screen, to every layout */
  const applyToLibrary = () => {
    setState({
      libraryEdits: { palette: { ...draft.palette }, type: { ...draft.type }, fonts: [...draft.fonts] },
      visualRefs: [...draft.refs],
      /* what has been read off each picture travels with the pictures, so the
         next visit knows which ones are already done */
      refAnalysis: { ...draft.analysis },
    });
    setConfirming(false);
    /* NO TOAST ON A PHONE (Leon, Aug 7). The phone pressed a button labelled
       Update Library and watched it go disabled — that IS the confirmation, and
       it is the one the studio is already looking at. A note sliding up over the
       tab bar to repeat it is a second answer to a question nobody asked. */
    if (phone) return;
    setToast({
      kind: 'done',
      text: `Updated. All ${LAYOUTS.length} layouts now use these colours, faces and references.`,
    });
  };

  useEffect(() => {
    if (!toast || toast.kind === 'busy') return undefined;
    const t = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /* RESET IS AN EDIT LIKE ANY OTHER (Leon, Aug 7). It used to write to the store
     on the spot, which was the one control on the page that ignored the rule the
     rest of it follows. It returns the DRAFT to Bauhly's defaults; the library
     changes when the studio applies. The studio's own font files are theirs and
     are not a default to reset — they stay. */
  const resetAll = () => {
    setDraft((d) => ({ ...d, palette: {}, type: {} }));
    setToast({ kind: 'note', text: 'Back to Bauhly’s defaults — apply to put them on your library.' });
  };

  /* ── the phone's live preview is a carousel ──────────────────────────────
   * One preview at a time, swiped, with dots under it. The index is read off the
   * scroll position as a fraction of the whole run rather than from a slide
   * width, so a change to the peek or the gap cannot desynchronise the dots. */
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
    <div className="ls">
      {/* ONE NAVIGATION ROW (Leon, Aug 7). Back on the left, Reset on the right,
          the app's own two levels — and it stays a row at every width, because a
          secondary action that wraps under a back link reads as a third page
          heading. Under 560 it just gets smaller. */}
      {/* ── ONE HEADER ROW, THE APP'S OWN BUTTONS (Leon, Aug 7) ───────────
        *
        * Visual Library · Reset · Update Library, at every width. All three are
        * `.btn` at `btn--sm`, so height, padding, radius, icon size, type,
        * hover, focus, disabled and active come from `base.css` and cannot
        * drift from the rest of the app — the back control was a bespoke
        * `.pd__back` with its own geometry, and Reset carried a hand-written
        * height override under 560 that made it shorter than everything
        * beside it.
        *
        * Update Library is the primary and is visible on a desktop and a
        * tablet as well as a phone: it is the page's one commit, and having it
        * only in a toast meant the action existed only while the toast did.
        * On a phone the label drops to "Visual Library" and Reset drops its
        * word — three labelled buttons do not fit 375px, and the two that must
        * stay readable are where you are going and what you are committing. */}
      <div className="ls-topbar">
        <button className="btn btn--quiet btn--sm ls-back" onClick={goBack}>
          <Icon name="arrow-left" size={16} strokeWidth={2.25} />
          {phone ? 'Visual Library' : 'Back to Visual Library'}
        </button>
        <div className="ls-topbar__acts">
          <button
            className={`btn btn--tertiary btn--sm ${phone ? 'btn--icon' : ''}`}
            onClick={resetAll}
            aria-label={phone ? 'Reset to defaults' : undefined}
            title={phone ? 'Reset to defaults' : undefined}
          >
            {phone ? <Icon name="refresh" size={16} strokeWidth={2} /> : 'Reset to defaults'}
          </button>
          <button
            className="btn btn--primary btn--sm"
            disabled={!dirty}
            onClick={() => (phone ? applyToLibrary() : setConfirming(true))}
          >
            Update Library
          </button>
        </div>
      </div>

      <header className="ls-head">
        <div className="ls-head__text">
          <h1 className="ls-head__title">Library Settings</h1>
          <p className="ls-head__lead">
            Edit your brand visuals below, then apply them to every layout in your library.
          </p>
        </div>
      </header>

      {/* ── LIVE PREVIEW ──
        * Four specimens on a desktop; on a phone one at a time, swiped, running
        * to both edges of the screen — see `.ls-prevs` in the stylesheet. */}
      <section className="ls-card ls-card--preview">
        <div className="ls-card__head">
          <div>
            <h2 className="ls-card__title">Live preview</h2>
          </div>
        </div>
        <div className="ls-prevs" style={previewVars} ref={railRef}>
          {PREVIEWS.map((p) => <Preview key={p.eyebrow} {...p} />)}
        </div>
        <div className="ls-dots" role="tablist" aria-label="Live preview">
          {PREVIEWS.map((p, i) => (
            <button
              key={p.eyebrow}
              className={`ls-dot ${i === slide ? 'is-on' : ''}`}
              role="tab"
              aria-selected={i === slide}
              aria-label={p.eyebrow}
              onClick={() => goSlide(i)}
            />
          ))}
        </div>
      </section>

      {/* ── PALETTE + TYPE, side by side and equal ── */}
      <div className="ls-pair">
        <section className="ls-card">
          <div className="ls-card__head">
            <div>
              <h2 className="ls-card__title">Colour palette</h2>
              <p className="ls-card__lead">Three colours. Everything else derives from them.</p>
            </div>
          </div>
          <div className="ls-roles">
            {COLOUR_ROLES.map((r) => (
              <div className="ls-role" key={r.id}>
                <span className="ls-swatchwrap">
                  <button
                    className="ls-swatch"
                    style={{ background: roleValue(r.id) }}
                    aria-label={`${r.label} — ${roleValue(r.id)}`}
                    onClick={() => setPicking(r.id)}
                  />
                  {picking === r.id && (
                    <Picker
                      value={roleValue(r.id)}
                      onPick={(hex) => setRole(r.id, hex)}
                      onClose={() => setPicking(null)}
                    />
                  )}
                </span>
                <b>{r.label}</b>
                <em>{roleValue(r.id).toUpperCase()}</em>
                <span className="ls-role__use">{r.use}</span>
              </div>
            ))}
          </div>
        </section>

        {/* TWO FACES, EDITED IN PLACE (Leon, Aug 7). No Edit button and no second
          * screen: the faces ARE the control. Bauhly's own four are always here
          * and cannot be removed; the studio's own files live in the three slots
          * below the rows, which is where they are added and taken away. */}
        <section className="ls-card">
          <div className="ls-card__head">
            <div>
              <h2 className="ls-card__title">Typography</h2>
            </div>
          </div>

          <div className="ls-types">
            {TYPE_SLOTS.map((slot) => (
              <FontField
                key={slot.id}
                slot={slot}
                current={slotFace(draft, slot)}
                faces={faces}
                canAdd={draft.fonts.length < FONT_SLOTS}
                onPick={(faceId) => setSlot(slot.id, { face: faceId })}
                onDrop={dropFont}
                onAdd={addFont}
              />
            ))}
          </div>
        </section>
      </div>

      {/* ── IMAGE REFERENCES ──────────────────────────────────────────────
        *
        * ONE CONCEPT, NOT TWO (Leon, Aug 7). This was "Visual mood", and the
        * pictures Bauhly ANALYSES to build the library were a separate idea
        * living in the Visual Brand's Reference Library — so a studio had to
        * decide, per picture, whether it was inspiration or input. That is a
        * distinction the product invented and nobody outside it can make: a
        * Pinterest save that shows how you want type to sit IS the thing the
        * analysis reads.
        *
        * There is one section and one meaning now. Every picture here is both:
        * the studio's inspiration, and what the library is built from. The data
        * never distinguished them either — one `visualRefs` array, one kind. */}
      <section className="ls-card ls-card--refs">
        {/* ── THE HEAD IS FOR A SECTION THAT HAS SOMETHING IN IT (Leon, Aug 7
          * — decision 554) ────────────────────────────────────────────────
          * With no pictures yet, the title, the lead and the Add button were
          * drawn twice: once here and once in the placeholder under them. The
          * placeholder IS the section while it is empty — it carries the title,
          * the one sentence and the one move. The head comes back the moment
          * there is a grid for it to sit over. */}
        {refs.length > 0 && (
          <div className="ls-card__head">
            <div>
              <h2 className="ls-card__title">Visual Mood</h2>
              <p className="ls-card__lead">
                Add images that reflect the look and feel you want Bauhly to create.
              </p>
            </div>
            {/* ONE ADD, ON THE TITLE'S ROW (Leon, Aug 7). Compact, icon and word,
                the app's own tertiary button — and it is the only way to add,
                now that the dashed tile is gone from the grid.
                THE STATE SITS BESIDE IT: "all references read" used to be a
                sentence under the grid, in a row that also carried a button — a
                paragraph to say a thing that is either true or not. It is a chip
                here, and only when nothing is waiting; when something IS waiting
                the button below counts it, which is the more useful half. */}
            <div className="ls-refs__acts">
              {!pendingRefs.length && (
                <span className="ls-refs__status">
                  <Icon name="check" size={13} strokeWidth={3} />
                  All mood images analyzed
                </span>
              )}
              <label className="btn btn--tertiary btn--sm ls-refs__add">
                <Icon name="plus" size={15} strokeWidth={2.5} />
                Add mood images
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addRef(f); }}
                />
              </label>
            </div>
          </div>
        )}
        {/* ── THE PROSE IS GONE (Leon, Aug 7 — decision 554) ────────────────
          * Three paragraphs stood here: the list of kinds a reference can be,
          * what the analysis reads off them, and what it does with what it
          * read. All of it true, none of it something a studio needs before
          * uploading their first picture — and the last two were the product
          * explaining its own implementation to someone who came here to add
          * six photographs.
          * The list of kinds became the six tiles in the placeholder, which is
          * the same information in about a second. The rest is simply not
          * shown: what Bauhly does with a mood image is a promise the product
          * keeps, not a paragraph it prints. */}
        {refs.length === 0 && (
          <EmptyState
            visual={<MoodExamples />}
            title="Visual Mood"
            action={(
              <>
                <label className="btn btn--primary ls-refs__add">
                  <Icon name="plus" size={16} strokeWidth={2.5} />
                  Add mood images
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addRef(f); }}
                  />
                </label>
                {/* the one line that has to survive the cut: it is the answer
                    to "will my photographs end up in my posts?", which is the
                    question a grid of your own pictures in a settings page
                    actually raises (549) */}
                <p className="ls-moodhelp">
                  Your references help Bauhly understand your visual style. They are never
                  copied directly into your content.
                </p>
              </>
            )}
          >
            Add images that reflect the look and feel you want Bauhly to create.
          </EmptyState>
        )}
        <ul className="ls-refs">
          {refs.map((r) => (
            <li key={r.id} className={`ls-refs__item ${draft.analysis[r.id] ? '' : 'is-pending'}`}>
              {/* the whole tile is the control: it opens the picture. There is
                  no ✕ on any thumbnail at any width — Delete and Replace live
                  in the viewer, which is where you can see what you are about
                  to delete or replace. */}
              <button
                type="button"
                className="ls-refs__open"
                aria-label={`Open ${r.title || 'this mood image'}`}
                onClick={() => setViewing(r.id)}
              >
                <img src={r.url} alt="" loading="lazy" />
              </button>
              {!draft.analysis[r.id] && <span className="ls-refs__pending">Not read yet</span>}
            </li>
          ))}
        </ul>
        {refs.length > 0 && (
          <>
            {/* the row exists only while there is something to read — the
                done state is the chip in the header (Leon, Aug 7) */}
            {pendingRefs.length > 0 && (
              <div className="ls-reset">
                {/* the button counts what it will actually do, so it can never
                    promise work it is not going to perform */}
                <button className="btn btn--tertiary btn--xs" onClick={readReferences}>
                  <Icon name="refresh" size={14} strokeWidth={2} />
                  {`Read ${pendingRefs.length} new mood image${pendingRefs.length === 1 ? '' : 's'}`}
                </button>
                {/* the mechanics of the read went with the paragraphs above
                    (554). What is left is the only part that changes what the
                    studio does next. */}
                <span>Nothing reaches your library until you apply it.</span>
              </div>
            )}
            <p className="ls-note">Uploads last this session — there is no file storage in this build yet.</p>
          </>
        )}
      </section>

      {/* ── the toast ─────────────────────────────────────────────────────
        * One at a time: something that just happened outranks the standing note
        * that there are changes waiting, and the note comes back underneath it. */}
      {(toast || pending) && createPortal(
        toast ? (
          <div className={`ls-toast ${toast.kind === 'busy' ? 'is-busy' : ''}`} role="status">
            <span className="ls-toast__row">
              <Icon
                name={toast.kind === 'busy' ? 'refresh' : toast.kind === 'done' ? 'check' : 'info'}
                size={17}
                strokeWidth={2.25}
              />
              <span className="ls-toast__text">{toast.text}</span>
            </span>
            <button className="ls-toast__x" aria-label="Dismiss" onClick={() => setToast(null)}>
              <Icon name="x" size={14} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          <div className="ls-toast" role="status">
            <span className="ls-toast__row">
              <Icon name="info" size={17} strokeWidth={2.25} />
              <span className="ls-toast__text">
                <b>Not applied yet.</b> Your library still shows the last settings you applied.
              </span>
            </span>
            <button className="btn btn--primary btn--xs" onClick={() => setConfirming(true)}>
              Update Library
            </button>
            <button className="ls-toast__x" aria-label="Dismiss" onClick={() => setHushed(draftSig)}>
              <Icon name="x" size={14} strokeWidth={2.5} />
            </button>
          </div>
        ),
        document.body,
      )}

      {/* ── ONE REFERENCE, FULL SCREEN ────────────────────────────────────
        * The picture at the largest size the screen allows, and the only two
        * things there are to do to it. No crop, no rename, no notes: a
        * reference is a picture Bauhly reads, so the studio's whole relationship
        * with it is "keep this one" or "use a different one". */}
      {viewed && createPortal(
        <div className="ls-view" role="dialog" aria-modal="true" aria-label={viewed.title || 'Reference'}>
          <button className="ls-view__scrim" aria-label="Close" onClick={() => setViewing(null)} />
          <img className="ls-view__img" src={viewed.url} alt={viewed.title || ''} />
          <div className="ls-view__bar">
            <span className="ls-view__name">
              {viewed.title || 'Reference'}
              {!draft.analysis[viewed.id] && <em>Not read yet</em>}
            </span>
            <span className="ls-view__acts">
              <label className="btn btn--quiet btn--sm ls-view__btn">
                <Icon name="refresh" size={15} strokeWidth={2} />
                Replace
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; replaceRef(viewed.id, f); }}
                />
              </label>
              <button
                className="btn btn--quiet btn--sm ls-view__btn ls-view__del"
                onClick={() => { dropRef(viewed.id); setViewing(null); }}
              >
                <Icon name="trash" size={15} strokeWidth={2} />
                Delete
              </button>
            </span>
          </div>
          <button className="ls-view__x" aria-label="Close" onClick={() => setViewing(null)}>
            <Icon name="x" size={18} strokeWidth={2.5} />
          </button>
        </div>,
        document.body,
      )}

      {/* ── WHAT APPLYING DOES, ASKED RATHER THAN PRINTED (Leon, Aug 7) ─────
        * This used to be a standing notice at the foot of the page — a sentence
        * about a consequence, sitting where nobody was about to cause it. It is
        * the same fact, moved to the moment it is true, and shortened to the two
        * lines that moment has room for. */}
      {confirming && createPortal(
        <>
          <div className="ls-dialog__scrim" onClick={() => setConfirming(false)} />
          <div className="ls-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ls-apply">
            <h2 id="ls-apply">Update all library layouts?</h2>
            <p>
              Your latest colours, typography, and image references will be applied across
              all {LAYOUTS.length} layouts.
            </p>
            <div className="ls-dialog__acts">
              <button className="btn btn--tertiary btn--sm" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn btn--primary btn--sm" onClick={applyToLibrary}>Update</button>
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* ── leaving with unsaved changes ── */}
      {leaving && createPortal(
        <>
          <div className="ls-dialog__scrim" onClick={() => setLeaving(null)} />
          <div className="ls-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ls-discard">
            <h2 id="ls-discard">Discard changes?</h2>
            <p>You have changes you have not applied. If you leave now, all edits made in Library Settings will be lost.</p>
            {/* CONTINUE EDITING IS THE PRIMARY (Leon, Aug 7). It was the other
                way round: the ink-filled button — the one a hand goes to without
                reading — threw the work away. The safe path is the default, and
                the destructive one is the app's own destructive treatment
                (negative text, negative-soft on hover; a filled red primary
                exists nowhere in this product). Discarding still only ever
                happens on this explicit press. */}
            <div className="ls-dialog__acts">
              <button className="btn btn--quiet btn--sm ls-dialog__danger" onClick={discard}>Discard changes</button>
              <button className="btn btn--primary btn--sm" onClick={() => setLeaving(null)}>Continue editing</button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
