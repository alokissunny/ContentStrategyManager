/**
 * Web fonts for slide snapshots (publish + PDF).
 *
 * The snapshot is an SVG drawn through an <img>, and an SVG image can't fetch
 * anything — fonts included. With no fonts embedded, every brand face fell back
 * to the system sans, which is wider: the headline wrapped onto an extra line
 * and ran into the words under it on Instagram, though the app looked right.
 *
 * html-to-image can't build this CSS itself (it reads `cssRules`, which the
 * browser blocks for cross-origin font stylesheets), so we fetch the slide's
 * font stylesheets as text (Google Fonts and Fontshare both send CORS headers),
 * keep the @font-face rules the slide actually uses — family and unicode
 * subset — and inline each font file as a data: URL. Pass the result to toSvg
 * as `fontEmbedCSS`. Results are cached, so only the first slide pays.
 */
import { canvasSafeUrl } from '../../api/media';

const textCache = new Map(); // stylesheet url → Promise<string>
const dataCache = new Map(); // font url → Promise<string | null>

function fetchText(url) {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
  }
  return textCache.get(url);
}

function toDataUrl(url) {
  if (/^data:/i.test(url)) return Promise.resolve(url);
  if (!dataCache.has(url)) {
    // our own CDN (Brand Kit uploads) sends no CORS header — go via the media proxy
    const safe = /^https?:/i.test(url) ? (canvasSafeUrl(url) || url) : url;
    dataCache.set(url, fetch(safe)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => blob && new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '') || null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }))
      .catch(() => null));
  }
  return dataCache.get(url);
}

function absolute(url, base) {
  try { return new URL(url, base).href; } catch { return ''; }
}

const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g;

// Every stylesheet the slide's documents use, as { css, base }, with
// @import (how carousel HTML usually pulls in Google Fonts) followed one level.
async function sheetsOf(docs) {
  const seen = new Set();
  const out = [];
  const add = async (css, base) => {
    out.push({ css, base });
    const imports = [...css.matchAll(IMPORT_RE)]
      .map((m) => absolute(m[2], base))
      .filter((u) => u && !seen.has(u));
    imports.forEach((u) => seen.add(u));
    await Promise.all(imports.map(async (u) => out.push({ css: await fetchText(u), base: u })));
  };
  await Promise.all(docs.flatMap((doc) => [
    ...[...doc.querySelectorAll('link[rel~="stylesheet"][href]')].map(async (link) => {
      const href = link.href;
      if (!href || seen.has(href)) return;
      seen.add(href);
      await add(await fetchText(href), href);
    }),
    ...[...doc.querySelectorAll('style')].map((style) => add(style.textContent || '', doc.baseURI)),
  ]));
  return out;
}

const family = (name) => String(name || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();

// Font families and characters the rendered slide actually uses.
function usageOf(roots) {
  const families = new Set();
  const chars = new Set();
  roots.forEach((root) => {
    const win = root.ownerDocument?.defaultView || window;
    [root, ...root.querySelectorAll('*')].forEach((el) => {
      String(win.getComputedStyle(el).fontFamily || '').split(',').forEach((f) => families.add(family(f)));
    });
    for (const ch of root.textContent || '') chars.add(ch.codePointAt(0));
  });
  return { families, chars };
}

// Does a unicode-range (`U+0000-00FF, U+0131, U+04??`) cover any used character?
function rangeHits(range, chars) {
  return range.split(',').some((part) => {
    const m = part.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
    if (!m) return true;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = parseInt(m[2] || m[1].replace(/\?/g, 'f'), 16);
    for (const c of chars) if (c >= lo && c <= hi) return true;
    return false;
  });
}

const URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

export async function slideFontCss(node) {
  const docs = [];
  node.querySelectorAll('iframe').forEach((f) => {
    try { if (f.contentDocument) docs.push(f.contentDocument); } catch { /* cross-origin */ }
  });
  // the slide renders in its iframe; the wrapper's own (app) font isn't drawn
  const bodies = docs.map((d) => d.body).filter(Boolean);
  const roots = bodies.length ? bodies : [node];
  const { families, chars } = usageOf(roots);
  const sheets = await sheetsOf([node.ownerDocument || document, ...docs]);

  const faces = [];
  const seen = new Set();
  sheets.forEach(({ css, base }) => {
    (css.match(/@font-face\s*\{[^}]*\}/g) || []).forEach((rule) => {
      const fam = rule.match(/font-family\s*:\s*([^;}]+)/i);
      if (!fam || !families.has(family(fam[1]))) return;
      const range = rule.match(/unicode-range\s*:\s*([^;}]+)/i);
      if (range && !rangeHits(range[1], chars)) return;
      const srcs = [...rule.matchAll(URL_RE)].map((m) => absolute(m[2], base)).filter(Boolean);
      if (!srcs.length || seen.has(rule)) return;
      seen.add(rule);
      // one file per face is enough — prefer woff2
      faces.push({ rule, src: srcs.find((u) => /\.woff2(\?|$)/i.test(u)) || srcs[0] });
    });
  });

  const embedded = await Promise.all(faces.map(async ({ rule, src }) => {
    const data = await toDataUrl(src);
    if (!data) return '';
    return rule.replace(/src\s*:[^;}]+;?/i, `src:url("${data}");`);
  }));
  return embedded.filter(Boolean).join('\n');
}
