import { hasMark, plainOf, titleRuns } from '../../lib/slidetext';

function trim(value) {
  return String(value || '').trim();
}

// On-photo Annotation overlay is off. Drop callouts from layout HTML even if
// an older post still has annotation copy. Flip with the backend flag later.
const ANNOTATIONS_ENABLED = false;

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

function isSlideRootSelector(sel) {
  const s = String(sel || '').trim();
  if (!s || /\bscrim\b|\boverlay\b|\bband\b|\bplate\b/i.test(s)) return false;
  if (/\s/.test(s) || /[#.:](?!slide\b)/.test(s.replace(/^\.slide\b/, ''))) return false;
  return /(?:^|,)\s*(?:\.slide|article)\s*(?:,|$)/.test(s) || s === '.slide' || s === 'article';
}

function stripAgentFaces(css) {
  return String(css || '')
    .replace(/font-family\s*:\s*(?!var\(--t-)[^;}{]+;?/gi, '')
    .replace(/font\s*:\s*([^;}{]+)/gi, (all, val) => {
      if (/var\(--t-/.test(val)) return all;
      const next = String(val)
        .replace(/(?:ui-sans-serif|system-ui|-apple-system|BlinkMacSystemFont|sans-serif|'[^']*'|"[^"]*")(?:\s*,\s*)?/gi, '')
        .replace(/,\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return next ? `font:${next}` : '';
    });
}

function sanitizeLayoutCss(css, { hasPhoto = false } = {}) {
  let s = stripAgentFaces(css);
  s = s.replace(/[^{}]*:(?:before|after)[^{]*\{[^}]*\}/gi, '');
  s = s.replace(/transform\s*:[^;}{]+;?/gi, '');
  s = s.replace(/perspective\s*:[^;}{]+;?/gi, '');
  s = s.replace(/skew[XY]?\s*\([^)]*\)/gi, '');
  s = s.replace(/container-type\s*:\s*size\b/gi, 'container-type:inline-size');
  s = s.replace(/([^{}]+)\{([^}]*)\}/g, (all, sel, body) => {
    let next = body;
    if (hasPhoto && isSlideRootSelector(sel)) {
      next = next.replace(/background-image\s*:\s*[^;]*gradient[^;]*/gi, 'background-image:none');
    }
    next = next.replace(/background(?:-color)?\s*:\s*(?!none)([^;]*)/gi, (decl, val) => {
      if (/gradient/i.test(val)) return decl;
      if (/#(?:0{3,8}|111|1a1916)\b|\brgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|\bblack\b/i.test(val)) {
        return 'background:var(--t-ground-bg, #f4f1ec)';
      }
      return decl;
    });
    if (hasPhoto && /\bimg\b/i.test(sel)) {
      next = next
        .replace(/display\s*:\s*none\s*;?/gi, '')
        .replace(/visibility\s*:\s*hidden\s*;?/gi, '')
        .replace(/opacity\s*:\s*0(?:\.0+)?\s*;?/gi, 'opacity:1;');
    }
    return `${sel}{${next}}`;
  });
  return s;
}

function scopeCss(css, scope, opts) {
  return sanitizeLayoutCss(css, opts).replace(/(^|})([^{}@]+)\{/g, (all, close, selectors) => {
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

function isImageSlot(attrs) {
  return /data-slot\s*=\s*(["']image["']|image)(?=[\s>/]|$)/i.test(String(attrs || ''));
}

const PLACEHOLDER_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">'
  + '<rect width="1080" height="1350" fill="#ddd8ce"/>'
  + '<rect x="40" y="40" width="1000" height="1270" fill="none" stroke="#1a1916" stroke-opacity=".28" stroke-width="3" stroke-dasharray="24 16"/>'
  + '</svg>',
)}`;

function withClass(attrs, name) {
  const s = String(attrs || '');
  if (new RegExp(`\\bclass\\s*=\\s*(["'])[^"']*\\b${name}\\b`).test(s)) return s;
  if (/\bclass\s*=\s*"/i.test(s)) return s.replace(/\bclass\s*=\s*"/i, `class="${name} `);
  if (/\bclass\s*=\s*'/i.test(s)) return s.replace(/\bclass\s*=\s*'/i, `class='${name} `);
  return `${s} class="${name}"`.replace(/^\s+/, '');
}

function paintImg(attrs, src, extraClass = '') {
  let clean = String(attrs || '')
    .replace(/\s*\/\s*$/, '')
    .replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>/]+)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (extraClass) clean = withClass(clean, extraClass);
  const placeholder = extraClass === 'is-placeholder';
  const alt = /\salt\s*=/.test(clean) ? '' : (placeholder ? ' alt="Photograph needed"' : ' alt=""');
  const slot = /data-slot\s*=/i.test(clean) ? '' : ' data-slot="image"';
  return `<img${clean ? ` ${clean}` : ''}${slot}${alt} src="${escAttr(src)}">`;
}

function injectSrc(html, urls) {
  const list = (Array.isArray(urls) ? urls : []).map(trim).filter(Boolean);
  let i = 0;
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    if (!isImageSlot(attrs)) return srcOf(attrs) ? full : '';
    const src = list[i] || srcOf(attrs);
    i += 1;
    if (!src || src === PLACEHOLDER_SRC) return paintImg(attrs, PLACEHOLDER_SRC, 'is-placeholder');
    return paintImg(attrs, src);
  });
}

function dropEmptyImages(html) {
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    if (isImageSlot(attrs)) return full;
    return srcOf(attrs) ? full : '';
  });
}

function innerText(html) {
  return trim(String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function emphasizedHtml(text) {
  const runs = titleRuns(text);
  if (!runs.length) return escText(plainOf(text));
  return runs.map((r) => {
    const piece = r.mark === 'accent' ? `<em>${escText(r.text)}</em>` : escText(r.text);
    return r.breakAfter ? `${piece}<br>` : piece;
  }).join('');
}

function wrapTitleEmphasis(html, copy) {
  return String(html || '').replace(
    /<([a-z][a-z0-9]*)(\b[^>]*data-slot\s*=\s*["']title["'][^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag, attrs, inner) => {
      const source = trim(copy?.title);
      if (hasMark(source)) {
        return `<${tag}${attrs}>${emphasizedHtml(source)}</${tag}>`;
      }
      if (/<em\b/i.test(inner)) return full;
      const text = innerText(inner);
      if (hasMark(text)) return `<${tag}${attrs}>${emphasizedHtml(text)}</${tag}>`;
      return full;
    },
  );
}

const FILL_SLOTS = ['title', 'subtitle', 'body', 'stat', 'quote', 'action', 'comparisonA', 'comparisonB', 'items'];

function itemsOf(copy) {
  return (Array.isArray(copy?.items) ? copy.items : []).map(trim).filter(Boolean);
}

function fillEmptySlots(html, copy) {
  if (!copy) return html;
  return String(html || '').replace(
    /<([a-z][a-z0-9]*)(\b[^>]*data-slot\s*=\s*["']([a-zA-Z]+)["'][^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag, attrs, slot, inner) => {
      if (innerText(inner)) return full;
      if (!FILL_SLOTS.includes(slot)) return full;
      if (slot === 'items') {
        const items = itemsOf(copy);
        if (!items.length) return full;
        return `<${tag}${attrs}>${items.map((item) => `<li>${escText(item)}</li>`).join('')}</${tag}>`;
      }
      const text = trim(copy[slot]);
      if (!text) return full;
      const body = slot === 'title' ? emphasizedHtml(text) : escText(text);
      return `<${tag}${attrs}>${body}</${tag}>`;
    },
  );
}

function copyHasText(copy) {
  return Boolean(
    trim(copy?.title)
    || trim(copy?.subtitle)
    || trim(copy?.body)
    || trim(copy?.stat)
    || trim(copy?.quote)
    || trim(copy?.comparisonA)
    || trim(copy?.comparisonB)
    || itemsOf(copy).length,
  );
}

function hasCopySlot(html) {
  return /data-slot\s*=\s*["'](title|subtitle|body|items|quote|stat|comparisonA|comparisonB|action)["']/i.test(html);
}

function ensureCopySlots(html, copy) {
  if (!copyHasText(copy)) return html;
  let next = fillEmptySlots(html, copy);
  if (hasCopySlot(next)) return next;
  const title = trim(copy?.title);
  const items = itemsOf(copy);
  if (!title && !items.length) return next;
  let extra = /\bscrim\b/i.test(next) ? '' : '<div class="scrim" aria-hidden="true"></div>';
  if (title) extra += `<h1 data-slot="title">${emphasizedHtml(title)}</h1>`;
  if (items.length) extra += `<ul data-slot="items">${items.map((item) => `<li>${escText(item)}</li>`).join('')}</ul>`;
  if (/<\/article>/i.test(next)) next = next.replace(/<\/article>/i, `${extra}</article>`);
  else next = `${next}${extra}`;
  return appendCss(next, INJECTED_COPY_CSS);
}

function dropAnnotation(html) {
  return String(html || '').replace(
    /<([a-z][a-z0-9]*)\b[^>]*data-slot\s*=\s*["']annotation["'][^>]*>[\s\S]*?<\/\1>/gi,
    '',
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

const PHOTO_VISIBLE_CSS = [
  '.slide{background-image:none!important}',
  '.slide img[data-slot="image"]{display:block!important;opacity:1!important;visibility:visible!important;object-fit:cover;z-index:0!important;background:var(--t-empty-bg, #ddd8ce)}',
].join('');

const PLACEHOLDER_SLOT_CSS = [
  '.slide img[data-slot="image"].is-placeholder{background:var(--t-empty-bg,#ddd8ce)}',
].join('');

const COPY_ON_PHOTO_CSS = [
  '.slide .scrim{display:block!important;visibility:visible!important;opacity:1!important;z-index:1;pointer-events:none}',
  '.slide [data-slot="title"],.slide [data-slot="subtitle"],.slide [data-slot="body"],.slide [data-slot="items"],.slide [data-slot="quote"],.slide [data-slot="stat"],.slide [data-slot="action"]{z-index:2}',
].join('');

const INJECTED_COPY_CSS = [
  '.slide .scrim{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(to top,rgba(18,16,14,.78) 0%,rgba(18,16,14,.18) 42%,transparent 68%)}',
  '.slide [data-slot="title"],.slide [data-slot="items"]{position:absolute;left:8%;right:8%;z-index:2;margin:0;color:var(--t-ground-fg, #1a1916);text-wrap:balance}',
  '.slide [data-slot="title"] em,.slide [data-slot="items"] em{font-style:normal;color:var(--t-accent-bg, #ff5227)}',
  '.slide [data-slot="title"]{bottom:14%;font:650 clamp(16px,4.6cqi,48px)/1.2 var(--t-headline-face, var(--font-display, ui-sans-serif, system-ui, sans-serif))}',
  '.slide [data-slot="items"]{bottom:14%;padding:0;list-style:none;font:600 clamp(14px,3.4cqi,28px)/1.25 var(--t-body-face, var(--font-ui, ui-sans-serif, system-ui, sans-serif))}',
].join('');

const ALWAYS_REPAIR_CSS = [
  '.slide{background:var(--t-ground-bg, #f4f1ec)}',
  '.slide [data-slot="comparisonA"],.slide [data-slot="comparisonB"]{background:var(--t-ground-bg, #f4f1ec)!important;color:var(--t-ground-fg, #1a1916)!important}',
  '.slide [data-slot="comparisonA"] *,.slide [data-slot="comparisonB"] *{color:var(--t-ground-fg, #1a1916)!important;-webkit-text-fill-color:var(--t-ground-fg, #1a1916)!important;background:transparent!important}',
  '.slide :has(>[data-slot="comparisonA"]),.slide :has(>[data-slot="comparisonB"]){background:var(--t-ground-bg, #f4f1ec)!important;color:var(--t-ground-fg, #1a1916)!important}',
].join('');

/* Match a comparison slot only where it is an ELEMENT attribute (`<div
   data-slot="comparisonA">`), never inside a CSS selector (`[data-slot=
   "comparisonA"]`) — the repair stylesheets we inject mention those selectors,
   so a loose match would report every slide as a comparison slide. */
function hasComparisonSlot(html) {
  return /<[a-z][^>]*\bdata-slot\s*=\s*["'](comparisonA|comparisonB)["']/i.test(String(html || ''));
}

/* Full-bleed photo + overlay type (Pattern 1). Editorial / 50-50 splits size the
   image in flex/grid flow — those must keep their HTML composition, not the
   pinned caption overlay. */
export function isBleedPhotoLayout(html) {
  const src = String(html || '');
  if (!hasImageSlot(src)) return false;
  if (hasComparisonSlot(src)) return false;
  const { css } = splitLayoutDocument(src);
  const imgBodies = [];
  String(css || '').replace(/([^{}]+)\{([^}]*)\}/g, (_, sel, body) => {
    const s = String(sel || '');
    if (!/\bimg\b|data-slot\s*=\s*["']image["']/.test(s)) return '';
    if (/:(?:before|after)/i.test(s)) return '';
    imgBodies.push(String(body || ''));
    return '';
  });
  const imgCss = imgBodies.join(';');
  if (!imgCss) return false;
  const abs = /position\s*:\s*absolute/i.test(imgCss);
  const fill = /inset\s*:\s*0/i.test(imgCss)
    || ((/width\s*:\s*100%/i.test(imgCss) || /left\s*:\s*0/i.test(imgCss))
      && (/height\s*:\s*100%/i.test(imgCss) || /bottom\s*:\s*0/i.test(imgCss) || /top\s*:\s*0/i.test(imgCss)));
  const flexSlot = /flex\s*:/i.test(imgCss) || /max-height\s*:/i.test(imgCss);
  return abs && fill && !flexSlot;
}

/* The layout agent emits composition only (plan-layout.md). Faces, colours, and
   overlay scrims come from Library Settings. This pass still swaps leftover
   agent hexes on older posts so a studio identity change updates every slide
   without regenerating. */
function identityForceCss() {
  const ink = [
    '.slide,.slide [data-slot="title"],.slide [data-slot="subtitle"],.slide [data-slot="body"],.slide [data-slot="items"],.slide [data-slot="items"] li,.slide [data-slot="comparisonA"],.slide [data-slot="comparisonB"],.slide [data-slot="action"],.slide [data-slot="quote"],.slide h1,.slide h2,.slide p,.slide li{color:var(--t-ground-fg,#1b100d)!important;-webkit-text-fill-color:var(--t-ground-fg,#1b100d)!important}',
    '.slide [data-slot="stat"]{color:var(--t-accent-bg,#ff5227)!important;-webkit-text-fill-color:var(--t-accent-bg,#ff5227)!important}',
    '.slide em,.slide [data-mark="accent"]{color:var(--t-accent-bg,#ff5227)!important;-webkit-text-fill-color:var(--t-accent-bg,#ff5227)!important;font-style:normal}',
  ].join('');
  return [
    '.slide{background:var(--t-ground-bg,#f4f2ee)!important;font-family:var(--t-body-face)!important}',
    '.slide h1{font-family:var(--t-headline-face)!important}',
    '.slide h2{font-family:var(--t-headline-face)!important}',
    '.slide h3{font-family:var(--t-headline-face)!important}',
    '.slide [data-slot="title"]{font-family:var(--t-headline-face)!important}',
    '.slide [data-slot="stat"]{font-family:var(--t-headline-face)!important}',
    '.slide [data-slot="quote"]{font-family:var(--t-headline-face)!important}',
    '.slide [data-slot="annotation"]{font-family:var(--t-headline-face)!important;font-style:normal!important}',
    '.slide p{font-family:var(--t-body-face)!important}',
    '.slide li{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="subtitle"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="body"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="items"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="action"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="detail"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="comparisonA"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="comparisonB"]{font-family:var(--t-body-face)!important}',
    '.slide [data-slot="comparisonA"],.slide [data-slot="comparisonB"]{background:var(--t-ground-bg,#f4f2ee)!important;border-color:var(--t-ground-fg,#1b100d)!important}',
    '.slide img[data-slot="image"]{background:var(--t-empty-bg,#ddd8ce)!important}',
    '.slide .scrim{background:linear-gradient(to top,color-mix(in srgb,var(--t-ground-fg,#1b100d) 78%,transparent) 0%,color-mix(in srgb,var(--t-ground-fg,#1b100d) 18%,transparent) 42%,transparent 68%)!important}',
    ink,
  ].join('');
}

const IDENTITY_SWAPS = [
  [/#f4f1ec\b/gi, 'var(--t-ground-bg, #f4f1ec)'],
  [/#f4f2ee\b/gi, 'var(--t-ground-bg, #f4f2ee)'],
  [/#f5f0e8\b/gi, 'var(--t-ground-bg, #f5f0e8)'],
  [/#f3f1ec\b/gi, 'var(--t-ground-bg, #f3f1ec)'],
  [/#1a1916\b/gi, 'var(--t-ground-fg, #1a1916)'],
  [/#1b100d\b/gi, 'var(--t-ground-fg, #1b100d)'],
  [/#16161a\b/gi, 'var(--t-ground-fg, #16161a)'],
  [/#5c5850\b/gi, 'var(--t-ground-mute, #5c5850)'],
  [/#3f3c37\b/gi, 'var(--t-ground-mute, #3f3c37)'],
  [/#ddd8ce\b/gi, 'var(--t-empty-bg, #ddd8ce)'],
  [/ui-sans-serif\s*,\s*system-ui\s*,\s*sans-serif/gi, 'var(--t-body-face, ui-sans-serif, system-ui, sans-serif)'],
];

function paintIdentity(html) {
  let s = String(html || '');
  IDENTITY_SWAPS.forEach(([re, token]) => {
    re.lastIndex = 0;
    s = s.replace(new RegExp(re.source, re.flags), (match, offset, source) => {
      const before = source.slice(Math.max(0, offset - 48), offset);
      if (/var\(--t-[\w-]+,\s*$/i.test(before) || /var\(--font-(?:ui|display),\s*$/i.test(before)) {
        return match;
      }
      return token;
    });
  });
  return s;
}

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

export function splitLayoutDocument(html) {
  const styles = [];
  const body = String(html || '').replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => {
    if (trim(css)) styles.push(css);
    return '';
  });
  return { css: styles.join('\n'), body: trim(body) };
}

export function prepareLayoutHtml(raw, { scope, imageUrls, copy } = {}) {
  let html = trim(raw);
  if (!html) return '';
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).map(trim).filter(Boolean);
  const hasPhoto = urls.length > 0;
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${sanitizeLayoutCss(css, { hasPhoto })}</style>`);
  html = ensureCopySlots(html, copy);
  html = wrapTitleEmphasis(html, copy);
  if (ANNOTATIONS_ENABLED && urls.length && copy?.annotation) {
    html = rewriteAnnotationText(html, typeof copy.annotation === 'string' ? copy.annotation : copy.annotation.text);
  } else {
    html = dropAnnotation(html);
  }
  html = dropEmptyElements(html);
  const imgsBefore = imageCount(html);
  html = injectSrc(html, urls);
  html = dropEmptyImages(html);
  html = dropEmptyElements(html);
  const bleed = isBleedPhotoLayout(html);
  html = appendCss(html, ALWAYS_REPAIR_CSS);
  if (hasPhoto) {
    html = injectSrc(html, urls);
    html = appendCss(html, PHOTO_VISIBLE_CSS);
    if (bleed && hasCopySlot(html)) html = appendCss(html, COPY_ON_PHOTO_CSS);
  } else if (hasImageSlot(html)) {
    html = appendCss(html, PLACEHOLDER_SLOT_CSS);
  }
  if (imgsBefore > 1 && imageCount(html) === 1) html = appendCss(html, SINGLE_PHOTO_CSS);
  html = appendCss(html, identityForceCss());
  html = paintIdentity(html);
  if (scope) {
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${scopeCss(css, scope, { hasPhoto })}</style>`);
  }
  if (!/class=["'][^"']*\bslide\b/i.test(html) && !/<article\b/i.test(html)) return '';
  return html;
}
