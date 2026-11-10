/*
 * The Editor's ⋯ — ported from bauhly-v3 `src/pages/app/editor/PostMenu.jsx`
 * (`EditorMore`, Sep 28 layout). The root is five categories — Layout · Theme ·
 * Content (Image · Logo) · Style (Colours · Background) · Slide (Add · Copy
 * settings to · Video cover · Remove slide) — and Reset edits under a rule.
 *
 * Levels open IN PLACE with a back row at the top, as in the reference, rather
 * than as side flyouts. A row that asks "how far does this go?" on a carousel
 * walks one level further to This slide / All slides; on a single-slide post
 * it just applies.
 *
 * Everything the menu does is handed in as `acts` by WeekView; this file only
 * decides what to draw.
 */

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Icon from '../../brand/Icon';
import HtmlThemeThumb from './HtmlThemeThumb';
import { COLOUR_ROLES, DEFAULT_PALETTE } from '../../lib/identity';

/* what Copy settings can carry between slides (bauhly-v3 COPY_KINDS, cut to
   the dressing a slide here keeps of its own) */
export const COPY_KINDS = [
  { id: 'text', icon: 'type', label: 'Text styles', hint: 'Font, size, weight, spacing and colour of each text part' },
  { id: 'colour', icon: 'droplet', label: 'Colours', hint: 'The set this slide is drawn in' },
  { id: 'ground', icon: 'image', label: 'Background', hint: 'The ground behind it' },
  { id: 'logo', icon: 'pin', label: 'Logo', hint: 'Your mark on this slide' },
];

/* ══ the Editor grid's selection (bauhly-v3 lib/slide-scope.js) ══════════════
   `{ n, all }` while the grid is on: every act reaches the selected slides (or,
   with nothing selected, the whole post), so the rows say so — "this slide"
   becomes "the 2 selected slides" / "every slide". WeekView provides it around
   EditorMore; a menu outside it reads null and is unchanged. */
export const SlideScope = createContext(null);
function scopeWords(scope) {
  if (!scope || (!scope.all && !(scope.n > 1))) return null;
  const many = scope.all ? 'every slide' : `the ${scope.n} selected slides`;
  const cap = many[0].toUpperCase() + many.slice(1);
  const plural = !scope.all;
  const say = (t) => (typeof t !== 'string' ? t : t
    .replace(/^This slide only$/, cap)
    .replace(/^This slide$/, cap)
    .replace(/\bthis slide is\b/gi, plural ? 'these slides are' : 'every slide is')
    .replace(/\bthis slide\b/g, plural ? 'these slides' : 'every slide')
    .replace(/\bThis slide\b/g, plural ? 'These slides' : 'Every slide')
    .replace(/^Before or after this one$/, plural ? 'Before the first or after the last selected' : 'Before the first or after the last')
    .replace(/\bthis frame\b/g, plural ? 'these frames' : 'every frame')
    .replace(/before this one/, plural ? 'before the first selected' : 'before the first')
    .replace(/after this one/, plural ? 'after the last selected' : 'after the last'));
  return { say, n: scope.n, all: scope.all };
}
export function Rows({ rows, onClose }) {
  const sw = scopeWords(useContext(SlideScope));
  if (sw) {
    rows = rows.map((r) => {
      if (r.rule || r.back) return r;
      const label = (r.id === 'removeslide' || r.id === 'rmonly') && !sw.all ? `Remove ${sw.n} slides` : sw.say(r.label);
      const out = (r.id === 'removeslide' || r.id === 'rmonly') && (sw.all || !r.fn); // the post keeps a slide
      return { ...r, label, hint: sw.say(r.hint), dead: r.dead || out || !r.fn };
    });
  }
  return rows.map((r) => (r.rule ? (
    <span key={r.id} className="wv-em__rule" role="separator" />
  ) : (
    <button
      key={r.id}
      type="button"
      role={r.on === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={r.on === undefined ? undefined : !!r.on}
      disabled={!!r.dead}
      className={`wv-em__row${r.back ? ' wv-em__row--back' : ''}${r.bad ? ' is-danger' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (r.dead) return;
        r.fn?.();
        // `stay`: the act opens its own panel, which hides the menu itself
        if (!r.into && !r.stay) onClose();
      }}
    >
      {r.swatches ? (
        <span className="wv-em__sw" aria-hidden="true">
          {r.swatches.map((hex, i) => <i key={`${r.id}-${i}`} style={{ background: hex || '#e5e2da' }} />)}
        </span>
      ) : (
        <Icon name={r.icon} size={17} strokeWidth={2} />
      )}
      <span className="wv-em__grow">
        <span className="wv-em__label">{r.label}</span>
        {r.hint && <em className="wv-em__hint">{r.hint}</em>}
      </span>
      {r.badge ? <span className="wv-em__chip">{r.badge}</span> : null}
      {r.on ? <Icon name="check" size={16} strokeWidth={2.4} /> : null}
      {((r.into && !r.back && r.on === undefined) || r.chevron)
        ? <Icon name="chevron-right" size={15} strokeWidth={2} /> : null}
    </button>
  )));
}

function FilePick({ inputRef, onFile }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onFile(f);
      }}
    />
  );
}

/* `startLevel` / `toolbar` (bauhly-v3 Nov 1–4, the Editor's toolbar under the
   post): each disc opens this menu straight at its own level — Layout,
   Colours, `add` (the `+`), or the root (More). Opened that way, Back goes
   where the studio came from rather than up the ⋯'s hierarchy, and the level
   a disc opened has no Back row at all: the disc, wearing its ×, is the way
   out. In toolbar mode the root drops what the discs already carry. */
export default function EditorMore({ acts, onClose, startLevel = null, toolbar = false }) {
  const [level, setLevelNow] = useState(startLevel);
  // the levels walked through to get here, for Back in toolbar mode
  const trail = useRef([]);
  const setLevel = (next) => {
    if (toolbar) trail.current.push(level);
    setLevelNow(next);
  };
  const n = Math.max(1, acts.slides || 1);
  const many = n > 1;
  // the colour set / background pressed and waiting for its reach
  const [setPick, setSetPick] = useState(null);
  // Copy settings › the kinds ticked (null = all this slide has)
  const [copySel, setCopySel] = useState(null);
  const [bgPick, setBgPick] = useState(false);
  // the direction marked in the theme library, before it is generated
  const [thmPick, setThmPick] = useState(null);
  // a reference photo picked from the device, shown on the card before it is
  // applied: { file, url (object URL), name }
  const [thmRef, setThmRef] = useState(null);
  // the HTML theme marked in its grid, before it is applied
  const [htmlPick, setHtmlPick] = useState(null);
  // the HTML theme templates are fetched the first time their level opens
  useEffect(() => { if (level === 'themehtml') acts.loadHtmlThemes?.(); }, [level]); // eslint-disable-line react-hooks/exhaustive-deps
  // a new colour set, started from the set this slide wears (or the kit's)
  const [newHex, setNewHex] = useState(() => ({ ...DEFAULT_PALETTE, ...(acts.setHexes || {}) }));
  const refFile = useRef(null);
  const imgFile = useRef(null);
  const groundFile = useRef(null);
  const logoFile = useRef(null);

  // Layout: the arrangement marked on the grid, and a composition picture read
  // for one ({ url (object URL), name, id, layName, description })
  const [layPick, setLayPick] = useState(null);
  const [layShot, setLayShot] = useState(null);
  const [layBusy, setLayBusy] = useState(false);
  const [laySaid, setLaySaid] = useState('');
  const layFile = useRef(null);

  const backRow = (label, to = null) => {
    if (!toolbar) return [{ id: 'back', icon: 'chevron-left', label, fn: () => setLevelNow(to), into: true, back: true }];
    // the level a disc opened: the disc is the way out
    if (level === startLevel && !trail.current.length) return [];
    return [{
      id: 'back',
      icon: 'chevron-left',
      label,
      fn: () => {
        if (!trail.current.length) { onClose(); return; }
        setLevelNow(trail.current.pop());
      },
      into: true,
      back: true,
    }];
  };
  // the reach pair every "how far" level ends on
  // …read through the Editor grid's selection (`acts.scope`, bauhly-v3
  // lib/slide-scope.js): nothing selected offers only All slides; two or more
  // turn This slide into "The N selected slides".
  const reach = (put, { one, all }) => {
    const sc = acts.scope;
    const allRow = { id: 'all', icon: 'copy', label: 'All slides', hint: all, fn: () => put(true) };
    if (sc?.all) return [allRow];
    return [
      sc?.n > 1
        ? { id: 'one', icon: 'brief', label: `The ${sc.n} selected slides`, hint: 'The others keep theirs', fn: () => put(false) }
        : { id: 'one', icon: 'brief', label: 'This slide', hint: one, fn: () => put(false) },
      allRow,
    ];
  };

  /* ── Layout (bauhly-v3 PostMenu `layout`) ────────────────────────────
   * The carousel agent's layouts (Default · Full bleed · Floating panel ·
   * Split bands · Editorial) as wireframes: applying one reruns the carousel
   * agent on that layout's prompt, for the whole carousel. Under them, Upload
   * a composition: a picture laid out the way the studio wants, read by AI for
   * its arrangement (it then stands where the grid stood, with what it was read
   * as and an ×) and applied as an AI edit of the slide — this slide / all. */
  if (level === 'layout') {
    const lays = acts.layouts || {};
    const list = lays.list || [];
    const dropShot = () => {
      if (layShot?.url) { try { URL.revokeObjectURL(layShot.url); } catch { /* already gone */ } }
      setLayShot(null);
    };
    const go = (every) => {
      const id = layPick;
      const comp = layShot ? { description: layShot.description } : null;
      dropShot();
      setLayPick(null);
      setLaySaid('');
      if (comp) lays.onApply?.(id, every, comp);
      else lays.onCarousel?.(id);
      onClose();
    };
    const applyRows = !layPick ? [] : (!layShot ? [
      { id: 'go', icon: 'sparkle', label: many ? 'Apply layout to all slides' : 'Apply layout to this post', hint: 'The carousel agent redesigns it in this layout', dead: acts.busy, fn: () => go(true) },
    ] : many ? [
      { id: 'one', icon: 'brief', label: 'Apply layout to this slide', hint: 'The others keep theirs', dead: acts.busy, fn: () => go(false) },
      { id: 'all', icon: 'copy', label: 'Apply layout to all slides', hint: 'The whole carousel takes it', dead: acts.busy, fn: () => go(true) },
    ] : [
      { id: 'go', icon: 'sparkle', label: 'Apply layout to this post', hint: 'Fits this post to that arrangement', dead: acts.busy, fn: () => go(false) },
    ]);
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Layouts')} />
        <FilePick
          inputRef={layFile}
          onFile={async (f) => {
            setLaySaid('');
            setLayBusy(true);
            const url = URL.createObjectURL(f);
            let got = null;
            try { got = await lays.onRead?.(f); } catch { got = null; }
            setLayBusy(false);
            if (!got?.id) {
              URL.revokeObjectURL(url);
              setLaySaid('That picture could not be read');
              return;
            }
            dropShot();
            setLayPick(got.id);
            setLayShot({ url, name: f.name || 'your picture', id: got.id, layName: got.name, description: got.description });
          }}
        />
        {layShot ? (
          <div className="wv-em__thm">
            <span className="wv-em__thmart"><img src={layShot.url} alt="" /></span>
            <span className="wv-em__thmsay">
              <span className="wv-em__thmname">{layShot.layName}</span>
              <span className="wv-em__thmnote" title={layShot.name}>{`Read from ${layShot.name}`}</span>
            </span>
            <button
              type="button"
              className="wv-em__thmx"
              aria-label="Take this picture off"
              onClick={(e) => { e.stopPropagation(); dropShot(); setLayPick(null); }}
            >
              <Icon name="x" size={15} strokeWidth={2.2} />
            </button>
          </div>
        ) : (
          <>
            <div className="wv-em__lays" role="group" aria-label="Layouts">
              {list.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  title={l.name}
                  aria-label={l.name}
                  aria-pressed={layPick === l.id}
                  className={`wv-em__lay wv-em__lay--${l.id}${layPick === l.id ? ' is-pick' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setLayPick(l.id); }}
                >
                  <span className="wv-em__layart" aria-hidden="true"><i /><s /><b /></span>
                  <span className="wv-em__layname">{l.name}</span>
                </button>
              ))}
            </div>
            <Rows
              onClose={onClose}
              rows={[{
                id: 'layref',
                icon: 'image-plus',
                label: layBusy ? 'Reading your picture…' : 'Upload a composition',
                hint: laySaid || 'A picture laid out the way you want',
                dead: layBusy,
                fn: () => layFile.current?.click(),
                into: true,
                chevron: true,
              }]}
            />
          </>
        )}
        {applyRows.length > 0 && <Rows onClose={onClose} rows={[{ id: 'r-lay', rule: true }, ...applyRows]} />}
      </>
    );
  }

  /* ── Themes ─────────────────────────────────────────────────────────── */
  // A direction is chosen two ways — from the library, or read off a photo the
  // studio uploads — and either way it is shown on a card first, then applied to
  // This slide / All slides (bauhly-v3 `pe-thm` + reach).
  if (level === 'theme') {
    const list = acts.themes || [];
    const saved = acts.savedRefs || [];
    const chosen = thmRef
      ? { name: 'Your reference', thumb: thmRef.url, note: `Read from ${thmRef.name}` }
      : (thmPick
        ? (list.find((t) => t.id === thmPick)
          || (() => { const r = saved.find((x) => `ref:${x.id}` === thmPick); return r ? { ...r, note: 'From your references' } : null; })())
        : null);
    const clear = () => {
      if (thmRef?.url) { try { URL.revokeObjectURL(thmRef.url); } catch { /* already gone */ } }
      setThmRef(null);
      setThmPick(null);
    };
    const go = (every) => {
      if (thmRef) {
        const file = thmRef.file;
        setThmRef(null);
        acts.onReference?.(file, every);
        return;
      }
      const t = chosen;
      setThmPick(null);
      if (t?.saved) { acts.onSavedReference?.(t, every); return; }
      acts.onTheme?.(t, every);
    };
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Themes')} />
        <FilePick
          inputRef={refFile}
          onFile={(f) => {
            if (thmRef?.url) { try { URL.revokeObjectURL(thmRef.url); } catch { /* already gone */ } }
            setThmPick(null);
            setThmRef({ file: f, url: URL.createObjectURL(f), name: f.name || 'your photo' });
          }}
        />
        {!chosen ? (
          <Rows
            onClose={onClose}
            rows={[
              { id: 'ref', icon: 'image-plus', label: 'Upload a reference', hint: 'A photograph you like the look of', dead: acts.busy, fn: () => refFile.current?.click(), into: true },
              { id: 'lib', icon: 'droplet', label: 'Choose from library', hint: saved.length ? `${saved.length} of yours · ${list.length} directions` : `${list.length} directions`, dead: acts.busy, fn: () => setLevel('themelib'), into: true, chevron: true },
              ...(acts.onHtmlTheme ? [{
                id: 'html',
                icon: 'layers',
                label: 'HTML themes',
                hint: 'Interior templates, live and editable · experimental',
                badge: 'Beta',
                dead: acts.busy,
                fn: () => { setHtmlPick(null); setLevel('themehtml'); },
                into: true,
                chevron: true,
              }] : []),
              ...(acts.themed ? [
                { id: 'r-untheme', rule: true },
                {
                  id: 'untheme',
                  icon: 'undo',
                  label: 'Remove theme',
                  hint: 'Back to the carousel agent’s design',
                  dead: acts.busy,
                  // a carousel asks how far; a single slide just goes back
                  fn: () => (many ? setLevel('theme-remove') : acts.onRemoveTheme?.(true)),
                  into: many,
                  chevron: many,
                },
              ] : []),
            ]}
          />
        ) : (
          <>
            <div className="wv-em__thm">
              <span className="wv-em__thmart"><img src={chosen.thumb} alt="" /></span>
              <span className="wv-em__thmsay">
                <span className="wv-em__thmname">{chosen.name}</span>
                <span className="wv-em__thmnote" title={chosen.note || ''}>{chosen.note || 'From your library'}</span>
              </span>
              <button
                type="button"
                className="wv-em__thmx"
                aria-label="Choose a different direction"
                onClick={(e) => { e.stopPropagation(); clear(); }}
              >
                <Icon name="x" size={15} strokeWidth={2.2} />
              </button>
            </div>
            <Rows
              onClose={onClose}
              // both a reference photo and a library theme go through the Theme
              // Apply agent: the slide is repainted as a finished image
              rows={many ? reach(go, {
                one: 'Repainted in this look — the others keep theirs',
                all: 'Every slide repainted in this look',
              }).map((r) => ({ ...r, dead: acts.busy })) : [
                {
                  id: 'go',
                  icon: 'sparkle',
                  label: 'Generate theme',
                  hint: 'Repaints this post in the look above',
                  dead: acts.busy,
                  fn: () => go(true),
                },
              ]}
            />
          </>
        )}
      </>
    );
  }
  if (level === 'theme-remove') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Remove theme', 'theme'),
          {
            id: 'one',
            icon: 'brief',
            label: 'This slide',
            hint: acts.slideThemed ? 'Only this slide goes back' : 'This slide has no theme',
            dead: acts.busy || !acts.slideThemed,
            fn: () => acts.onRemoveTheme?.(false),
          },
          { id: 'all', icon: 'copy', label: 'All slides', hint: 'The whole carousel as the carousel agent made it', dead: acts.busy, fn: () => acts.onRemoveTheme?.(true) },
        ]}
      />
    );
  }
  /* ── HTML themes (experimental) ──────────────────────────────────────
   * Fixed interior-design templates (backend htmlThemes.js) filled with the
   * slide's own words and pictures — the slide stays live, editable HTML, and
   * a frame with no picture is left as a placeholder for Content › Image.
   * Tiles are the templates themselves, drawn small. A press marks a tile;
   * the card + This slide / All slides apply it. */
  if (level === 'themehtml') {
    const list = acts.htmlThemes || [];
    const chosen = htmlPick ? list.find((t) => t.id === htmlPick) : null;
    const go = (every) => {
      const t = chosen;
      setHtmlPick(null);
      acts.onHtmlTheme?.(t, every);
    };
    return (
      <>
        <Rows onClose={onClose} rows={backRow('HTML themes', 'theme')} />
        {!chosen ? (
          <>
            <p className="wv-em__gridhead">Experimental</p>
            <p className="wv-em__gridnote">Your words and photos go into the template; empty frames wait for a picture.</p>
            {!list.length && <p className="wv-em__gridnote">{acts.htmlThemesError || 'Loading templates…'}</p>}
            <div className="wv-em__grid" role="radiogroup" aria-label="HTML themes">
              {list.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={htmlPick === t.id}
                  title={`${t.name} — ${t.note} · ${t.photos} photo${t.photos === 1 ? '' : 's'}`}
                  disabled={acts.busy}
                  className={`wv-em__tile wv-em__tile--theme${acts.htmlThemeId === t.id ? ' is-on' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setHtmlPick(t.id); }}
                >
                  <HtmlThemeThumb html={t.html} />
                  <span className="wv-em__tilename">{t.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="wv-em__thm">
              <span className="wv-em__thmart"><HtmlThemeThumb html={chosen.html} /></span>
              <span className="wv-em__thmsay">
                <span className="wv-em__thmname">{chosen.name}</span>
                <span className="wv-em__thmnote" title={chosen.note}>{`${chosen.photos} photo frame${chosen.photos === 1 ? '' : 's'} · ${chosen.note}`}</span>
              </span>
              <button
                type="button"
                className="wv-em__thmx"
                aria-label="Choose a different HTML theme"
                onClick={(e) => { e.stopPropagation(); setHtmlPick(null); }}
              >
                <Icon name="x" size={15} strokeWidth={2.2} />
              </button>
            </div>
            <Rows
              onClose={onClose}
              rows={many ? reach(go, {
                one: 'Re-composed in this look — the others keep theirs',
                all: 'Every slide re-composed in this look',
              }).map((r) => ({ ...r, dead: acts.busy })) : [
                {
                  id: 'go',
                  icon: 'sparkle',
                  label: 'Apply HTML theme',
                  hint: 'Re-composes this post in the look above',
                  dead: acts.busy,
                  fn: () => go(true),
                },
              ]}
            />
          </>
        )}
      </>
    );
  }
  if (level === 'themelib') {
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Choose from library', 'theme')} />
        {(acts.savedRefs || []).length ? (
          <>
            <p className="wv-em__gridhead">Your references</p>
            <div className="wv-em__grid" role="radiogroup" aria-label="Your references">
              {acts.savedRefs.map((r) => (
                <div key={r.id} className="wv-em__tilewrap">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={thmPick === `ref:${r.id}`}
                    title={r.name}
                    className="wv-em__tile wv-em__tile--theme"
                    onClick={(e) => { e.stopPropagation(); setThmRef(null); setThmPick(`ref:${r.id}`); setLevel('theme'); }}
                  >
                    <img src={r.thumb} alt="" loading="lazy" decoding="async" />
                    <span className="wv-em__tilename">{r.name}</span>
                  </button>
                  <button
                    type="button"
                    className="wv-em__tilex"
                    aria-label={`Remove ${r.name} from your references`}
                    title="Remove from your references"
                    onClick={(e) => { e.stopPropagation(); acts.onDeleteSavedReference?.(r); }}
                  >
                    <Icon name="x" size={12} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
            <p className="wv-em__gridhead">Bauhly themes</p>
          </>
        ) : null}
        <div className="wv-em__grid" role="radiogroup" aria-label="Themes">
          {(acts.themes || []).map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={thmPick === t.id}
              title={t.name}
              className={`wv-em__tile wv-em__tile--theme${acts.themeId === t.id ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); setThmRef(null); setThmPick(t.id); setLevel('theme'); }}
            >
              <img src={t.thumb} alt="" loading="lazy" decoding="async" />
              <span className="wv-em__tilename">{t.name}</span>
            </button>
          ))}
        </div>
      </>
    );
  }

  /* ── Colours (bauhly-v3 PostMenu `colour`, Nov 2–3) ────────────────────
   * "Colour palette": the Brand Kit sets, and a press IS the act — the slide
   * in front of the studio is repainted under the open menu and the tick
   * moves (no Generate button). Only the sets scroll; under a rule stand the
   * three other answers: Swap colours · Create a colour set · Bauhly decides.
   * On a Theme Apply picture the set is redrawn by the image model, so it is
   * held in the chat's changes and sent from there (see `onColour`). */
  if (level === 'colour') {
    const sets = acts.sets || [];
    const now = acts.setId || '';
    return (
      <>
        {toolbar && level === startLevel && !trail.current.length
          ? <span className="wv-em__menuhead">Colour palette</span>
          : <Rows onClose={onClose} rows={backRow('Colour palette', 'style')} />}
        <div className="wv-em__scroll">
          <Rows
            onClose={onClose}
            rows={[
              ...sets.map((one) => ({
                id: `set-${one.id}`,
                swatches: one.swatches,
                label: one.name,
                badge: now === one.id ? 'Current' : null,
                on: now === one.id,
                fn: () => { if (now !== one.id) acts.onColour?.(one.id, false); },
                into: true,
              })),
              ...(now && !acts.slideThemed ? [{
                id: 'original',
                icon: 'undo',
                label: 'Original colours',
                hint: 'The colours this carousel was made in',
                fn: () => acts.onColour?.('', false),
                into: true,
              }] : []),
            ]}
          />
        </div>
        <Rows
          onClose={onClose}
          rows={[
            { id: 'r-more', rule: true },
            ...(acts.onSwapColours && now && !acts.slideThemed ? [{
              id: 'colourswap',
              icon: 'refresh',
              label: 'Swap colours',
              hint: 'The same three, in other places',
              fn: () => setLevel('colour-swap'),
              into: true,
              chevron: true,
            }] : []),
            {
              id: 'colournew',
              icon: 'plus',
              label: 'Create a colour set',
              hint: acts.canNewSet ? 'Three of your own' : 'Your Brand Kit is full',
              dead: !acts.canNewSet,
              fn: () => setLevel('colour-new'),
              into: true,
              chevron: true,
            },
            ...(many && sets.length > 1 ? [{
              id: 'colourstory',
              icon: 'sparkle',
              label: 'Bauhly decides',
              hint: 'One set per beat',
              fn: () => { setSetPick({ story: sets.map((x) => x.id) }); setLevel('colour-reach'); },
              into: true,
              chevron: true,
            }] : []),
          ]}
        />
      </>
    );
  }
  if (level === 'colour-swap') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Swap colours', 'colour'),
          {
            id: 'swapone',
            icon: 'brief',
            label: many ? 'Swap colours on this slide' : 'Swap colours',
            hint: 'The ground, the ink and the accent move round',
            fn: () => acts.onSwapColours?.(false),
            into: true,
          },
          ...(many ? [{
            id: 'swapall',
            icon: 'copy',
            label: 'Swap colours on all slides',
            hint: 'Every slide turns its three the same way',
            fn: () => acts.onSwapColours?.(true),
            into: true,
          }] : []),
        ]}
      />
    );
  }
  if (level === 'colour-reach') {
    const story = setPick?.story || null;
    const put = (every) => {
      if (story) acts.onStoryColour?.(story, every);
      else acts.onColour?.(setPick, every);
      setSetPick(null);
    };
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow(story ? 'Bauhly decides' : 'Apply the colours', 'colour'),
          ...reach(put, story
            ? { one: 'The colour the story gives this beat', all: 'A colour per beat, across the arc' }
            : { one: 'The others keep theirs', all: 'The whole carousel wears it' }),
        ]}
      />
    );
  }
  if (level === 'colour-new') {
    return (
      <>
        <Rows onClose={onClose} rows={backRow('New colour set', 'colour')} />
        <div className="wv-em__roles">
          {COLOUR_ROLES.map((r) => (
            <label className="wv-em__role" key={r.id}>
              <span className="wv-em__rolecard" style={{ background: newHex[r.id] }} aria-hidden="true" />
              <b>{r.label}</b>
              <em>{String(newHex[r.id] || '').toUpperCase()}</em>
              <input
                type="color"
                value={newHex[r.id] || '#000000'}
                aria-label={`${r.label} colour`}
                onChange={(e) => setNewHex((was) => ({ ...was, [r.id]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <Rows
          onClose={onClose}
          rows={[
            { id: 'r-new', rule: true },
            {
              id: 'savenew',
              icon: 'check',
              label: 'Save and use it',
              hint: 'Kept in your Brand Kit',
              fn: () => {
                const made = acts.onNewSet?.(newHex);
                if (made) acts.onColour?.(made, false);
              },
            },
          ]}
        />
      </>
    );
  }

  /* ── Image ──────────────────────────────────────────────────────────── */
  if (level === 'image') {
    return (
      <>
        <FilePick inputRef={imgFile} onFile={(f) => { acts.onUploadImage?.(f); onClose(); }} />
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Image', 'content'),
            { id: 'imgup', icon: 'upload', label: 'Upload a photo', hint: 'Use your own image', dead: acts.uploading, fn: () => imgFile.current?.click(), into: true },
            { id: 'imglib', icon: 'image', label: 'Choose from library', hint: 'Images you can use', fn: () => acts.onImageLibrary?.(), stay: true },
            // bauhly-v3 (Nov 2): "Move Background into the Image submenu"
            { id: 'imgbg', icon: 'image', label: 'Background', hint: 'The ground behind it', fn: () => setLevel('background'), into: true, chevron: true },
            ...(acts.onAdjust ? [{ id: 'imgedit', icon: 'crop', label: 'Adjust the photo', hint: 'Crop, straighten and tune it', fn: () => acts.onAdjust() }] : []),
          ]}
        />
      </>
    );
  }

  /* ── Background ─────────────────────────────────────────────────────── */
  if (level === 'background') {
    const own = (acts.grounds || []).filter((g) => g.url);
    const wears = acts.groundId || '';
    const put = (id) => {
      if (!many) { acts.onGround?.(id, false); onClose(); return; }
      setBgPick(id);
      setLevel('background-reach');
    };
    return (
      <>
        <Rows onClose={onClose} rows={backRow('Background', 'style')} />
        <FilePick inputRef={groundFile} onFile={(f) => { acts.onUploadGround?.(f); onClose(); }} />
        <div className="wv-em__grid" role="radiogroup" aria-label="Backgrounds">
          <button
            type="button"
            role="radio"
            aria-checked={wears === 'none'}
            title="Plain canvas"
            className={`wv-em__tile wv-em__tile--ground wv-em__tile--none${wears === 'none' ? ' is-on' : ''}`}
            onClick={(e) => { e.stopPropagation(); put('none'); }}
          >
            <span className="wv-em__none" aria-hidden="true">
              <Icon name="image-off" size={20} strokeWidth={1.8} />
              <i>Plain canvas</i>
            </span>
          </button>
          {own.map((g) => (
            <button
              key={g.key}
              type="button"
              role="radio"
              aria-checked={wears === g.key}
              title={g.isDefault ? `${g.title || 'Background'} · your Brand Kit default` : (g.title || 'Background')}
              className={`wv-em__tile wv-em__tile--ground${wears === g.key ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); put(g.key); }}
            >
              <img src={g.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
        <Rows
          onClose={onClose}
          rows={[
            ...(wears ? [{ id: 'bgoriginal', icon: 'undo', label: 'Original background', hint: 'The ground this carousel was made on', fn: () => put('') , into: many }] : []),
            { id: 'r-bg', rule: true },
            { id: 'groundup', icon: 'upload', label: 'Upload a background', hint: 'Saved to your Brand Kit and put on this slide', fn: () => groundFile.current?.click(), into: true },
          ]}
        />
        <span className="wv-em__pad" aria-hidden="true" />
      </>
    );
  }
  if (level === 'background-reach') {
    const put = (every) => { acts.onGround?.(bgPick === false ? '' : bgPick, every); setBgPick(false); };
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Apply the background', 'background'),
          ...reach(put, { one: 'The others keep theirs', all: 'The whole carousel stands on it' }),
        ]}
      />
    );
  }

  /* ── Logo ───────────────────────────────────────────────────────────── */
  if (level === 'logo') {
    const hasLogo = (acts.logos || []).length > 0;
    const hidden = acts.logoMark === 'off';
    return (
      <>
        <FilePick inputRef={logoFile} onFile={(f) => { acts.onUploadLogo?.(f); onClose(); }} />
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Logo', 'content'),
            ...(hasLogo && hidden ? [{
              id: 'logoon', icon: 'sparkle', label: 'Put it on this slide', hint: 'Your mark, in the post’s own corner', fn: () => acts.onLogo?.(''),
            }] : []),
            ...(hasLogo && !hidden ? [{
              id: 'logoswapkit', icon: 'swatch', label: 'Replace logo', hint: `${acts.logos.length} in your Brand Kit`, fn: () => setLevel('logopick'), into: true, chevron: true,
            }] : []),
            ...(!hasLogo ? [{
              id: 'logoup', icon: 'upload', label: 'Upload your logo', hint: 'Saved to your Brand Kit and put on this slide', dead: acts.uploading, fn: () => logoFile.current?.click(), into: true,
            }] : [{
              id: 'logoswap', icon: 'upload', label: 'Upload a different logo', hint: 'Saved to your Brand Kit and put on this slide', dead: acts.uploading, fn: () => logoFile.current?.click(), into: true,
            }]),
            ...(hasLogo && !hidden ? [
              { id: 'r-logooff', rule: true },
              { id: 'logooff', icon: 'x', label: 'Take it off this slide', hint: 'The others keep theirs', fn: () => acts.onLogo?.('off') },
            ] : []),
          ]}
        />
      </>
    );
  }
  /* the `+`'s Logo (bauhly-v3 ADD_LOGO, Nov 2): the two places a mark can
     come FROM — a new file (kept in the Brand Kit), or the kit's own */
  if (level === 'addlogo') {
    const logos = acts.logos || [];
    return (
      <>
        <FilePick inputRef={logoFile} onFile={(f) => { acts.onUploadLogo?.(f); onClose(); }} />
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Logo', 'add'),
            { id: 'logonew', icon: 'upload', label: 'Add new logo', hint: 'Saved to your kit, and on this slide', dead: acts.uploading, fn: () => logoFile.current?.click(), into: true },
            {
              id: 'logokit',
              icon: 'swatch',
              label: 'Use logo from Brand Kit',
              hint: logos.length ? 'Placed where this composition has room' : 'No logo in your Brand Kit yet',
              dead: !logos.length,
              ...(logos.length > 1
                ? { fn: () => setLevel('logopick'), into: true, chevron: true }
                : { fn: () => acts.onLogo?.('') }),
            },
          ]}
        />
      </>
    );
  }
  if (level === 'logopick') {
    const wears = acts.logoMark || '';
    return (
      <>
        <Rows onClose={onClose} rows={backRow(trail.current[trail.current.length - 1] === 'addlogo' ? 'Use logo from Brand Kit' : 'Replace logo', 'logo')} />
        <div className="wv-em__grid" role="radiogroup" aria-label="Your marks">
          {(acts.logos || []).map((l) => (
            <button
              key={l.slot}
              type="button"
              role="radio"
              aria-checked={wears === l.slot}
              title={l.name}
              className={`wv-em__tile wv-em__tile--logo${l.inverted ? ' is-dark' : ''}${wears === l.slot ? ' is-on' : ''}`}
              onClick={(e) => { e.stopPropagation(); acts.onLogo?.(l.slot); onClose(); }}
            >
              <img src={l.url} alt="" />
            </button>
          ))}
        </div>
        <Rows
          onClose={onClose}
          rows={[
            { id: 'r-logoauto', rule: true },
            { id: 'logoauto', icon: 'sparkle', label: 'Let Bauhly choose', hint: 'The cut and the ink that suit each slide', on: !wears, fn: () => acts.onLogo?.('') },
          ]}
        />
      </>
    );
  }

  /* ── Copy settings to ───────────────────────────────────────────────── */
  if (level === 'text') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Copy settings to', 'slide'),
          { id: 'solo', icon: 'brief', label: 'This slide only', hint: 'The others keep their own', on: !acts.sameAll, fn: () => acts.onSameAll?.(false) },
          { id: 'all', icon: 'copy', label: 'All slides', hint: 'Take these settings to every slide', on: !!acts.sameAll, fn: () => acts.onSameAll?.(true) },
        ]}
      />
    );
  }

  /* ── Slide ──────────────────────────────────────────────────────────── */
  if (level === 'slide') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow(toolbar ? 'Add a slide' : 'Slide'),
          { id: 'before', icon: 'arrow-left', label: 'Add before', hint: 'A new slide before this one', fn: acts.onAddBefore },
          { id: 'after', icon: 'arrow-right', label: 'Add after', hint: 'A new slide after this one', fn: acts.onAddAfter },
          ...(many && !toolbar ? [
            { id: 'r-slide', rule: true },
            { id: 'text', icon: 'sliders', label: 'Copy settings to', fn: () => setLevel('text'), into: true, chevron: true },
          ] : []),
          ...(acts.onVideoCover && !toolbar ? [
            { id: 'r-cover', rule: true },
            { id: 'cover', icon: 'play', label: acts.coverBusy ? 'Creating cover…' : 'Video cover', hint: 'An animated hook for the first slide', dead: acts.coverBusy, fn: acts.onVideoCover },
          ] : []),
          ...(many && !toolbar ? [
            { id: 'r-slidebad', rule: true },
            { id: 'removeslide', icon: 'trash', label: 'Remove slide', hint: 'Takes this frame out of the carousel', fn: acts.onRemoveSlide, bad: true },
          ] : []),
        ]}
      />
    );
  }

  /* ── Remove all edits ───────────────────────────────────────────────── */
  /* Copy settings › the checklist (bauhly-v3 `copyset`): every kind this
     slide has changed, ticked; the button copies the ticked ones */
  if (level === 'copyset') {
    const mine = COPY_KINDS.filter((k) => acts.clipAble?.[k.id]);
    const sel = copySel ?? mine.map((k) => k.id);
    const take = (id) => setCopySel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    return (
      <>
        <Rows
          onClose={onClose}
          rows={[
            ...backRow('Copy settings'),
            ...mine.map((k) => ({ id: `copy-${k.id}`, icon: k.icon, label: k.label, hint: k.hint, on: sel.includes(k.id), into: true, fn: () => take(k.id) })),
          ]}
        />
        <div className="wv-em__go">
          <button
            type="button"
            className="wv-em__gobtn"
            disabled={!sel.length}
            onClick={(e) => {
              e.stopPropagation();
              acts.onCopySettings?.(sel);
              setCopySel(null);
              if (trail.current.length) setLevelNow(trail.current.pop());
              else onClose();
            }}
          >
            <Icon name="copy" size={16} strokeWidth={2.2} />
            {sel.length === 1 ? 'Copy 1 setting' : `Copy ${sel.length} settings`}
          </button>
        </div>
      </>
    );
  }
  if (level === 'pasteset') {
    const c = acts.clip;
    const k = (c?.ids || []).length;
    const say = k === 1 ? 'The one setting you copied' : `The ${k} settings you copied`;
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Paste settings'),
          { id: 'pasteone', icon: 'brief', label: 'Paste to this slide', hint: say, fn: () => acts.onPasteSettings?.(false) },
          ...(many ? [{ id: 'pasteall', icon: 'copy', label: 'Paste to all slides', hint: 'Every frame in the carousel takes them', fn: () => acts.onPasteSettings?.(true) }] : []),
        ]}
      />
    );
  }
  /* Remove slide (bauhly-v3 `remove`, Nov 2): take the frame out alone, or
     take it out and carry its words onto the frame before it */
  if (level === 'remove') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Remove slide'),
          { id: 'rmonly', icon: 'trash', label: 'Remove slide', hint: 'The frames either side are left as they are', fn: acts.onRemoveSlide, bad: true },
          {
            id: 'rmjoin',
            icon: 'layers',
            label: 'Remove & connect slides',
            hint: acts.canJoin ? 'Its words move to the frame before it, so the story runs on' : (acts.joinWhy || 'This frame has no words to carry over'),
            dead: !acts.canJoin,
            fn: acts.onJoinSlide,
            bad: true,
          },
        ]}
      />
    );
  }
  if (level === 'reset') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Reset edits'),
          { id: 'one', icon: 'brief', label: 'This slide only', hint: 'The others keep theirs', dead: !acts.canResetSlide, fn: () => acts.onReset?.(false) },
          { id: 'every', icon: 'copy', label: 'All slides', hint: many ? `All ${n} go back` : 'Nothing else to put back', dead: !many, fn: () => acts.onReset?.(true) },
        ]}
      />
    );
  }

  /* ── Content · Style ───────────────────────────────────────────────
     Landings, not copies: every level they open already existed (bauhly-v3
     PostMenu, Sep 28 "five categories"). Text and Graphic from the reference
     are not wired here yet, so Content holds what is. */
  /* ── Add element (the toolbar's `+`, bauhly-v3 ADD_ELEMENTS, Nov 1–4) ──
     Everything a studio puts on this canvas: a picture, the ground, their
     mark, and — the largest of them — another frame. Each row opens the
     level that already asks its question. */
  if (level === 'add') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Add element'),
          // bauhly-v3 ADD_ELEMENTS (Nov 2–4): Background moved into Image, and
          // Logo opens its own two rows (a new mark, or the kit's)
          { id: 'image', icon: 'image-plus', label: 'Image', hint: 'A photograph on this slide', fn: () => setLevel('image'), into: true, chevron: true },
          { id: 'logo', icon: 'pin', label: 'Logo', hint: 'Your mark on this slide', fn: () => setLevel('addlogo'), into: true, chevron: true },
          { id: 'slide', icon: 'plus', label: 'Add a slide', hint: 'Before or after this one', fn: () => setLevel('slide'), into: true, chevron: true },
        ]}
      />
    );
  }

  if (level === 'content') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Content'),
          { id: 'image', icon: 'image-plus', label: 'Image', hint: 'A photograph on this slide', fn: () => setLevel('image'), into: true, chevron: true },
          { id: 'logo', icon: 'pin', label: 'Logo', hint: 'Your mark on this slide', fn: () => setLevel('logo'), into: true, chevron: true },
        ]}
      />
    );
  }
  if (level === 'style') {
    return (
      <Rows
        onClose={onClose}
        rows={[
          ...backRow('Style'),
          { id: 'colours', icon: 'swatch', label: 'Colours', hint: 'The set this slide is drawn in', fn: () => setLevel('colour'), into: true, chevron: true },
          { id: 'background', icon: 'image', label: 'Background', hint: 'The ground behind it', fn: () => setLevel('background'), into: true, chevron: true },
        ]}
      />
    );
  }

  /* ── The toolbar's More (bauhly-v3 MORE_OMIT, Nov 1–4) ─────────────────
     What the discs do not already carry: the frame's own acts, then the two
     that take something away under a rule — Reset edits, then Remove slide. */
  if (toolbar) {
    // Copy settings (bauhly-v3 PostMenu, Nov 2–3): dead with nothing changed
    // on this slide, the copy itself with one change, a checklist with more.
    // It never closes the menu, so Paste settings lights up underneath.
    const can = COPY_KINDS.filter((k) => acts.clipAble?.[k.id]);
    const copyRow = !can.length
      ? { id: 'copyset', icon: 'copy', label: 'Copy settings', hint: 'Change something on this slide first', dead: true, fn: () => {} }
      : can.length === 1
        ? { id: 'copyset', icon: 'copy', label: 'Copy settings', hint: `${can[0].label}, to another slide`, fn: () => acts.onCopySettings?.([can[0].id]), into: true }
        : { id: 'copyset', icon: 'copy', label: 'Copy settings', hint: 'Choose what goes to another slide', fn: () => setLevel('copyset'), into: true, chevron: true };
    const clip = acts.clip;
    const acts2 = [
      ...(many ? [copyRow] : []),
      ...(many && clip ? [{
        id: 'pasteset',
        icon: 'download',
        label: 'Paste settings',
        hint: clip.at === acts.slideAt ? `${clip.say}, copied from this slide` : `${clip.say} from slide ${clip.at + 1}`,
        fn: () => setLevel('pasteset'),
        into: true,
        chevron: true,
      }] : []),
      ...(acts.onVideoCover ? [{ id: 'cover', icon: 'play', label: acts.coverBusy ? 'Creating cover…' : 'Video cover', hint: 'An animated hook for the first slide', dead: acts.coverBusy, fn: acts.onVideoCover }] : []),
    ];
    // under a rule, the two that take something away: Reset edits (black —
    // it puts back what Bauhly made), then Remove slide (red), each a level
    const away = [
      ...(acts.canReset ? [{ id: 'resetedits', icon: 'undo', label: 'Reset edits', hint: 'Put back what Bauhly made', fn: () => setLevel('reset'), into: true, chevron: true }] : []),
      ...(many ? [{ id: 'removeslide', icon: 'trash', label: 'Remove slide', hint: 'Takes this frame out of the carousel', fn: () => setLevel('remove'), into: true, chevron: true, bad: true }] : []),
    ];
    const rows = [...acts2, ...(acts2.length && away.length ? [{ id: 'r-away', rule: true }] : []), ...away];
    return (
      <Rows
        onClose={onClose}
        rows={rows.length ? rows : [{ id: 'nothing', icon: 'check', label: 'Nothing else to change here', dead: true, fn: () => {} }]}
      />
    );
  }

  /* ── The root ───────────────────────────────────────────────────────────
     bauhly-v3's five categories, in the order a studio meets a post, with
     Reset edits under a rule at the foot. */
  return (
    <Rows
      onClose={onClose}
      rows={[
        { id: 'layouts', icon: 'blocks', label: 'Layout', hint: 'How the carousel is arranged', dead: acts.busy, fn: () => setLevel('layout'), into: true, chevron: true },
        { id: 'themes', icon: 'droplet', label: 'Theme', hint: 'The direction it wears', dead: true /* off for now */, fn: () => setLevel('theme'), into: true, chevron: true },
        { id: 'content', icon: 'layers', label: 'Content', hint: 'Image and logo', fn: () => setLevel('content'), into: true, chevron: true },
        { id: 'style', icon: 'swatch', label: 'Style', hint: 'Colours and background', fn: () => setLevel('style'), into: true, chevron: true },
        { id: 'slide', icon: 'copy', label: 'Slide', hint: many ? 'This frame, and the ones around it' : 'Add another frame', fn: () => setLevel('slide'), into: true, chevron: true },
        ...(acts.canReset ? [
          { id: 'r-reset', rule: true },
          { id: 'resetedits', icon: 'undo', label: 'Reset edits', hint: 'Put back what Bauhly made', fn: () => setLevel('reset'), into: true, chevron: true },
        ] : []),
      ]}
    />
  );
}
