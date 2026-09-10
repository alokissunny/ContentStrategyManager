/*
 * The studio's visual identity — named colour themes, three type styles, and
 * whether Bauhly may fall back on its own pictures.
 *
 * WHY THIS IS A MODULE AND NOT A PAGE'S LOCAL STATE (Leon, Aug 7).
 *
 * The identity has to mean the same thing in four places at once: the Visual
 * Library, the live preview inside Library Settings, the layouts Bauhly builds,
 * and the weekly plan. So the shape of it, its defaults and the translation
 * from "what the studio chose" to "what CSS paints" live here, and every
 * consumer reads the same function.
 *
 * A studio may keep more than one three-colour theme. Only the active one
 * paints; `paintOf` / `paintAll` / `identityOf` resolve it so callers never
 * have to know the list exists.
 */

/* the faces the product actually ships. Not a font menu — anything else would
   be a face the app has no file for. */
export const FACES = [
  { id: 'display', label: 'Cabinet Grotesk', stack: "'Cabinet Grotesk', 'Bricolage Grotesque', Inter, system-ui, sans-serif" },
  { id: 'ui', label: 'Inter', stack: "'Inter', system-ui, -apple-system, sans-serif" },
  { id: 'mono', label: 'Spline Sans Mono', stack: "'Spline Sans Mono', ui-monospace, SFMono-Regular, monospace" },
  { id: 'annotation', label: 'Instrument Serif', stack: "'Instrument Serif', Georgia, serif" },
];
export const faceOf = (id) => FACES.find((f) => f.id === id) || FACES[0];

/* ── A STUDIO'S OWN FACES (Leon, Aug 7) ───────────────────────────────────
 * The four above are files this app ships. A studio may add their own, which
 * means an actual font FILE — a family name typed into a box is a font the
 * browser almost certainly does not have, and a preview that silently falls back
 * to Inter while claiming to be Canela is the product lying about what it will
 * print. `registerFont` loads the file through the FontFace API so the specimen,
 * the preview and the library all draw the real thing.
 *
 * It lasts the session, like every other upload in this build. */
export function registerFont(name, url) {
  try {
    const face = new FontFace(name, `url(${url})`);
    return face.load().then((f) => { document.fonts.add(f); return true; }).catch(() => false);
  } catch { return Promise.resolve(false); }
}
/* every face on offer: the product's, then the studio's */
export const facesWith = (custom) => [
  ...FACES,
  ...(Array.isArray(custom) ? custom : []).map((c) => ({ id: c.id, label: c.name, stack: `'${c.name}', ${FACES[1].stack}`, own: true })),
];
export const stackOf = (id, custom) => (facesWith(custom).find((f) => f.id === id) || FACES[0]).stack;

/* ── THREE SLOTS AGAIN (Leon, Aug 7 — reverses the two-slot rule above) ────
 *
 * It was three, then two on the reasoning that a layout only sets a heading
 * face and a body face, and the eyebrow is the body face at a smaller size.
 * Asked for three, and the third has a real consumer: `--t-detail-face` is
 * read by the eyebrow and the small labels in `visuallibrary.css`, which is a
 * genuinely different job from body copy — it is the line that names the kind
 * of post, and studios set it in a different face on purpose.
 *
 * Detail DEFAULTS to the UI face, so a studio who never touches it gets exactly
 * what the two-slot version gave them. Nothing changes until they change it. */
export const TYPE_SLOTS = [
  { id: 'headline', label: 'Heading font', face: 'display' },
  { id: 'body', label: 'Body font', face: 'ui' },
  { id: 'detail', label: 'Detail font', face: 'ui' },
];

/* THE THREE A PALETTE IS MADE OF, in the studio's words rather than the
   stylesheet's (Leon, Aug 7): the ink most of it is written in, the one colour
   that points, and the ground it all sits on. They map to the three custom
   properties the artwork reads — `fg`, `accent`, `ground` — and nothing else in
   the palette is editable, because everything else derives from these.
   The same values live in `visuallibrary.css` as the CSS defaults, so a studio
   who has changed nothing gets them from the stylesheet, never through here. */
export const COLOUR_ROLES = [
  { id: 'fg', label: 'Primary', use: 'Type, and every dark surface.' },
  { id: 'accent', label: 'Accent', use: 'The one colour that points.' },
  { id: 'ground', label: 'Neutral', use: 'The ground a layout sits on.' },
];
export const DEFAULT_PALETTE = { ground: '#f4f2ee', fg: '#1b100d', accent: '#ff5227' };
export const THEME_CAP = 6;

/* ── LOGOS (Library Settings, Sep 2026) ────────────────────────────────────
 * Four named files plus a corner. The files live in S3 (see api/visualBrand);
 * the corner is part of the identity blob so it applies with Update Library
 * the same way a colour does. `markForTone` is how a layout picks which file
 * to draw: inverted marks on dark/photo grounds, the wordmark before the
 * symbol, and nothing when the studio has not added one yet. */
export const LOGO_SLOTS = [
  { id: 'full', label: 'Full', inverted: false, kind: 'wordmark' },
  { id: 'fullInverted', label: 'Full inverted', inverted: true, kind: 'wordmark' },
  { id: 'symbol', label: 'Symbol', inverted: false, kind: 'mark' },
  { id: 'symbolInverted', label: 'Symbol inverted', inverted: true, kind: 'mark' },
];
export const LOGO_POSITIONS = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];
export const DEFAULT_LOGO_POSITION = 'top-left';

export function logoPositionOf(edits) {
  const e = asObject(edits);
  const fromFlat = typeof e.logoPosition === 'string' ? e.logoPosition : '';
  const fromObj = typeof asObject(e.logo).position === 'string' ? e.logo.position : '';
  const wanted = fromFlat || fromObj;
  return LOGO_POSITIONS.some((p) => p.id === wanted) ? wanted : DEFAULT_LOGO_POSITION;
}

/* slots is `{ [slotId]: { url, key, title } }`. Returns the record a layout of
   this tone should draw, or null. */
export function markForTone(slots, tone) {
  const map = slots && typeof slots === 'object' && !Array.isArray(slots) ? slots : {};
  const pick = (id) => {
    const v = map[id];
    return v && typeof v === 'object' && v.url ? { ...v, slot: id } : null;
  };
  const invert = tone === 'accent' || tone === 'photo';
  if (invert) return pick('fullInverted') || pick('symbolInverted') || pick('full') || pick('symbol');
  return pick('full') || pick('symbol') || pick('fullInverted') || pick('symbolInverted');
}

/* ── READING A STORE THAT MAY BE OLDER THAN THIS FILE ─────────────────────
 *
 * (Leon, Aug 7 — after the page crashed for anyone with a session from before
 * the rewrite.) The Aug 6 shape was `{ themes: {...}, fonts: { display, body } }`
 * — `fonts` an OBJECT. This file spread it as an array, and `[...{}]` throws, so
 * Library Settings died on mount with `(e.fonts || []) is not iterable` before it
 * could draw the Reset button that would have cleared it.
 *
 * Two lessons, both applied:
 *
 *   1 · A settings page reads DATA THAT OUTLIVES ITS OWN SHAPE. Every field is
 *       checked for the type it must be, not merely for existence — `|| []` is
 *       not a guard when the wrong type is truthy.
 *   2 · The old values are MIGRATED, not discarded. A studio's palette and faces
 *       survive the shape change; `store.load()` rewrites them once (see
 *       `migrateIdentity`). Throwing them away to fix a crash would be fixing our
 *       bug with their work.
 */
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const asArray = (v) => (Array.isArray(v) ? v : []);
const asHex = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined);

/* three hexes, only the ones that are actually colours */
function paletteFrom(obj) {
  const palette = {};
  ['ground', 'fg', 'accent'].forEach((k) => {
    const v = asHex(asObject(obj)[k]);
    if (v) palette[k] = v;
  });
  return palette;
}

function titleCase(id) {
  const s = String(id || '').replace(/[-_]+/g, ' ').trim();
  if (!s) return '';
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function newThemeId() {
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function nextThemeName(themes) {
  const used = new Set(asArray(themes).map((t) => String(t?.name || '').trim().toLowerCase()));
  let n = 1;
  while (used.has(`theme ${n}`)) n += 1;
  return `Theme ${n}`;
}

/* named themes, oldest first. A session that still has a flat `palette` (or
   the pre-Aug-7 `{ themes: { bold: {...} } }` object) reads as one or more
   themes here, so Library Settings and the painters never see two shapes. */
export function themesOf(edits) {
  const e = asObject(edits);
  if (Array.isArray(e.themes)) {
    const listed = e.themes
      .filter((t) => t && typeof t === 'object' && t.id)
      .map((t, i) => ({
        id: String(t.id),
        name: (typeof t.name === 'string' && t.name.trim()) ? t.name.trim() : `Theme ${i + 1}`,
        palette: paletteFrom(t.palette),
      }));
    if (listed.length) return listed;
  }
  const old = asObject(e.themes);
  const fromOld = Object.entries(old).map(([id, t], i) => ({
    id: String(id),
    name: (typeof asObject(t).name === 'string' && asObject(t).name.trim())
      ? asObject(t).name.trim()
      : (titleCase(id) || `Theme ${i + 1}`),
    palette: paletteFrom(t),
  }));
  if (fromOld.length) return fromOld;
  return [{ id: 'theme-1', name: 'Theme 1', palette: paletteFrom(e.palette) }];
}

export function activeThemeIdOf(edits) {
  const themes = themesOf(edits);
  const wanted = String(asObject(edits).activeThemeId || '');
  return themes.some((t) => t.id === wanted) ? wanted : themes[0].id;
}

export function activeThemeOf(edits) {
  const themes = themesOf(edits);
  const id = activeThemeIdOf(edits);
  return themes.find((t) => t.id === id) || themes[0];
}

/* write the active theme back onto the edits blob, including a flat `palette`
   mirror so anything still reading that key stays in step. */
export function withActiveTheme(edits, themeId) {
  const e = asObject(edits);
  const themes = themesOf(e);
  const id = String(themeId || '');
  const active = themes.find((t) => t.id === id) || themes[0];
  return {
    ...e,
    themes,
    activeThemeId: active.id,
    palette: { ...active.palette },
  };
}

/* the pre-Aug-7 shape, carried forward rather than dropped. Returns null when
   there is nothing to migrate, so `load()` can leave the store untouched. */
export function migrateIdentity(edits) {
  const e = asObject(edits);
  const themesAreOldObject = e.themes && typeof e.themes === 'object' && !Array.isArray(e.themes);
  const fontsAreOldObject = typeof e.fonts === 'object' && !Array.isArray(e.fonts) && e.fonts != null;
  if (!themesAreOldObject && !fontsAreOldObject) {
    if (Array.isArray(e.fonts) || e.fonts === undefined) return null;
  }
  const themes = themesOf(e);
  const active = activeThemeOf(e);
  /* the faces: `{ display, body }` became `{ headline: { face }, body: { face } }` */
  const oldFonts = asObject(e.fonts);
  const type = { ...asObject(e.type) };
  if (typeof oldFonts.display === 'string' && !type.headline) type.headline = { face: oldFonts.display };
  if (typeof oldFonts.body === 'string' && !type.body) type.body = { face: oldFonts.body };
  return {
    themes,
    activeThemeId: active.id,
    palette: { ...active.palette },
    type,
    fonts: asArray(e.fonts),
    logoPosition: logoPositionOf(e),
  };
}

/* the shape we persist — themes normalised so a later read compares equal */
export function commitIdentity(edits) {
  const ident = identityOf({ libraryEdits: edits });
  return {
    themes: ident.themes.map((t) => ({ id: t.id, name: t.name, palette: { ...t.palette } })),
    activeThemeId: ident.activeThemeId,
    palette: { ...ident.palette },
    type: { ...ident.type },
    fonts: ident.fonts.map((f) => ({ ...f })),
    logoPosition: ident.logoPosition,
  };
}

export const identityOf = (store) => {
  const e = asObject(store?.libraryEdits);
  const themes = themesOf(e);
  const active = activeThemeOf(e);
  return {
    palette: active.palette,
    themes,
    activeThemeId: active.id,
    type: asObject(e.type),
    /* only a real list of `{ id, name, url }` — a stale object shape reads as
       "no fonts of their own", which is true and does not throw */
    fonts: asArray(e.fonts).filter((f) => f && typeof f === 'object' && f.id && f.name && f.url),
    logoPosition: logoPositionOf(e),
    /* THERE IS NO `systemImages` HERE ANY MORE (Leon, Aug 7). It was the old
       `layoutMood` key, surfaced as a switch in Library Settings; the switch is
       removed and the library no longer reads it. The key may still sit in an
       existing session's store — it is simply ignored, which is cheaper and
       safer than a migration that rewrites everyone's state to delete a field
       nothing looks at. */
  };
};

/* "what the studio chose" → "what CSS paints". Only what they actually changed
   is emitted, so anything untouched keeps coming from the stylesheet and there
   is never a second copy of the defaults to drift. */
export function paintOf(edits) {
  const out = {};
  const p = activeThemeOf(edits).palette;
  if (p.ground) out['--t-ground-bg'] = p.ground;
  if (p.fg) out['--t-ground-fg'] = p.fg;
  if (p.accent) out['--t-accent-bg'] = p.accent;

  const t = asObject(edits?.type);
  TYPE_SLOTS.forEach((slot) => {
    const v = t[slot.id];
    if (v?.face) out[`--t-${slot.id}-face`] = stackOf(v.face, asArray(edits?.fonts));
  });
  /* Detail is its own slot again, so it emits its own value. It FALLS BACK to
     the body face rather than to the stylesheet, which is what the two-slot
     version did: a studio who sets a body face and never opens Detail still
     gets their face on the eyebrows, exactly as before (Leon, Aug 7). */
  if (!t.detail?.face && t.body?.face) out['--t-detail-face'] = stackOf(t.body.face, asArray(edits?.fonts));
  return out;
}

/* WeekView and DynamicLayout cannot fall back to `--font-display` / `--font-ui`.
   `.app` overwrites those to the product's system face, so a Library Settings
   choice of Cabinet Grotesk would silently paint as ui-sans-serif. This always
   emits the three colours and the three stacks the studio is actually seeing. */
export function paintAll(edits) {
  const ident = identityOf({ libraryEdits: edits });
  const palette = { ...DEFAULT_PALETTE, ...ident.palette };
  const fonts = ident.fonts;
  return {
    '--t-ground-bg': palette.ground,
    '--t-ground-fg': palette.fg,
    '--t-accent-bg': palette.accent,
    '--t-headline-face': stackOf(ident.type?.headline?.face || 'display', fonts),
    '--t-body-face': stackOf(ident.type?.body?.face || 'ui', fonts),
    '--t-detail-face': stackOf(ident.type?.detail?.face || ident.type?.body?.face || 'ui', fonts),
  };
}

/* the face a slot is showing, chosen or default */
export const slotFace = (identity, slot) => identity.type?.[slot.id]?.face || slot.face;
