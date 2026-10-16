/*
 * The Brand Kit colour set the studio has selected, read from the Library
 * Settings blob the frontend syncs per handle (User.visualBrand.settings →
 * data.libraryEdits; shape owned by frontend/src/lib/identity.js themesOf /
 * activeThemeIdOf). Used to give the carousel agent the brand's real colours
 * and fonts.
 */

const User = require('../models/User');

// frontend/src/lib/identity.js DEFAULT_PALETTE — what the Brand Kit SHOWS for a
// colour role the studio never edited (only edited roles are saved), so the
// agents get the same three colours the studio sees.
const DEFAULT_PALETTE = { ground: '#F4F2EE', fg: '#1B100D', accent: '#FF5227' };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const hexOf = (v) => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toUpperCase() : '');
const normHandle = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

function paletteOf(obj) {
  const p = asObject(obj);
  return { ground: hexOf(p.ground), fg: hexOf(p.fg), accent: hexOf(p.accent) };
}

// Mirrors themesOf + activeThemeIdOf: the list of named sets (or the older
// `{ themes: { id: {...} } }` / flat `palette` shapes) and the one selected.
function selectedSetOf(edits) {
  const e = asObject(edits);
  let sets = [];
  if (Array.isArray(e.themes)) {
    sets = e.themes
      .filter((t) => t && typeof t === 'object' && t.id)
      .map((t, i) => ({ id: String(t.id), name: String(t.name || '').trim() || `Theme ${i + 1}`, palette: paletteOf(t.palette) }));
  }
  if (!sets.length) {
    sets = Object.entries(asObject(e.themes))
      .map(([id, t]) => ({ id: String(id), name: String(asObject(t).name || '').trim() || id, palette: paletteOf(t) }));
  }
  if (!sets.length) sets = [{ id: 'theme-1', name: 'Theme 1', palette: paletteOf(e.palette) }];
  const wanted = String(e.activeThemeId || '');
  return sets.find((t) => t.id === wanted) || sets[0];
}

// The studio's Library Settings blob for this handle (libraryEdits), or null.
async function kitEditsOf(userId, handle) {
  if (!userId) return null;
  const user = await User.findById(userId).select('visualBrand.settings').lean();
  const rows = user?.visualBrand?.settings || [];
  const h = normHandle(handle);
  const row = rows.find((r) => (r.handle || '') === h) || (!h && rows.length === 1 ? rows[0] : null);
  return row ? asObject(asObject(row.data).libraryEdits) : null;
}

/**
 * @returns {Promise<{ name, ground, fg, accent }|null>} null when the studio has
 * no Brand Kit colours for this handle.
 */
async function brandKitColors(userId, handle) {
  try {
    const edits = await kitEditsOf(userId, handle);
    if (!edits) return null;
    const set = selectedSetOf(edits);
    const p = set.palette;
    if (!p.ground && !p.fg && !p.accent) return null;
    return {
      name: set.name,
      ground: p.ground || DEFAULT_PALETTE.ground,
      fg: p.fg || DEFAULT_PALETTE.fg,
      accent: p.accent || DEFAULT_PALETTE.accent,
      defaulted: ['ground', 'fg', 'accent'].filter((k) => !p[k]),
    };
  } catch (err) {
    console.warn('[brandKitColors] could not read Brand Kit colours:', err.message);
    return null;
  }
}

// frontend/src/lib/identity.js FACES — the faces the app ships, with the
// stylesheet that loads each (the same links as frontend/index.html).
const SHIPPED_FACES = {
  display: {
    family: 'Cabinet Grotesk',
    stack: "'Cabinet Grotesk', 'Bricolage Grotesque', Inter, system-ui, sans-serif",
    stylesheet: 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800&display=swap',
  },
  ui: {
    family: 'Inter',
    stack: "'Inter', system-ui, -apple-system, sans-serif",
    stylesheet: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  mono: {
    family: 'Spline Sans Mono',
    stack: "'Spline Sans Mono', ui-monospace, SFMono-Regular, monospace",
    stylesheet: 'https://fonts.googleapis.com/css2?family=Spline+Sans+Mono:wght@400;500&display=swap',
  },
  annotation: {
    family: 'Instrument Serif',
    stack: "'Instrument Serif', Georgia, serif",
    stylesheet: 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap',
  },
};

// One Typography slot → what the carousel agent writes. A studio's own font is
// an uploaded file the app supplies at render time (identity.js facesWith), so
// it has no stylesheet — the agent names it first in the stack.
function faceInfo(id, ownFonts) {
  if (!id) return null;
  const shipped = SHIPPED_FACES[id];
  if (shipped) return { ...shipped };
  const own = ownFonts.find((f) => f && f.id === id && typeof f.name === 'string' && f.name.trim());
  if (!own) return null;
  const family = own.name.trim().replace(/['"\\]/g, '');
  return {
    family,
    stack: `'${family}', ${SHIPPED_FACES.ui.stack}`,
    stylesheet: '',
    note: "the studio's own uploaded font — the app loads the file; do not try to load it",
  };
}

/**
 * The Brand Kit's Typography — only the slots the studio chose (detail falls
 * back to a chosen body face), mirroring identity.js brandFontVars.
 * @returns {Promise<{ heading?, body?, detail? }|null>} each `{ family, stack,
 * stylesheet, note? }`; null when the studio chose no fonts for this handle.
 */
async function brandKitFonts(userId, handle) {
  try {
    const edits = await kitEditsOf(userId, handle);
    if (!edits) return null;
    const t = asObject(edits.type);
    const own = Array.isArray(edits.fonts) ? edits.fonts : [];
    const slots = {
      heading: faceInfo(asObject(t.headline).face, own),
      body: faceInfo(asObject(t.body).face, own),
      detail: faceInfo(asObject(t.detail).face || asObject(t.body).face, own),
    };
    const out = Object.fromEntries(Object.entries(slots).filter(([, v]) => v));
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.warn('[brandKitColors] could not read Brand Kit fonts:', err.message);
    return null;
  }
}

// The `fonts` BRAND_STYLE carries to the carousel agent: one entry per chosen
// role (heading / body / detail) plus the stylesheets to <link>.
function brandStyleFonts(fonts) {
  if (!fonts) return null;
  const stylesheets = [...new Set(Object.values(fonts).map((f) => f.stylesheet).filter(Boolean))];
  return {
    source: 'Brand Kit Typography — chosen by the studio; use exactly these families for these roles',
    ...fonts,
    ...(stylesheets.length ? { stylesheets } : {}),
  };
}

// The `palette` BRAND_STYLE carries to the carousel agent, named as the Brand
// Kit names them (Primary / Accent / Neutral→background). The image prompts
// built from it (planOrchestrator.brandPaletteOf) read primary / accent /
// background too.
function brandStylePalette(colors) {
  if (!colors) return null;
  return {
    source: `Brand Kit colour set "${colors.name}" — selected by the studio; use these exact colours`,
    primary: colors.fg,
    accent: colors.accent,
    background: colors.ground,
  };
}

module.exports = {
  brandKitColors, brandStylePalette, brandKitFonts, brandStyleFonts, selectedSetOf, DEFAULT_PALETTE,
};
