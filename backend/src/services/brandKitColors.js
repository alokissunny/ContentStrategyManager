/*
 * The Brand Kit colour set the studio has selected, read from the Library
 * Settings blob the frontend syncs per handle (User.visualBrand.settings →
 * data.libraryEdits; shape owned by frontend/src/lib/identity.js themesOf /
 * activeThemeIdOf). Used to give the carousel agent the brand's real colours.
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

/**
 * @returns {Promise<{ name, ground, fg, accent }|null>} null when the studio has
 * no Brand Kit colours for this handle.
 */
async function brandKitColors(userId, handle) {
  if (!userId) return null;
  try {
    const user = await User.findById(userId).select('visualBrand.settings').lean();
    const rows = user?.visualBrand?.settings || [];
    const h = normHandle(handle);
    const row = rows.find((r) => (r.handle || '') === h) || (!h && rows.length === 1 ? rows[0] : null);
    if (!row) return null;
    const set = selectedSetOf(asObject(row.data).libraryEdits);
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

module.exports = { brandKitColors, brandStylePalette, selectedSetOf, DEFAULT_PALETTE };
