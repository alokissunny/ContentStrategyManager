function trim(value) {
  return String(value || '').trim();
}

function escAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function escText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function srcOf(attrs) {
  const m = String(attrs || '').match(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>/]+)/i);
  if (!m) return '';
  const value = trim(m[1].replace(/^['"]|['"]$/g, ''));
  if (!value || /^(#|about:blank|null|undefined)$/i.test(value)) return '';
  return value;
}

function sanitizeLayoutCss(css) {
  let s = String(css || '');
  s = s.replace(/[^{}]*:(?:before|after)[^{]*\{[^}]*\}/gi, '');
  s = s.replace(/transform\s*:[^;}{]+;?/gi, '');
  s = s.replace(/perspective\s*:[^;}{]+;?/gi, '');
  s = s.replace(/skew[XY]?\s*\([^)]*\)/gi, '');
  s = s.replace(/container-type\s*:\s*size\b/gi, 'container-type:inline-size');
  s = s.replace(/background(?:-color)?\s*:\s*(?!none)([^;{}]*)/gi, (all, val) => {
    if (/gradient/i.test(val)) return all;
    if (/#(?:0{3,8}|111|1a1916)\b|\brgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|\bblack\b/i.test(val)) {
      return 'background:#f4f1ec';
    }
    return all;
  });
  return s;
}

function scopeCss(css, scope) {
  return sanitizeLayoutCss(css).replace(/(^|})([^{}@]+)\{/g, (all, close, selectors) => {
    const trimmed = selectors.trim();
    if (!trimmed) return all;
    if (/^(@|from|to|\d+%)/.test(trimmed)) return all;
    const prefixed = trimmed.split(',').map((sel) => {
      const s = sel.trim();
      if (!s) return s;
      const root = `.${scope}`;
      if (s === root || s.startsWith(`${root} `) || s.startsWith(`${root}.`) || s.startsWith(`${root}:`) || s.startsWith(`${root}[`)) {
        return s;
      }
      return `${root} ${s}`;
    }).join(',');
    return `${close}${prefixed}{`;
  });
}

function hasImageSlot(html) {
  return /<img\b[^>]*data-slot\s*=\s*(["']image["']|image)(?=[\s>/]|$)/i.test(html);
}

function injectSrc(html, urls) {
  const list = (Array.isArray(urls) ? urls : []).map(trim).filter(Boolean);
  let i = 0;
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => {
    const src = list[i] || '';
    i += 1;
    if (!src) return '';
    const clean = String(attrs)
      .replace(/\s*\/\s*$/, '')
      .replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>/]+)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    const alt = /\salt\s*=/.test(clean) ? '' : ' alt=""';
    return `<img${clean ? ` ${clean}` : ''}${alt} src="${escAttr(src)}">`;
  });
}

function dropEmptyImages(html) {
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => (srcOf(attrs) ? full : ''));
}

function innerText(html) {
  return trim(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

const FILL_SLOTS = ['title', 'subtitle', 'body', 'stat', 'quote', 'action', 'comparisonA', 'comparisonB'];

function fillEmptySlots(html, copy) {
  if (!copy) return html;
  return String(html || '').replace(
    /<([a-z][a-z0-9]*)(\b[^>]*data-slot\s*=\s*["']([a-zA-Z]+)["'][^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag, attrs, slot, inner) => {
      if (innerText(inner)) return full;
      if (!FILL_SLOTS.includes(slot)) return full;
      const text = trim(copy[slot]);
      if (!text) return full;
      return `<${tag}${attrs}>${escText(text)}</${tag}>`;
    },
  );
}

function dropEmptyElements(html) {
  let s = String(html || '');
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(
      /<(p|div|span|h1|h2|h3|blockquote|section|figure|header|footer|aside)(\b[^>]*)?>\s*<\/\1>/gi,
      (full, _tag, attrs = '') => {
        if (/data-slot\s*=\s*["'](image|annotation)["']/i.test(attrs)) return full;
        if (/\bscrim\b/i.test(attrs) || /data-slot\s*=\s*["']annotation["']/i.test(attrs)) return full;
        return '';
      },
    );
  }
  return s;
}

const PHOTO_REPAIR_CSS = [
  '.slide{display:flex;flex-direction:column;background:#f4f1ec}',
  '.slide>[data-slot="image"]:first-of-type{position:relative;inset:auto;flex:1 1 56%;width:100%;min-height:0;height:auto;object-fit:cover;background:#ddd8ce;z-index:0}',
  '.slide .scrim{display:none}',
  '.slide [data-slot]:not([data-slot="image"]):not([data-slot="annotation"]){position:relative;inset:auto;left:auto;right:auto;top:auto;bottom:auto;color:#1a1916;z-index:1;box-sizing:border-box}',
].join('');

const ALWAYS_REPAIR_CSS = [
  '.slide{background:#f4f1ec}',
  '.slide [data-slot="comparisonA"],.slide [data-slot="comparisonB"]{flex:0 0 auto;min-height:0;background:#f4f1ec;color:#1a1916}',
  '.slide img:not([src]),.slide img[src=""]{display:none!important}',
].join('');

const SINGLE_PHOTO_CSS = [
  '.slide img:only-of-type{grid-column:1/-1;width:100%;max-width:100%;min-height:0;justify-self:stretch}',
  '.slide :has(>img:only-child){grid-column:1/-1;width:100%;min-height:0}',
].join('');

function appendCss(html, css) {
  if (/<\/style>/i.test(html)) return html.replace(/<\/style>/i, `${css}</style>`);
  return `<style>${css}</style>${html}`;
}

function imageCount(html) {
  return (String(html || '').match(/<img\b/gi) || []).length;
}

function ensureImageSlot(html, src) {
  if (!src || hasImageSlot(html)) return html;
  const img = `<img data-slot="image" alt="" src="${escAttr(src)}">`;
  const withOpen = html.replace(
    /(<article\b[^>]*(?:class=["'][^"']*\bslide\b[^"']*["'][^>]*)?>)/i,
    `$1${img}`,
  );
  if (withOpen === html) return html;
  return appendCss(withOpen, PHOTO_REPAIR_CSS);
}

export function rewriteAnnotationText(html, text) {
  const next = trim(text);
  if (!html) return html;
  return String(html).replace(
    /(<([a-z][a-z0-9]*)\b[^>]*data-slot\s*=\s*["']annotation["'][^>]*>)([\s\S]*?)(<\/\2>)/i,
    (all, open, _tag, inner, close) => {
      let done = false;
      const updated = inner.replace(/>([^<]+)</g, (m, body) => {
        if (done || !String(body).trim()) return m;
        done = true;
        return `>${escText(next)}<`;
      });
      return `${open}${updated}${close}`;
    },
  );
}

export function prepareLayoutHtml(raw, { scope, imageUrls, copy } = {}) {
  let html = trim(raw);
  if (!html) return '';
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).map(trim).filter(Boolean);
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${sanitizeLayoutCss(css)}</style>`);
  html = fillEmptySlots(html, copy);
  if (copy?.annotation) html = rewriteAnnotationText(html, typeof copy.annotation === 'string' ? copy.annotation : copy.annotation.text);
  html = dropEmptyElements(html);
  html = ensureImageSlot(html, urls[0] || '');
  const imgsBefore = imageCount(html);
  html = injectSrc(html, urls);
  html = dropEmptyImages(html);
  html = dropEmptyElements(html);
  html = appendCss(html, ALWAYS_REPAIR_CSS);
  if (imgsBefore > 1 && imageCount(html) === 1) html = appendCss(html, SINGLE_PHOTO_CSS);
  if (scope) {
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${scopeCss(css, scope)}</style>`);
  }
  if (!/class=["'][^"']*\bslide\b/i.test(html) && !/<article\b/i.test(html)) return '';
  return html;
}
