import { identityOf, paintAll, markForTone, FACES } from './identity.js';
import { canvasSafeUrl } from '../api/media.js';

const color = (value, fallback) => /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value || '') ? value : fallback;
export function contrastingText(hex) {
  const value = hex.slice(1).length === 3 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
  const channels = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  return (light + .05) / .05 >= 1.05 / (light + .05) ? '#111111' : '#ffffff';
}

export function resolveReelBrandKit(store, { handle = '', name = '' } = {}) {
  if (!handle && !Object.keys(store?.libraryEdits || {}).length && !Object.keys(store?.brandLogos || {}).length) return null;
  const identity = identityOf(store);
  const paint = paintAll(store?.libraryEdits);
  const selected = identity.themes.find(t => t.id === identity.activeThemeId);
  const logo = markForTone(store?.brandLogos, 'photo');
  const warnings = [];
  const typography = {};
  const activeFonts = [];
  for (const role of ['headline', 'body', 'detail']) {
    const id = identity.type[role]?.face || (role === 'detail' ? identity.type.body?.face : '') || (role === 'headline' ? 'display' : 'ui');
    const custom = identity.fonts.find(f => f.id === id);
    const shipped = FACES.find(f => f.id === id);
    const fallback = FACES.find(f => f.id === (role === 'headline' ? 'display' : 'ui'));
    if (!custom && !shipped) warnings.push(`The ${role} font file is unavailable. Re-add it in Brand Kit; using ${fallback.label}.`);
    const family = custom?.name || (shipped || fallback).label;
    typography[role] = { name: family, stack: custom ? `${JSON.stringify(family)}, sans-serif` : (shipped || fallback).stack };
    if (custom && !activeFonts.some(f => f.id === custom.id)) activeFonts.push(custom);
  }
  return {
    handle, name: name || (handle ? `@${handle}` : ''), themeName: selected?.name || 'Brand theme',
    palette: { fg: color(paint['--t-ground-fg'], '#1b100d'), ground: color(paint['--t-ground-bg'], '#f4f2ee'), accent: color(paint['--t-accent-bg'], '#ff5227') },
    typography, fonts: activeFonts,
    logo: logo ? { ...logo, url: canvasSafeUrl(logo.url, logo.key), position: identity.logoPosition } : null,
    warnings,
  };
}
export function reelBrandStyle(kit) {
  if (!kit) return {};
  return {
    '--reel-accent': kit.palette.accent,
    '--reel-ink': kit.palette.fg,
    '--reel-ground': kit.palette.ground,
    '--reel-on-accent': contrastingText(kit.palette.accent),
    '--reel-heading-font': kit.typography.headline.stack,
    '--reel-body-font': kit.typography.body.stack,
    '--reel-detail-font': kit.typography.detail.stack,
  };
}
// FontFace registrations alone are invisible to DOM-to-image. Stylesheet rules
// let the export embed the actual uploaded font bytes as well as preview them.
export function reelFontCss(kit) {
  return (kit?.fonts || []).map(f => `@font-face{font-family:${JSON.stringify(f.name)};src:url(${JSON.stringify(f.url)});font-display:block;}`).join('\n');
}
export async function waitForReelFonts(kit) {
  if (!kit) return;
  for (const font of kit.fonts || []) {
    if (!(await document.fonts.load(`16px ${JSON.stringify(font.name)}`)).length) throw new Error(`Could not load brand font ${font.name}. Re-add it in Brand Kit before exporting.`);
  }
  await Promise.all(Object.values(kit.typography).map(face => document.fonts.load(`16px ${face.stack}`)));
  await document.fonts.ready;
}
export function reelBrandBrief(kit) {
  return kit ? { name: kit.name, themeName: kit.themeName, palette: kit.palette, accent: kit.palette.accent,
    typography: Object.fromEntries(Object.entries(kit.typography).map(([role, face]) => [role, face.name])),
    logo: kit.logo ? { position: kit.logo.position, slot: kit.logo.slot } : null } : null;
}
