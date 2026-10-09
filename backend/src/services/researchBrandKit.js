const User = require('../models/User');
const { currentUsername } = require('../utils/currentProfile');
const { selectedSetOf, DEFAULT_PALETTE } = require('./brandKitColors');
const { getObjectBytes } = require('./s3Client');
const sharp = require('sharp');
const BUILTINS = { display: 'Cabinet Grotesk', ui: 'Inter', mono: 'Spline Sans Mono', annotation: 'Instrument Serif' };
const FONT_CSS = {
  display: 'https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@400,500,700,800&display=swap',
  ui: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  mono: 'https://fonts.googleapis.com/css2?family=Spline+Sans+Mono:wght@400;500&display=swap',
  annotation: 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap',
};
const fontCache = new Map();
async function embeddedFont(id) {
  if (fontCache.has(id)) return fontCache.get(id);
  const response = await fetch(FONT_CSS[id], { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Brand font stylesheet unavailable.');
  let css = (await response.text()).replace(/src:\s*url\(([^)]+)\)[^;]*;/g, 'src:url($1);');
  for (const match of [...css.matchAll(/url\(([^)]+)\)/g)]) {
    const url = new URL(match[1].replace(/['"]/g, '').trim(), FONT_CSS[id]);
    if (url.protocol !== 'https:' || !['fonts.gstatic.com', 'cdn.fontshare.com'].includes(url.hostname)) throw new Error('Unsupported brand font source.');
    const data = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!data.ok) throw new Error('Brand font file unavailable.');
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) throw new Error('Brand font file too large.');
    css = css.replace(match[0], `url(data:font/woff2;base64,${bytes.toString('base64')})`);
  }
  fontCache.set(id, css);
  return css;
}
function settingsOf(user, handle, uploadedFonts = {}) {
  const brand = user?.visualBrand || {};
  const edits = brand.settings?.find(row => row.handle === handle)?.data?.libraryEdits || {};
  const set = selectedSetOf(edits);
  const palette = Object.fromEntries(Object.entries(DEFAULT_PALETTE).map(([key, value]) => [key, set.palette[key] || value]));
  const faces = { heading: edits.type?.headline?.face || 'display', body: edits.type?.body?.face || 'ui', detail: edits.type?.detail?.face || edits.type?.body?.face || 'ui' };
  const fonts = {};
  const warnings = [];
  const customCss = [];
  const fontData = value => typeof value === 'string' && value.length <= 1500000 && /^data:(?:font\/[\w.+-]+|application\/[\w.+-]+);base64,[A-Za-z0-9+/=]+$/.test(value);
  for (const [role, id] of Object.entries(faces)) {
    const custom = Array.isArray(edits.fonts) ? edits.fonts.find(f => f.id === id) : null;
    fonts[role] = BUILTINS[id] || (custom?.name && String(custom.name).replace(/[^\w -]/g, '').slice(0, 80)) || BUILTINS.ui;
    // Brand Kit currently stores uploaded font blob URLs only for the browser session.
    if (!BUILTINS[id] && custom && fontData(uploadedFonts[id])) {
      customCss.push(`@font-face{font-family:'${fonts[role]}';src:url(${uploadedFonts[id]});font-display:block}`);
    } else if (!BUILTINS[id]) { warnings.push(`${fonts[role]} is a browser-only font; ${role} uses Inter for export. Re-select a built-in font in Brand Kit for matching exports.`); faces[role] = 'ui'; fonts[role] = BUILTINS.ui; }
  }
  const hex = palette.ground.replace('#', '');
  const rgb = hex.length === 3 ? hex.split('').map(v => parseInt(v + v, 16)) : [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const dark = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 < 128;
  const logos = (brand.logos || []).filter(l => l.handle === handle);
  const slots = dark ? ['fullInverted', 'symbolInverted', 'full', 'symbol'] : ['full', 'symbol', 'fullInverted', 'symbolInverted'];
  const logo = slots.map(slot => logos.find(l => l.slot === slot)).find(Boolean);
  const background = (brand.backgrounds || []).find(b => b.handle === handle && b.key === edits.background?.key);
  const position = edits.logoPosition || edits.logo?.position;
  return { customCss: customCss.join('\n'), handle, name: set.name, palette, fonts, faces, warnings, logoKey: logo?.key, backgroundKey: background?.key, logoPosition: ['top-left','top-right','bottom-left','bottom-right'].includes(position) ? position : 'top-left' };
}
async function loadResearchBrandKit(userId, uploadedFonts = {}) {
  const handle = await currentUsername(userId);
  if (!handle) return null;
  const user = await User.findById(userId).select('visualBrand').lean();
  const kit = settingsOf(user, handle, uploadedFonts);
  kit.fontCss = kit.customCss + (await Promise.all([...new Set(Object.values(kit.faces))].filter(id => BUILTINS[id]).map(embeddedFont))).join('\n');
  const imageData = async key => {
    if (!key) return '';
    const { buffer } = await getObjectBytes(key);
    const png = await sharp(buffer).resize({ width: 1080, height: 1350, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  };
  [kit.logoData, kit.backgroundData] = await Promise.all([imageData(kit.logoKey), imageData(kit.backgroundKey)]);
  return kit;
}
module.exports = { loadResearchBrandKit, settingsOf, embeddedFont };
