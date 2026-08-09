/*
 * Your Brand Visual Library — the layouts Bauhly builds posts from.
 *
 * WHAT THIS PAGE IS (Leon, Aug 4).
 *
 * Not a step in onboarding and not a marketplace: a library of the studio's own
 * reusable parts, the way a design system lists its components. The plan draws
 * from it every week, so what the studio keeps here decides what next Monday can
 * look like. That is the whole reason it is a page you can come back to rather
 * than a screen you pass through once.
 *
 * Every layout is drawn from a description (see data/layouts.js), not stored as a
 * picture, so the set carries the brand's own fonts and colours and cannot go
 * stale. Each one is 4:5 — the shape a post actually occupies.
 *
 * The one control on a layout is whether it is in use. A layout turned off stays
 * on the page, plainly inactive: a library that hides what you rejected makes it
 * impossible to change your mind, and the studio should be able to see the whole
 * set they own.
 *
 * ── THE HEAD, IN TWO ROWS (Leon, Aug 7) ──────────────────────────────────
 *
 *   1  the title, with Library settings and ⋯ on the same line, right
 *   2  the categories on the left, Filter pinned to the right of that row
 *
 * The theme came off the title's line because it is not a page-level action —
 * it is the first choice you make about what you are looking at, and it belongs
 * with the other choices rather than beside the door to the settings.
 *
 * The count beside the title went with it: "All Layouts 62" says the total in
 * the row a studio is about to press, and every category chip carries its own.
 * Below 720px all four controls drop their labels and become icon buttons.
 *
 * ── MOOD VISUALS (Leon, Aug 6) ───────────────────────────────────────────
 *
 * A switch on how every layout is DRAWN, not a filter on which ones exist: with
 * it on, the compositions carry the studio's photography; with it off, every
 * picture is drawn as the empty ground it would be before a photograph exists.
 * Both are true views of the same library, and the second is what a slide
 * genuinely looks like the moment before the studio shoots it. It is deliberately
 * NOT the same control as "with images" below — that one is about whether a
 * layout has a place for a photograph at all.
 *
 * ── THE FACETS (Leon, Aug 6, reversing part of decision 447) ─────────────
 *
 * 447 removed Filter because the category chips already filtered. These do not
 * filter by category: they filter by two facts a studio actually browses on —
 * whether a layout takes a photograph, and whether they are using it. Each is a
 * pair, only one side of a pair can be on, and they live behind one Filter
 * button so the page still has one obvious way in.
 *
 * Both dropdowns on this page are `.pe-menu`, the app's own menu component, at
 * its own geometry — see the note in visuallibrary.css.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Icon from '../../brand/Icon.jsx';
import { useStore, setState } from '../../lib/store.js';
import { LAYOUTS, CATEGORIES, hasImage } from '../../data/layouts.js';
import { analyseNew } from '../../lib/refanalysis.js';
import { candidatesFor, buildLayouts } from '../../lib/addlayouts.js';
import { paintOf } from '../../lib/identity.js';
import './visuallibrary.css';



import { Preview, Ph } from './LayoutArt.jsx';

function Card({ l, on, mood, onToggle, onEdit, onRemove }) {
  const [menu, setMenu] = useState(false);
  return (
    <li className={`vl-card ${on ? '' : 'is-off'}`}>
      <div className="vl-card__frame">
        <Preview l={l} mood={mood} />
        {/* out of the middle of the artwork and into the corner (Leon, Aug 6):
            it used to sit over the composition you were deciding about */}
        {!on && <span className="vl-card__offmark">Not in use</span>}
      </div>
      {/* THE HOUSEKEEPING IS IN THE CORNER (Leon, Aug 4). Changing a layout and
        * taking it out of the library are rarer than turning it off, and both
        * act on the whole layout — so they sit in one menu on the frame rather
        * than as controls competing with the one that matters.
        *
        * It is a SIBLING of the frame, not a child (Leon, Aug 6): the frame is a
        * container-query root, which is also a CONTAINMENT root, and a
        * `position: fixed` scrim inside one resolves against the frame instead of
        * the window — the same trap `position: fixed` inside an animated ancestor
        * sets (CLAUDE.md §4). Outside it, the scrim covers the page again. */}
      <span className="vl-card__menuwrap">
          <button
            className="btn btn--icon btn--sm vl-card__dots"
            aria-haspopup="menu"
            aria-expanded={menu}
            aria-label={`What to do with ${l.name}`}
            onClick={() => setMenu((v) => !v)}
          >
            <Icon name="more" size={15} strokeWidth={2} />
          </button>
          {menu && (
            <>
              <span className="vl-scrim" onClick={() => setMenu(false)} />
              <span className="pe-menu vl-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); onEdit(); }}>
                  <Icon name="edit" size={15} strokeWidth={2} />
                  <span className="pe-menu__grow">Edit layout</span>
                </button>
                <button role="menuitem" className="is-danger" onClick={() => { setMenu(false); onRemove(); }}>
                  <Icon name="trash" size={15} strokeWidth={2} />
                  <span className="pe-menu__grow">Remove from library</span>
                </button>
              </span>
            </>
          )}
      </span>
      <div className="vl-card__foot">
        {/* THE METADATA LINE WENT (Leon, Aug 6). "4:5 · 1 photo · 2 type levels"
          * was three facts under every card, none of which a studio chooses on:
          * the ratio is the same on all 62, and the photograph count and the type
          * levels are both plainly visible in the drawing directly above the
          * words. Nothing replaces it — the name and the one control are what the
          * card is for, and the filters are where those two facts do real work. */}
        <div className="vl-card__id">
          <b>{l.name}</b>
        </div>
        {/* THE ONE CONTROL (Leon, Aug 4). Not a menu and not a delete: a layout is
          * in use or it is not, and either way it stays on the page. */}
        <button
          className={`btn btn--xs ${on ? 'btn--tertiary' : 'btn--quiet'} vl-card__use`}
          onClick={onToggle}
          aria-pressed={on}
          aria-label={on ? `Stop using ${l.name}` : `Use ${l.name}`}
          title={on ? 'In use — press to turn off' : 'Off — press to use'}
        >
          <Icon name={on ? 'check' : 'plus'} size={13} strokeWidth={2.5} />
          {on ? 'In use' : 'Use'}
        </button>
      </div>
    </li>
  );
}

/* ── a category, as a row you can run along ────────────────────────────────
 *
 * BOTH ARROWS, AND ONLY WHEN THERE IS SOMEWHERE TO GO (Leon, Aug 6). There was
 * one arrow, on the right, shown when a row held more than four layouts — a
 * count, not a measurement, so a row of three that did not fit an 900px window
 * showed nothing and a row of five on a wide screen showed an arrow that
 * scrolled nothing. It is measured now: the rail reports its own overflow on
 * mount, on resize and on scroll, and each arrow appears exactly when there is
 * something in that direction. */
/* ── ADDING LAYOUTS TO ONE CATEGORY ───────────────────────────────────────
 *
 * (Leon, Aug 7.) One category, one flow, three steps that are really one
 * screen: add pictures → Bauhly reads the new ones → the compositions arrive
 * in that category. Nothing else moves. The palette, the faces and the layouts
 * that were already there are untouched, and it says so, because "add to Hook"
 * must never read as "rebuild my library".
 *
 * WHAT IT WILL DO IS PRINTED BEFORE IT DOES IT: how many pictures are about to
 * be read, how many compositions this category has spare, and — if the studio
 * has added more pictures than there are shapes left — how many layouts they
 * are actually going to get. A flow that quietly makes two when three were
 * asked for is the silent truncation this product does not do.
 */
function AddToCategory({ cat, existing, onClose, onDone }) {
  const [pics, setPics] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const addPic = (f) => {
    if (!f) return;
    setPics((p) => [...p, { id: `addref-${Date.now()}-${p.length}`, url: URL.createObjectURL(f), title: f.name }]);
  };
  const dropPic = (id) => setPics((p) => p.filter((x) => x.id !== id));

  /* what this category has left to give, so the count is read rather than
     promised */
  const spare = candidatesFor(cat.id, existing, null).length;
  const willMake = Math.min(pics.length, spare);

  const run = async () => {
    if (!pics.length || busy) return;
    setBusy(true);
    const stamp = Date.now();
    /* ONLY THESE PICTURES (Leon, Aug 7). `analyseNew` is handed an empty map,
       so the work is exactly the ones just added — the studio's existing
       references are neither read nor touched by this flow. */
    const { analysis, read, failed } = await analyseNew(pics, {}, stamp);
    if (!read) {
      setBusy(false);
      setResult({ error: `Bauhly could not read ${failed === 1 ? 'that picture' : 'those pictures'}. Nothing was added.` });
      return;
    }
    const readable = pics.filter((p) => analysis[p.id]);
    const { made, short } = buildLayouts({ cat: cat.id, existing, refs: readable, analysis, stamp });
    setBusy(false);
    if (!made.length) {
      setResult({ error: `${cat.label} already has every composition Bauhly can draw with a photograph. Nothing was added.` });
      return;
    }
    onDone(made, analysis);
    setResult({ made: made.length, short, names: made.map((m) => m.name) });
  };

  return createPortal(
    <>
      <div className="vl-add__scrim" onClick={onClose} />
      <div className="vl-add" role="dialog" aria-modal="true" aria-labelledby="vl-add-t">
        <h2 id="vl-add-t">Add {cat.label} layouts</h2>
        {result ? (
          <>
            <p>
              {result.error || (
                <>
                  Added <b>{result.made}</b> new {cat.label} layout{result.made === 1 ? '' : 's'}:{' '}
                  {/* NOT `join(', ')` (Leon, Aug 7). Layout names contain commas
                      — "Materials, Side by Side" — so two names comma-joined
                      read as three. A middle dot cannot appear inside a name. */}
                  {result.names.join(' · ')}. Your colours, typography and existing layouts are unchanged.
                  {result.short > 0 && ` ${result.short} picture${result.short === 1 ? '' : 's'} did not get a layout — this category has no other composition left that takes a photograph.`}
                </>
              )}
            </p>
            <div className="vl-add__acts">
              <button className="btn btn--primary btn--sm" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p>
              Add pictures that show how a {cat.label.toLowerCase()} slide should look. Bauhly reads
              only these — your other references are not touched — and gives this category one new
              composition per picture, chosen from the shapes it does not already have.
            </p>
            <ul className="vl-add__pics">
              {pics.map((p) => (
                <li key={p.id}>
                  <img src={p.url} alt="" />
                  <button aria-label="Remove" onClick={() => dropPic(p.id)}>
                    <Icon name="x" size={12} strokeWidth={2.5} />
                  </button>
                </li>
              ))}
              <li className="vl-add__pick">
                <label>
                  <Icon name="image" size={18} strokeWidth={1.8} />
                  Add picture
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; addPic(f); }}
                  />
                </label>
              </li>
            </ul>
            <p className="vl-add__note">
              {pics.length === 0
                ? `${cat.label} has ${spare} composition${spare === 1 ? '' : 's'} it does not use yet.`
                : `Will read ${pics.length} picture${pics.length === 1 ? '' : 's'} and add ${willMake} layout${willMake === 1 ? '' : 's'}.`}
              {' '}Bauhly reads the palette, the frame and the ground; the words are yours to write when
              you use the layout.
            </p>
            <div className="vl-add__acts">
              <button className="btn btn--tertiary btn--sm" onClick={onClose}>Cancel</button>
              <button className="btn btn--primary btn--sm" disabled={!pics.length || busy} onClick={run}>
                {busy ? 'Reading…' : `Add ${willMake || ''} layout${willMake === 1 ? '' : 's'}`.replace('  ', ' ')}
              </button>
            </div>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}

function Row({ cat, layouts, off, mood, onToggle, onEdit, onRemove, onOpen, onAdd }) {
  const rail = useRef(null);
  const [ends, setEnds] = useState({ left: false, right: false });

  useEffect(() => {
    const el = rail.current;
    if (!el) return undefined;
    const read = () => {
      const room = el.scrollWidth - el.clientWidth;
      setEnds({ left: el.scrollLeft > 4, right: room > 4 && el.scrollLeft < room - 4 });
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    /* the rail's width changes with the window AND with the sidebar, and the
       cards' width changes with the breakpoint — an observer catches both */
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
  }, [layouts.length]);

  const step = (dir) => {
    const el = rail.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className="vl-row">
      <header className="vl-row__head">
        <div>
          <h2 className="vl-row__title">{cat.label} layouts <span>({layouts.length})</span></h2>
          <p className="vl-row__lead">{cat.lead}</p>
        </div>
        {/* VIEW ALL IS A PHONE CONTROL (Leon, Aug 6). On a desktop the row is a
          * rail you run along with two arrows and a trackpad, and the chips open
          * a category in place; on a phone a horizontal rail inside a vertical
          * page is two scroll directions fighting for one thumb. So the phone
          * gets a door instead: this opens the section as its own page, and it
          * does not exist above 720px, where the rail is the right answer. */}
        <div className="vl-row__acts">
          {/* every category can be added to, and the control sits ON the
              category so there is never a question which one it will affect */}
          <button className="btn btn--tertiary btn--sm vl-row__add" onClick={() => onAdd(cat.id)}>
            <Icon name="plus" size={15} strokeWidth={2.5} />
            Add
          </button>
          <button className="vl-row__all" onClick={() => onOpen(cat.id)}>
            View all
            <Icon name="chevron-right" size={15} strokeWidth={2.5} />
          </button>
        </div>
      </header>
      {/* SAME RAIL WHEN FILTERED (Aug 9). Choosing Hook used to swap this for a
        * stretching grid — cards grew, and horizontal scroll disappeared. The
        * overview and a filtered category are the same carousel: fixed 232px
        * cards, arrows when there is overflow. */}
      <div className="vl-rail__wrap">
        <ul className="vl-rail" ref={rail}>
          {layouts.map((l) => (
            <Card
              key={l.id}
              l={l}
              on={!off[l.id]}
              mood={mood}
              onToggle={() => onToggle(l.id)}
              onEdit={() => onEdit(l)}
              onRemove={() => onRemove(l)}
            />
          ))}
        </ul>
        {ends.left && (
          <button className="vl-rail__go is-back" onClick={() => step(-1)} aria-label={`Earlier ${cat.label} layouts`}>
            <Icon name="chevron-left" size={18} strokeWidth={2.5} />
          </button>
        )}
        {ends.right && (
          <button className="vl-rail__go" onClick={() => step(1)} aria-label={`More ${cat.label} layouts`}>
            <Icon name="chevron-right" size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </section>
  );
}

/* the two facets, as pairs: only one side of a pair can be on, and pressing the
   side that is on turns it off again. `group` is what the dropdown heads them
   with — a filter list with no headings is four options in a row that look like
   one set of four, when they are two questions with two answers each. */
const FACETS = [
  { id: 'with', pair: 'img', group: 'Pictures', label: 'With images', test: (l) => hasImage(l) },
  { id: 'without', pair: 'img', group: 'Pictures', label: 'Without images', test: (l) => !hasImage(l) },
  { id: 'on', pair: 'use', group: 'In your plan', label: 'In use', test: (l, off) => !off[l.id] },
  { id: 'off', pair: 'use', group: 'In your plan', label: 'Not in use', test: (l, off) => !!off[l.id] },
];

export default function VisualLibrary() {
  const s = useStore();
  /* which layouts the studio has turned off — the store keeps the exceptions,
     so a new layout added to the set is in use by default */
  const off = s.layoutsOff || {};
  const toggle = (id) => setState({ layoutsOff: { ...off, [id]: !off[id] } });
  /* removed layouts are gone from the library; kept per id so the set itself
     stays a constant and nothing is destroyed in the data */
  const gone = s.layoutsGone || {};
  const remove = (l) => setState({ layoutsGone: { ...gone, [l.id]: true } });

  /* ONE PALETTE AT A TIME (Leon, Aug 6 — replaces the Aug 4 rule). The reason
     for choosing once at the top is unchanged: a feed set in two palettes reads
     as two accounts. What changed is what the choice DOES. It used to pick which
     layouts existed; it now paints the ones that always did. The class goes on
     the page root and the artwork reads its colours from there, so switching is
     a repaint — no card is added, removed, or re-composed. */
  /* THERE IS NO THEME TO CHOOSE (Leon, Aug 7). There is one palette, edited in
     Library Settings, and it arrives here as custom properties. This page reads
     the identity; it never sets it. */

  /* ── NO SYSTEM PHOTOGRAPHY IN THE LIBRARY (Leon, Aug 7 — decision 548) ──
   *
   * This was the "Mood visuals" toggle, then a switch in Library Settings, then
   * hard-coded ON when the switch was removed (511). ON was the wrong constant:
   * it filled every picture region with one of the product's own stills, so a
   * studio browsing forty-five layouts saw forty-five compositions apparently
   * already containing photographs that are not theirs.
   *
   * OFF is what a layout actually is — a SHAPE. Every composition still draws
   * in full; the picture region is the empty ground it will be until the studio
   * puts something in it, which is the same thing the plan's layout cards show
   * (546) and the same thing the post preview shows (521). One answer to "what
   * does a layout look like before I have a photograph" in all three places.
   *
   * `mood` stays as the prop the compositions read — it is what says "there is
   * a picture for this slot" — and the plan passes `true` once the studio
   * uploads one. Only the LIBRARY is unconditionally off, because nothing in
   * the library is ever the studio's own picture. */
  const mood = false;

  /* the category is a filter like any other now — it lives in the Filter menu
     with the rest of them (Leon, Aug 6) */
  /* ── CATEGORIES ARE MULTI-SELECT CHIPS, NOT TABS (Leon, Aug 7) ──────────
   *
   * They were one-of-N: pressing Educational replaced Hook. A studio comparing
   * their openings against their teaching slides had to look at one, remember
   * it, then look at the other — which is not what a library is for.
   *
   * The state is a SET now. Any number of categories can be on and the page
   * shows layouts matching ANY of them. "All layouts" is not a member of the
   * set — it is the empty set, so choosing it clears the rest, and choosing the
   * last remaining chip off returns to it rather than to nothing. */
  const [cats, setCats] = useState(() => new Set());
  const allOn = cats.size === 0;
  const pickCat = (id) => setCats((prev) => {
    if (id === 'all') return new Set();
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  /* PRESSING A CATEGORY FILTERS TO THAT GROUP (Aug 9). The chip used to swap
     the rail for a stretching grid — cards grew and horizontal scroll was lost.
     Filtering only narrows which layouts appear; each group stays a fixed-size
     carousel, same as "All layouts". */
  /* THE PHONE'S SECTION PAGE (Leon, Aug 6). "View all" opens one category as a
     page of its own — a vertical list, no rail — and Back returns to exactly the
     row the studio left, at the scroll position they left it at. The filters and
     the theme are untouched by either move: this is a VIEW, not a filter. */
  const [openCat, setOpenCat] = useState(null);
  const returnTo = useRef(0);
  const openSection = (id) => { returnTo.current = window.scrollY; setOpenCat(id); };
  const closeSection = () => { setOpenCat(null); };
  /* SWITCHING CATEGORY DOES NOT MOVE THE PAGE (Leon, Aug 6). The first version
     scrolled to the chips when a group opened, which sounds helpful and is not:
     it moves the control you just pressed out from under the pointer, and if you
     press two chips in a row the second one is somewhere else by the time you
     reach it. The chips sit near the top of the page, the grid opens directly
     under them, and the scroll position is simply left alone — which is also
     what "maintain the scroll position" literally asks for. */

  useEffect(() => {
    if (openCat) { window.scrollTo(0, 0); return; }
    /* after the rows are back on the page, not before */
    const y = returnTo.current;
    if (y) window.requestAnimationFrame(() => window.scrollTo(0, y));
  }, [openCat]);
  const [facets, setFacets] = useState({ img: null, use: null });
  const [filterOpen, setFilterOpen] = useState(false);
  /* the phone's one door — see the sheet at the foot of this component */
  const [sheet, setSheet] = useState(false);
  /* which panel of the ⋯ menu is showing — null is its root */
  const [pane, setPane] = useState(null);
  /* a sheet is a dialog, and a dialog closes on Escape */
  useEffect(() => {
    if (!sheet) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setSheet(false); setPane(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet]);
  const pressFacet = (f) => setFacets((v) => ({ ...v, [f.pair]: v[f.pair] === f.id ? null : f.id }));
  const nFacets = (facets.img ? 1 : 0) + (facets.use ? 1 : 0) + cats.size;

  /* THE THEME NO LONGER SELECTS LAYOUTS (Leon, Aug 6). It used to filter the set
     — Bold showed you twenty layouts, Editorial a different twenty-two — which
     made the picker a way of hiding two thirds of the library and forced a
     studio who wanted one composition to accept the palette that came with it.
     The whole set is here under every theme; the theme paints it. */
  /* THE STUDIO'S OWN LAYOUTS SIT IN THE SET, NOT BESIDE IT (Leon, Aug 7). A
     layout added to Hook is a Hook layout: it filters, counts, toggles off and
     is removed exactly like the forty-five that shipped. A second list rendered
     under the first would be the product saying "these are ours and those are
     yours", which is not a distinction a studio browsing their library cares
     about. Newest first within a category, so what was just made is visible
     without hunting for it. */
  const own = useMemo(() => [...(s.addedLayouts || [])].reverse(), [s.addedLayouts]);
  /* which category's Add flow is open, if any */
  const [adding, setAdding] = useState(null);
  /* NOTHING ELSE IS TOUCHED (Leon, Aug 7). The new layouts are appended to the
     studio's own list and the pictures' readings are merged into the existing
     `refAnalysis` — no palette is written, no typography is written, and not one
     existing layout is read, re-composed or replaced. */
  const commitAdded = (made, analysis) => setState({
    addedLayouts: [...(s.addedLayouts || []), ...made],
    refAnalysis: { ...(s.refAnalysis || {}), ...analysis },
  });
  const all = useMemo(
    () => [...own, ...LAYOUTS].filter((l) => !gone[l.id]),
    [own, gone],
  );

  /* THE CATEGORY IS ONE OF THE FILTERS (Leon, Aug 6). It used to narrow the page
     downstream of this, which left "Showing 45 of 45 — educational" under a page
     showing ten. Every filter narrows in one place, so every number the page
     prints is a number of what is actually on it. */
  const shown = useMemo(
    () => all.filter((l) => (allOn || cats.has(l.cat))
      && FACETS.every((f) => facets[f.pair] !== f.id || f.test(l, off))),
    [all, cats, allOn, facets, off],
  );

  /* the rows on the page: all of them, or only the chosen ones */
  const shownCats = allOn ? CATEGORIES : CATEGORIES.filter((c) => cats.has(c.id));

  /* WHAT LIBRARY SETTINGS SAVED (Leon, Aug 6). The palettes and the two faces
     live in CSS as the product's defaults; a studio's overrides arrive as custom
     properties on this one element, so the whole library repaints from them and
     no composition has to know they exist. An empty override object sets
     nothing, which is how "reset to defaults" is a delete. */
  const edits = s.libraryEdits || {};
  const paint = paintOf(edits);

  /* one category, as its own page — phone only, reached from "View all" */
  if (openCat) {
    const c = CATEGORIES.find((x) => x.id === openCat) || CATEGORIES[0];
    const list = shown.filter((l) => l.cat === c.id);
    return (
      <div className="vl vl--section" style={paint}>
        <button className="btn btn--quiet btn--sm vl-back" onClick={closeSection}>
          <Icon name="chevron-left" size={16} strokeWidth={2.5} />
          Visual Library
        </button>
        <header className="vl-head">
          <h1 className="vl-head__title">{c.label} layouts <span>({list.length})</span></h1>
        </header>
        <p className="vl-head__lead">{c.lead}</p>
        <ul className="vl-grid">
          {list.map((l) => (
            <Card
              key={l.id}
              l={l}
              on={!off[l.id]}
              mood={mood}
              onToggle={() => toggle(l.id)}
              onEdit={() => {}}
              onRemove={() => remove(l)}
            />
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="vl" style={paint}>
      {/* ROW ONE — the title and the way into the library's own settings */}
      <header className="vl-head">
        {/* the count beside the title went (Leon, Aug 6): every category chip
            below already carries its own, and "All Layouts 62" says the total in
            the one place a studio is about to act on it */}
        <h1 className="vl-head__title">Visual Library</h1>
        {/* EVERY CONTROL CARRIES ITS OWN NAME (Leon, Aug 6). `aria-label` and
          * `title` are on all of them at every width: an icon with no accessible
          * name is a button nobody can read, on a screen reader or a phone. */}
        <span className="vl-head__acts">
        <Link
          to="/dashboard/library-settings"
          className="btn btn--tertiary btn--sm vl-ctl vl-head__settings"
          aria-label="Library settings"
          title="Library settings"
        >
          <Icon name="settings" size={15} strokeWidth={2} />
          <span className="vl-ctl__label">Library settings</span>
        </Link>
        {/* THE MENU LIVES BESIDE ITS BUTTON (Leon, Aug 6). It was rendered at
          * the foot of the component, where `position: absolute` resolved
          * against the page rather than the ⋯ — so `top: calc(100% + 6px)` put
          * it a page-height down, off screen. A menu is anchored by being INSIDE
          * a positioned wrapper, not by being given coordinates. */}
        <span className="vl-morewrap">
          <button
            className="btn btn--tertiary btn--icon btn--sm vl-iconbtn vl-more"
            aria-haspopup="menu"
            aria-expanded={sheet}
            aria-label={nFacets ? `Library options — ${nFacets} filters applied` : 'Library options'}
            onClick={() => { setSheet((v) => !v); setPane(null); }}
          >
            <Icon name="more" size={16} strokeWidth={2} />
            {nFacets > 0 && <span className="vl-more__dot" />}
          </button>
      {/* ══ THE PHONE'S ⋯ MENU ═════════════════════════════════════════════
            *
            * A DROPDOWN, NOT A SHEET (Leon, Aug 6). The sheet worked and it was the
            * wrong object: it is a surface this product does not otherwise have, so
            * one screen size had a component to itself. This is `.pe-menu` — the same
            * shell, radius, padding, row height, type, icons, hover and dismiss as
            * every other dropdown in the app — anchored to the ⋯ it came from.
            *
            * It stays compact by DRILLING DOWN, which is the pattern Projects
            * already uses for "Move to project": the root is four rows, each naming
            * its current value, and Theme and Filter open in place with a back row.
            * Mood visuals needs no panel — it is binary, so the root row toggles it
            * and shows the state it is in. */}
          {sheet && (
            <>
              <span className="vl-scrim" onClick={() => { setSheet(false); setPane(null); }} />
              <span className="pe-menu vl-menu vl-menu--more" role="menu">
                {pane === null && (
                  <>
                    <button role="menuitem" onClick={() => setPane('filter')}>
                      <Icon name="filter" size={17} strokeWidth={2} />
                      <span className="pe-menu__grow">Filter</span>
                      <span className="vl-menu__n">{nFacets ? `${nFacets} on` : 'None'}</span>
                      <Icon name="chevron-right" size={16} strokeWidth={2} />
                    </button>
                    <span className="pe-menu__sep" />
                    {/* IT WAS A BUTTON THAT DID NOTHING (Leon, Aug 7). The
                      * phone's only route to Library Settings had no handler at
                      * all — pressing it closed nothing and went nowhere. Every
                      * entry point to that page is a real link now. */}
                    <Link
                      role="menuitem"
                      to="/dashboard/library-settings"
                      onClick={() => { setSheet(false); setPane(null); }}
                    >
                      <Icon name="settings" size={17} strokeWidth={2} />
                      <span className="pe-menu__grow">Library settings</span>
                    </Link>
                  </>
                )}

                {pane === 'filter' && (
                  <>
                    <button role="menuitem" className="pe-menu__back" onClick={() => setPane(null)}>
                      <Icon name="chevron-left" size={17} strokeWidth={2} />
                      <span className="pe-menu__grow">Filter</span>
                    </button>
                    <span className="pe-menu__sep" />
                    <span className="pe-menu__label">Category</span>
                    <button
                      role="menuitemcheckbox"
                      aria-checked={allOn}
                      className={allOn ? 'is-on' : ''}
                      onClick={() => pickCat('all')}
                    >
                      <span className="vl-menu__tick">
                        {allOn && <Icon name="check" size={17} strokeWidth={2} />}
                      </span>
                      <span className="pe-menu__grow">All layouts</span>
                      <span className="vl-menu__n">{all.length}</span>
                    </button>
                    {CATEGORIES.map((c) => {
                      const n = all.filter((l) => l.cat === c.id).length;
                      const on = cats.has(c.id);
                      return (
                        <button
                          key={c.id}
                          role="menuitemcheckbox"
                          aria-checked={on}
                          className={on ? 'is-on' : ''}
                          disabled={!n}
                          onClick={() => pickCat(c.id)}
                        >
                          <span className="vl-menu__tick">
                            {on && <Icon name="check" size={17} strokeWidth={2} />}
                          </span>
                          <span className="pe-menu__grow">{c.label}</span>
                          <span className="vl-menu__n">{n}</span>
                        </button>
                      );
                    })}
                    {FACETS.map((f, i) => {
                      const n = all.filter((l) => f.test(l, off)).length;
                      const on = facets[f.pair] === f.id;
                      return (
                        <span key={f.id} className="vl-menu__slot">
                          {(i === 0 || FACETS[i - 1].group !== f.group) && (
                            <span className="pe-menu__label">{f.group}</span>
                          )}
                          <button
                            role="menuitemcheckbox"
                            aria-checked={on}
                            disabled={!n}
                            className={on ? 'is-on' : ''}
                            onClick={() => pressFacet(f)}
                          >
                            <span className="vl-menu__tick">
                              {on && <Icon name="check" size={17} strokeWidth={2} />}
                            </span>
                            <span className="pe-menu__grow">{f.label}</span>
                            <span className="vl-menu__n">{n}</span>
                          </button>
                        </span>
                      );
                    })}
                    {nFacets > 0 && (
                      <>
                        <span className="pe-menu__sep" />
                        <button role="menuitem" onClick={() => { setFacets({ img: null, use: null }); pickCat('all'); }}>
                          <span className="vl-menu__tick" />
                          <span className="pe-menu__grow">Clear {nFacets === 1 ? 'filter' : 'filters'}</span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </span>
            </>
          )}
        </span>
        </span>
      </header>
      <p className="vl-head__lead">
        We built these layouts using your visual identity.<br />
        Browse, keep what you like, and turn off what you don’t.
      </p>

      {/* THE CATEGORY CHIPS ARE BACK (Leon, Aug 6). They are the fastest way
        * between groups on a desktop — one press, no menu — and they carry their
        * counts where they can be read without opening anything. The row scrolls
        * sideways only when it has to: it does not wrap, so the toolbar above it
        * never grows a second line, and on a window wide enough for all seven
        * there is nothing to scroll. Below 720px they are hidden — the phone
        * reaches a category through ⋯, or opens one with "View all". */}
      {/* ONE ROW: the groups on the left, Filter pinned right (Leon, Aug 7).
        * The chips were a row and Filter was a row above them — two lines of
        * chrome over a page whose content is pictures. They are one line now,
        * and the important part is that the chips SCROLL inside their own track
        * while Filter sits outside it: a studio with seven categories on a narrow
        * window can still reach the filters, which is exactly what a chip row
        * that pushed the button off-screen would have taken away. */}
      <div className="vl-catrow">
      <div className="vl-cats" role="group" aria-label="Layout categories">
        <button
          aria-pressed={allOn}
          className={`vl-chip ${allOn ? 'is-on' : ''}`}
          onClick={() => pickCat('all')}
        >
          All layouts <span className="vl-chip__n">{all.length}</span>
        </button>
        {CATEGORIES.map((c) => {
          const n = all.filter((l) => l.cat === c.id).length;
          return (
            <button
              key={c.id}
              aria-pressed={cats.has(c.id)}
              className={`vl-chip ${cats.has(c.id) ? 'is-on' : ''}`}
              disabled={!n}
              onClick={() => pickCat(c.id)}
            >
              {c.label} <span className="vl-chip__n">{n}</span>
            </button>
          );
        })}
      </div>

        {/* ONE BUTTON, FOUR OPTIONS BEHIND IT (Leon, Aug 6). The facets were a
          * fourth row of their own; four permanent controls for something most
          * visits never touch. Behind a door they cost one button, and the
          * button carries how many are on so a narrowed library can never look
          * like the whole library. */}
        <span className="vl-themewrap">
          <button
            className={`btn btn--tertiary btn--sm vl-ctl vl-filter ${nFacets ? 'is-on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={filterOpen}
            aria-label={nFacets ? `Filter — ${nFacets} applied` : 'Filter'}
            title={nFacets ? `Filter — ${nFacets} applied` : 'Filter layouts'}
            onClick={() => setFilterOpen((v) => !v)}
          >
            <Icon name="filter" size={15} strokeWidth={2} />
            <span className="vl-ctl__label">Filter</span>
            {nFacets > 0 && <span className="vl-filter__n">{nFacets}</span>}
            <Icon name="chevron-down" size={14} strokeWidth={2.5} className="vl-ctl__caret" />
          </button>
          {filterOpen && (
            <>
              <span className="vl-scrim" onClick={() => setFilterOpen(false)} />
              <span className="pe-menu vl-menu vl-menu--filter" role="menu">
                {/* the CATEGORY is not in here — the chips below the toolbar are
                  * the category control on a desktop, and two controls for one
                  * job is exactly what 447 warned about. The phone, which has no
                  * chips, gets its categories in the ⋯ menu instead. */}
                {FACETS.map((f, i) => {
                  /* a facet nothing matches is dead, not a way to an empty page
                     — the category chips say it the same way */
                  const n = all.filter((l) => f.test(l, off)).length;
                  const on = facets[f.pair] === f.id;
                  return (
                    <span key={f.id} className="vl-menu__slot">
                      {(i === 0 || FACETS[i - 1].group !== f.group) && (
                        <span className="pe-menu__label">{f.group}</span>
                      )}
                      <button
                        role="menuitemcheckbox"
                        aria-checked={on}
                        disabled={!n}
                        className={on ? 'is-on' : ''}
                        onClick={() => pressFacet(f)}
                      >
                        {/* the tick keeps its slot when it is not drawn, so the
                            labels do not shuffle sideways as you press them */}
                        <span className="vl-menu__tick">
                          {on && <Icon name="check" size={17} strokeWidth={2} />}
                        </span>
                        <span className="pe-menu__grow">{f.label}</span>
                        <span className="vl-menu__n">{n}</span>
                      </button>
                    </span>
                  );
                })}
                {nFacets > 0 && (
                  <>
                    <span className="pe-menu__sep" />
                    <button
                      role="menuitem"
                      onClick={() => { setFacets({ img: null, use: null }); pickCat('all'); setFilterOpen(false); }}
                    >
                      <span className="vl-menu__tick" />
                      <span className="pe-menu__grow">Clear {nFacets === 1 ? 'filter' : 'filters'}</span>
                    </button>
                  </>
                )}
              </span>
            </>
          )}
        </span>
      </div>

      {/* WHAT IS NARROWING THE PAGE, SAID IN WORDS (Leon, Aug 6). The count on
        * the Filter button says how many are on; this says which — and it is the
        * only trace of a filter left on the page once the menu closes, so a
        * library showing 18 of its 22 layouts is never quietly doing so. */}
      {nFacets > 0 && (
        <p className="vl-applied">
          Showing {shown.length} of {all.length} —{' '}
          {[
            /* every chosen category, named — the row used to be able to say one */
            ...(allOn ? [] : CATEGORIES.filter((c) => cats.has(c.id)).map((c) => c.label.toLowerCase())),
            ...FACETS.filter((f) => facets[f.pair] === f.id).map((f) => f.label.toLowerCase()),
          ].filter(Boolean).join(', ')}
          <button className="vl-applied__clear" onClick={() => { setFacets({ img: null, use: null }); pickCat('all'); }}>
            Clear
          </button>
        </p>
      )}


      {shown.length === 0 ? (
        <p className="vl-none">
          No layouts match that.
          {' '}
          <button className="vl-none__link" onClick={() => setFacets({ img: null, use: null })}>
            Show all {all.length} again
          </button>
        </p>
      ) : (
        shownCats.map((c) => (
          <Row
            key={c.id}
            cat={c}
            layouts={shown.filter((l) => l.cat === c.id)}
            off={off}
            mood={mood}
            onToggle={toggle}
            onEdit={() => {}}
            onRemove={remove}
            onOpen={openSection}
            onAdd={setAdding}
          />
        ))
      )}

      {adding && (
        <AddToCategory
          cat={CATEGORIES.find((c) => c.id === adding)}
          existing={all}
          onClose={() => setAdding(null)}
          onDone={commitAdded}
        />
      )}
    </div>
  );
}
