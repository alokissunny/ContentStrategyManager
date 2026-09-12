import { parseMarked, plainOf } from '../../lib/slidetext';

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

function isImageSlot(attrs) {
  return /data-slot\s*=\s*(["']image["']|image)(?=[\s>/]|$)/i.test(String(attrs || ''));
}

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
  // Empty slots stay src-less so sizing comes only from the agent's CSS
  // (flex / % / cqi). A bitmap src — even 1×1 — changes intrinsic size and
  // collapses or blows out the composition.
  const srcAttr = src ? ` src="${escAttr(src)}"` : '';
  return `<img${clean ? ` ${clean}` : ''}${slot}${alt}${srcAttr}>`;
}

// Wire real photograph URLs into image slots. Empty slots keep no src and get
// `is-placeholder` so CSS can paint a hatch — agent flex/cqh sizing stays intact.
function injectSrc(html, urls) {
  const list = (Array.isArray(urls) ? urls : []).map(trim).filter(Boolean);
  let i = 0;
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    if (!isImageSlot(attrs)) return srcOf(attrs) ? full : '';
    const src = list[i] || srcOf(attrs);
    i += 1;
    if (!src) return paintImg(attrs, '', 'is-placeholder');
    return paintImg(attrs, src);
  });
}

// Scope the agent's CSS to this slide instance so rules cannot leak across the
// page. This only prefixes selectors — it never rewrites the agent's declared
// faces, colours, sizes, or layout. The agent's output is rendered as-is.
function scopeCss(css, scope) {
  return String(css || '').replace(/(^|})([^{}@]+)\{/g, (all, close, selectors) => {
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

// Rebuild a title slot's inner HTML from a marked value: {{accent|…}} runs
// become <em>…</em> — the exact treatment the layout agent emits — and every
// other run is escaped text.
function markedToInner(value) {
  return parseMarked(value)
    .filter((r) => r && r.text)
    .map((r) => (r.mark === 'accent' ? `<em>${escText(r.text)}</em>` : escText(r.text)))
    .join('');
}

function replaceSlotInner(html, slot, inner) {
  const re = new RegExp(
    `(<([a-z][a-z0-9]*)\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`,
    'i',
  );
  let found = false;
  const out = String(html || '').replace(re, (_all, open, _tag, prev, close) => {
    found = true;
    return `${open}${withPreservedFrame(prev, inner)}${close}`;
  });
  return { html: out, found };
}

// Keep the agent's inner tags (h1, p, spans) so Edit text cannot flatten a
// slot into bare words and collapse the 4:5 composition.
function withPreservedFrame(inner, textHtml) {
  const src = String(inner || '');
  const leaf = src.match(/<(h[1-6]|p)\b[^>]*>[\s\S]*?<\/\1>/i);
  if (leaf) {
    const next = leaf[0].replace(
      /(<(h[1-6]|p)\b[^>]*>)([\s\S]*)(<\/\2>)/i,
      `$1${textHtml}$4`,
    );
    return src.replace(leaf[0], next);
  }
  if (/<[a-z][^>]*>/i.test(src) && />[^<]*</.test(src)) {
    let done = false;
    return src.replace(/>([^<]*)</g, (all, text) => {
      if (done || !String(text).trim()) return all;
      done = true;
      return `>${textHtml}<`;
    });
  }
  return textHtml;
}

export function slideRootOf(frame, { direction, index } = {}) {
  const doc = frame?.contentDocument || frame;
  if (!doc) return null;
  return findCarouselSlide(doc, direction, index)
    || doc.querySelector?.('article.slide, .slide, article')
    || null;
}

export function paintSlideCopy(frame, { direction, index, title, subtitle }) {
  const slide = slideRootOf(frame, { direction, index });
  if (!slide) return false;
  if (title != null) paintSlotText(slide, ['title'], title, true);
  if (subtitle != null) paintSlotText(slide, ['subtitle', 'supporting-text', 'body'], subtitle, false);
  return true;
}

const GEOM_PROPS = [
  'boxSizing', 'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'overflow', 'alignSelf',
];

function lockBox(el) {
  if (!el || el.nodeType !== 1) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  el.style.boxSizing = 'border-box';
  if (w > 0) {
    el.style.width = `${w}px`;
    el.style.minWidth = `${w}px`;
    el.style.maxWidth = `${w}px`;
  }
  if (h > 0) {
    el.style.height = `${h}px`;
    el.style.minHeight = `${h}px`;
    el.style.maxHeight = `${h}px`;
    el.style.flexGrow = '0';
    el.style.flexShrink = '0';
    el.style.flexBasis = `${h}px`;
  }
}

const MEDIA_SLOTS = ['image', 'illustration'];
const COPY_SLOTS = ['title', 'subtitle', 'supporting-text', 'body'];

// Pin the 4:5 composition before Edit text paints new words. Otherwise a
// longer heading eats the flex leftover and the placeholder collapses.
export function freezeSlideGeometry(frame, { direction, index } = {}) {
  const slide = slideRootOf(frame, { direction, index });
  if (!slide || slide.getAttribute('data-ig-frozen') === '1') return Boolean(slide);
  lockBox(slide);
  slide.style.overflow = 'hidden';
  MEDIA_SLOTS.forEach((name) => {
    slide.querySelectorAll(`[data-slot="${name}"]`).forEach(lockBox);
  });
  slide.querySelectorAll('img, figure').forEach(lockBox);
  COPY_SLOTS.forEach((name) => {
    slide.querySelectorAll(`[data-slot="${name}"]`).forEach((el) => {
      lockBox(el);
      el.style.overflow = 'hidden';
    });
  });
  slide.setAttribute('data-ig-frozen', '1');
  return true;
}

export function isSlideFrozen(frame, opts) {
  const slide = slideRootOf(frame, opts);
  return Boolean(slide && slide.getAttribute('data-ig-frozen') === '1');
}

function copyGeom(from, to) {
  if (!from || !to) return;
  GEOM_PROPS.forEach((prop) => {
    const value = from.style?.[prop];
    if (value) to.style[prop] = value;
  });
}

function serializeParsed(html, doc) {
  if (isCarouselDocument(html)) {
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  }
  return doc.body?.innerHTML || html;
}

export function bakeFrozenGeometry(html, liveSlide, { direction, index } = {}) {
  const raw = String(html || '');
  if (!raw || !liveSlide || typeof DOMParser === 'undefined') return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const target = findCarouselSlide(doc, direction, index);
  if (!target) return raw;
  copyGeom(liveSlide, target);
  if (liveSlide.getAttribute('data-ig-frozen')) {
    target.setAttribute('data-ig-frozen', '1');
  }
  const names = [...liveSlide.querySelectorAll('[data-slot]')]
    .map((el) => el.getAttribute('data-slot'))
    .filter(Boolean);
  [...new Set(names)].forEach((name) => {
    copyGeom(
      liveSlide.querySelector(`[data-slot="${name}"]`),
      target.querySelector(`[data-slot="${name}"]`),
    );
  });
  return serializeParsed(raw, doc);
}

export function slideSlotPlain(html, { direction, index, slot } = {}) {
  const raw = String(html || '');
  if (!raw || !slot) return '';
  if (typeof DOMParser === 'undefined') return slotPlain(raw, slot);
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const slide = findCarouselSlide(doc, direction, index)
    || doc.querySelector('article.slide, .slide, article');
  if (!slide) return slotPlain(raw, slot);
  const el = slide.querySelector(`[data-slot="${slot}"]`);
  if (!el) return '';
  return plainOf(el.textContent || '').replace(/\s+/g, ' ').trim();
}

function paintSlotText(root, names, value, marked) {
  const text = marked ? markedToInner(value) : escText(plainOf(value));
  const nextPlain = plainOf(value).replace(/\s+/g, ' ').trim();
  for (const name of names) {
    const el = root.querySelector(`[data-slot="${name}"]`);
    if (!el) continue;
    const leaf = el.querySelector('h1, h2, h3, h4, p') || el;
    const prevPlain = plainOf(leaf.textContent || '').replace(/\s+/g, ' ').trim();
    if (prevPlain === nextPlain) return true;
    const html = marked ? text : escText(plainOf(value));
    if (leaf !== el) leaf.innerHTML = html;
    else {
      const nested = el.querySelector('h1, h2, h3, h4, p');
      if (nested) nested.innerHTML = html;
      else {
        const next = withPreservedFrame(el.innerHTML, html);
        el.innerHTML = next;
      }
    }
    return true;
  }
  return false;
}

// Edit text on a layout-agent slide: the words are baked into the slide's HTML,
// so patching slide.title/subtitle alone never shows. Rewrite the matching
// slots in place. Title keeps its {{accent|…}} → <em> treatment; the subtitle
// line targets the `subtitle` slot, falling back to `body` when the agent used
// that instead. Only the fields that were edited (non-null) are touched.
export function rewriteLayoutText(html, { title, subtitle } = {}) {
  let out = String(html || '');
  if (!out) return out;
  if (title != null) {
    out = replaceSlotInner(out, 'title', markedToInner(title)).html;
  }
  if (subtitle != null) {
    const inner = escText(plainOf(subtitle));
    let r = replaceSlotInner(out, 'subtitle', inner);
    if (!r.found) r = replaceSlotInner(out, 'supporting-text', inner);
    if (!r.found) r = replaceSlotInner(out, 'body', inner);
    out = r.html;
  }
  return out;
}

export function rewriteCarouselDocumentText(html, { index, title, subtitle } = {}) {
  const raw = String(html || '');
  if (!raw) return raw;
  const idx = String(Number(index) > 0 ? Number(index) : 1);
  return raw.replace(/<article\b[^>]*>[\s\S]*?<\/article>/gi, (article) => {
    const n = (article.match(/\bdata-index=["']([^"']+)["']/i) || [])[1];
    if (String(n || '') !== idx) return article;
    return rewriteLayoutText(article, { title, subtitle });
  });
}

export function slotPlain(html, slot) {
  const re = new RegExp(
    `<[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>([\\s\\S]*?)<\\/[a-z][a-z0-9]*>`,
    'i',
  );
  const m = String(html || '').match(re);
  if (!m) return '';
  return plainOf(String(m[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
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

// The layout agent sometimes emits one shared <style> on slide 1 and bare
// <article> on later slides. Each slide is rendered alone, so borrow every
// <style> block from the carousel onto slides that have none.
export function collectLayoutStyleBlocks(htmls) {
  const blocks = [];
  const seen = new Set();
  (Array.isArray(htmls) ? htmls : []).forEach((html) => {
    String(html || '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (block) => {
      const key = block.replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) return block;
      seen.add(key);
      blocks.push(block);
      return block;
    });
  });
  return blocks;
}

export function withSharedLayoutStyles(html, carouselHtmls) {
  const raw = trim(html);
  if (!raw) return '';
  if (/<style\b/i.test(raw)) return raw;
  const blocks = collectLayoutStyleBlocks(carouselHtmls);
  if (!blocks.length) return raw;
  return `${blocks.join('')}${raw}`;
}

export function shareLayoutStyles(htmls) {
  const list = (Array.isArray(htmls) ? htmls : []).map((h) => String(h || ''));
  const blocks = collectLayoutStyleBlocks(list);
  if (!blocks.length) return list;
  const head = blocks.join('');
  return list.map((html) => {
    const raw = trim(html);
    if (!raw) return html;
    if (/<style\b/i.test(raw)) return html;
    return `${head}${raw}`;
  });
}

export function isCarouselDocument(html) {
  const t = trim(html);
  return /<!doctype html/i.test(t) || /<html[\s>]/i.test(t);
}

const THEME_CATALOG = [
  { id: 'warm-editorial', match: /warm\s*editorial/i },
  { id: 'architectural-minimal', match: /architectural\s*minimal/i },
  { id: 'quiet-luxury', match: /quiet\s*luxury/i },
  { id: 'natural-tactile', match: /natural|tactile/i },
  { id: 'contemporary-gallery', match: /contemporary|gallery/i },
  { id: 'editorial', match: /\beditorial\b/i },
  { id: 'architectural', match: /\barchitectural\b/i },
  { id: 'bold-minimal', match: /bold\s*-?\s*minimal/i },
];

const THEME_IDS = new Set(THEME_CATALOG.map((t) => t.id));

export const THEME_ORDER = [
  'warm-editorial',
  'architectural-minimal',
  'quiet-luxury',
  'natural-tactile',
  'contemporary-gallery',
];

function canonThemeId(value) {
  const raw = trim(value).toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw) return '';
  if (THEME_IDS.has(raw)) return raw;
  if (raw === 'natural-and-tactile') return 'natural-tactile';
  const hit = THEME_CATALOG.find((t) => t.match.test(String(value || '')));
  return hit?.id || '';
}

function themeFallbacks(direction) {
  const id = canonThemeId(direction) || trim(direction) || THEME_ORDER[0];
  const aliases = {
    'warm-editorial': ['warm-editorial', 'editorial'],
    editorial: ['editorial', 'warm-editorial'],
    'architectural-minimal': ['architectural-minimal', 'architectural'],
    architectural: ['architectural', 'architectural-minimal'],
    'contemporary-gallery': ['contemporary-gallery', 'bold-minimal'],
    'bold-minimal': ['bold-minimal', 'contemporary-gallery'],
  };
  return aliases[id] || [id];
}

export function layoutDirectionOf(slide) {
  const stored = canonThemeId(slide?.layoutTheme);
  if (stored) return stored;
  const opts = Array.isArray(slide?.layoutOptions) ? slide.layoutOptions : [];
  const hit = opts.find((o) => o.html && o.html === slide?.layoutHtml) || opts[0] || {};
  return canonThemeId(hit.direction) || canonThemeId(hit.label) || THEME_ORDER[0];
}

export function themeIdOf(opt) {
  return canonThemeId(opt?.direction) || canonThemeId(opt?.label);
}

export function optionForTheme(slide, theme) {
  const want = canonThemeId(theme) || trim(theme).toLowerCase();
  if (!want) return null;
  const opts = Array.isArray(slide?.layoutOptions) ? slide.layoutOptions : [];
  const aliases = new Set(themeFallbacks(want));
  return opts.find((o) => aliases.has(themeIdOf(o))) || null;
}

export function findCarouselSlide(doc, direction, index) {
  if (!doc) return null;
  const idx = String(Number(index) > 0 ? Number(index) : 1);
  for (const dir of themeFallbacks(direction)) {
    const scoped = [...doc.querySelectorAll(`section[data-direction="${dir}"] article.slide`)];
    if (!scoped.length) continue;
    return scoped.find((el) => String(el.getAttribute('data-index')) === idx)
      || scoped[Number(idx) - 1]
      || null;
  }
  const all = [...doc.querySelectorAll('article.slide')];
  const matches = all.filter((el) => String(el.getAttribute('data-index')) === idx);
  if (matches.length > 1) {
    const order = {};
    THEME_ORDER.forEach((id, i) => { order[id] = i; });
    ['editorial', 'architectural', 'bold-minimal'].forEach((id, i) => {
      if (order[id] == null) order[id] = i;
    });
    const want = canonThemeId(direction) || THEME_ORDER[0];
    return matches[order[want] ?? 0] || matches[0];
  }
  return matches[0] || all[Number(idx) - 1] || null;
}

function activateCarouselDirection(doc, direction) {
  const aliases = themeFallbacks(direction);
  const dir = aliases[0];
  doc.querySelectorAll('section[data-direction]').forEach((sec) => {
    const id = canonThemeId(sec.getAttribute('data-direction'))
      || trim(sec.getAttribute('data-direction')).toLowerCase();
    const on = aliases.includes(id);
    if (on) {
      sec.style.removeProperty('display');
      sec.removeAttribute('hidden');
      sec.classList.add('is-on', 'is-active', 'is-selected');
    } else {
      sec.style.setProperty('display', 'none', 'important');
      sec.setAttribute('hidden', '');
      sec.classList.remove('is-on', 'is-active', 'is-selected');
    }
  });
  const matchers = aliases.map((id) => THEME_CATALOG.find((t) => t.id === id)?.match).filter(Boolean);
  const controls = [...doc.querySelectorAll('button, [role="tab"]')]
    .filter((el) => !el.closest('article.slide, .slide'));
  const target = controls.find((el) => {
    const key = canonThemeId(el.getAttribute('data-direction')) || trim(el.getAttribute('data-direction')).toLowerCase();
    if (aliases.includes(key)) return true;
    const label = el.textContent || '';
    return matchers.some((re) => re.test(label));
  });
  if (target && typeof target.click === 'function') {
    const on = target.getAttribute('aria-pressed') === 'true'
      || target.classList.contains('is-on')
      || target.classList.contains('is-active');
    if (!on) {
      try { target.click(); } catch { /* ignore */ }
    }
  }
}

// Lay the full carousel HTML out at the debug-preview width (2-column), then
// scale the target 4:5 canvas so it fills the Instagram frame. Relaying the
// extracted <article> at the frame's own width collapses placeholders.
export const CAROUSEL_LAYOUT_WIDTH = 1100;

export function cropIframeToCarouselSlide(frame, { direction, index }) {
  const doc = frame?.contentDocument;
  const host = frame?.parentElement;
  if (!doc || !host) return false;
  const fw = host.clientWidth;
  const fh = host.clientHeight;
  if (!fw || !fh) return false;

  const dir = trim(direction) || THEME_ORDER[0];
  activateCarouselDirection(doc, dir);

  frame.style.width = `${CAROUSEL_LAYOUT_WIDTH}px`;
  frame.style.maxWidth = 'none';
  doc.documentElement.style.width = `${CAROUSEL_LAYOUT_WIDTH}px`;
  void doc.documentElement.offsetWidth;

  const slide = findCarouselSlide(doc, dir, index);
  if (!slide) return false;

  const bottom = slide.getBoundingClientRect().bottom;
  frame.style.height = `${Math.max(Math.ceil(bottom + 48), 800)}px`;
  void doc.documentElement.offsetWidth;

  const box = slide.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  const scale = Math.min(fw / box.width, fh / box.height);
  const tx = -box.left * scale + (fw - box.width * scale) / 2;
  const ty = -box.top * scale + (fh - box.height * scale) / 2;
  frame.style.transformOrigin = '0 0';
  frame.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  return true;
}

function bindSlideImages(slide, urls) {
  const list = (Array.isArray(urls) ? urls : []).map(trim).filter(Boolean);
  if (!slide || !list.length) return;

  const paint = (el, src) => {
    if (!el || !src) return false;
    if (el.tagName === 'IMG') {
      el.setAttribute('src', src);
      el.removeAttribute('srcset');
      el.classList.remove('is-placeholder');
      el.style.objectFit = el.style.objectFit || 'cover';
      const cap = el.closest('figure')?.querySelector('figcaption');
      if (cap && /intended visual|image placeholder/i.test(cap.textContent || '')) {
        cap.setAttribute('hidden', '');
      }
      return true;
    }
    const nested = el.querySelector?.('img');
    if (nested) return paint(nested, src);
    el.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
    el.classList.add('is-photo');
    [...el.childNodes].forEach((node) => {
      if (node.nodeType === 3 || (node.nodeType === 1 && /intended visual|image placeholder|conceptual illustration/i.test(node.textContent || ''))) {
        if (node.nodeType === 1) node.style.display = 'none';
        else node.textContent = '';
      }
    });
    return true;
  };

  const slots = [
    ...slide.querySelectorAll('img[data-slot="image"], img[data-slot="illustration"]'),
    ...slide.querySelectorAll('[data-slot="image"], [data-slot="illustration"]'),
    ...[...slide.querySelectorAll('img')].filter((img) => !String(img.getAttribute('src') || '').trim()),
  ];
  const seen = new Set();
  let n = 0;
  slots.forEach((el) => {
    if (seen.has(el) || n >= list.length) return;
    seen.add(el);
    if (paint(el, list[n])) n += 1;
  });
  if (n >= list.length) return;

  const labelled = [...slide.querySelectorAll('div, figure, aside, p, span')].find((el) => (
    /intended visual|image placeholder|conceptual illustration/i.test(el.textContent || '')
  ));
  if (!labelled) return;
  const box = labelled.previousElementSibling || labelled.parentElement || labelled;
  paint(box, list[n] || list[0]);
}

export function paintCarouselSlideImages(frame, { direction, index, imageUrls }) {
  const slide = findCarouselSlide(frame?.contentDocument, direction, index);
  bindSlideImages(slide, imageUrls);
}

// Isolated 4:5 document for a single slide. Debug preview iframes the agent's
// full carousel HTML; Week View has to show one canvas. Putting that canvas in
// its own document means `html`/`body`/`:root` rules and direction wrappers
// apply the same way, and the app's `.wv-dynlay` CSS cannot restyle it.
const SLIDE_FRAME_SHELL = [
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}',
  'body>section[data-direction],body>.slide,body>article{width:100%;height:100%;box-sizing:border-box}',
].join('');

const SLIDE_FRAME_THEMED = [
  'html.is-themed,html.is-themed body{background:var(--t-ground-bg,#f4f2ee);color:var(--t-ground-fg,#1b100d)}',
  'html.is-themed .slide,html.is-themed .slide *{font-family:var(--t-body-face,sans-serif)}',
  'html.is-themed .slide :is(h1,h2,h3,[data-slot="title"],[data-slot="stat"],[data-slot="quote"]){font-family:var(--t-headline-face,sans-serif)}',
  'html.is-themed .slide{background:var(--t-ground-bg,#f4f2ee);color:var(--t-ground-fg,#1b100d)}',
  'html.is-themed .slide em,html.is-themed .slide [data-slot="stat"]{color:var(--t-accent-bg,#ff5227)}',
].join('');

function paintCssVars(paint) {
  if (!paint || typeof paint !== 'object') return '';
  return Object.entries(paint)
    .filter(([key, value]) => key.startsWith('--') && value != null && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

// ── Agent design-token remap ────────────────────────────────────────────────
// Carousel themes drive their colours/faces through their OWN custom properties
// (observed vocabulary: --paper/--ink/--sans/--serif/--field/--line/--muted),
// re-declared per `section[data-direction]`. So repainting only the final
// background/color/font (SLIDE_FRAME_THEMED) leaves the theme's tan rules,
// placeholder fills and muted text untouched. Remapping the tokens themselves to
// the brand fixes every element that reads them. The neutral ramp (muted/line/
// field) is DERIVED from the studio's ground+fg as solid hexes (not color-mix)
// so it also survives export rasterisation. Set with enough specificity to beat
// the theme's `[data-direction] .slide{--paper:…}` declarations.
function parseHex(value) {
  let s = String(value || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (s.length === 8) s = s.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function mixHex(aHex, bHex, weightA) {
  const a = parseHex(aHex);
  const b = parseHex(bHex);
  if (!a || !b) return '';
  const chan = (i) => {
    const n = Math.round(a[i] * weightA + b[i] * (1 - weightA));
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  };
  return `#${chan(0)}${chan(1)}${chan(2)}`;
}

function carouselTokenOverrides(paint) {
  const ground = paint?.['--t-ground-bg'];
  const fg = paint?.['--t-ground-fg'];
  const accent = paint?.['--t-accent-bg'];
  const body = paint?.['--t-body-face'];
  const head = paint?.['--t-headline-face'];
  const decls = [];
  const set = (name, val) => { if (val != null && val !== '') decls.push(`${name}:${val}`); };
  set('--paper', ground);
  set('--ink', fg);
  set('--sans', body);
  set('--serif', head);
  set('--accent', accent);
  // Full palette recolor: the studio's accent is "the one colour that points",
  // so route the theme's rule/divider token to it (dividers, hairlines, thin
  // borders read as brand) and give panel/placeholder fills a faint brand tint.
  // --muted stays a neutral fg/ground blend so secondary copy keeps legibility.
  set('--muted', mixHex(fg, ground, 0.58));
  set('--line', accent || mixHex(fg, ground, 0.24));
  set('--field', mixHex(accent, ground, 0.10) || mixHex(fg, ground, 0.10));
  return decls.join(';');
}

export function buildSlideFrameDocument(html, { themed = false, paint } = {}) {
  const { css, body } = splitLayoutDocument(html);
  if (!body) return '';
  const vars = themed ? paintCssVars(paint) : '';
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<style>${SLIDE_FRAME_SHELL}</style>`,
    css ? `<style>${css}</style>` : '',
    themed ? `<style>${vars ? `:root{${vars}}` : ''}${SLIDE_FRAME_THEMED}</style>` : '',
  ].filter(Boolean).join('');
  return `<!doctype html><html${themed ? ' class="is-themed"' : ''}><head>${head}</head><body>${body}</body></html>`;
}

// Carousels render the agent's full HTML document verbatim (multi-theme, the
// crop pass picks one slide), so the single-slide `buildSlideFrameDocument`
// theming never runs for them. Mirror it here: flag <html> as `is-themed`,
// inject the brand `--t-*` vars, remap the theme's OWN design tokens
// (--paper/--ink/--sans/--serif + a derived --muted/--line/--field ramp, plus
// --accent) so rules/placeholders/muted copy follow the brand too — a bare
// background/color/font repaint left the theme's tan tokens showing — and add
// the same final-property repaint rules as a fallback for themes that hardcode.
// The <style> goes in LAST (end of body) so it wins source-order ties; the token
// rule carries `[data-direction] .slide` specificity to beat the theme's own
// `[data-direction] .slide{--paper:…}` declarations. No `!important`, so a slide
// with a deliberately stronger inline/specific background keeps it.
export function applyThemeToCarouselDocument(html, { themed = false, paint } = {}) {
  const raw = trim(html);
  if (!raw || !themed) return raw;
  const vars = paintCssVars(paint);
  const tokens = carouselTokenOverrides(paint);
  const tokenRule = tokens
    ? `html.is-themed [data-direction],html.is-themed [data-direction] .slide,html.is-themed .slide{${tokens}}`
    : '';
  // Accent presence for themes that hardcode their marks instead of routing them
  // through a token: eyebrows/kickers/labels/indices/stats and any <hr> or rule
  // slot take the brand accent so "the one colour that points" is actually seen.
  const accentRule = [
    'html.is-themed .slide :is([data-slot="eyebrow"],[data-slot="kicker"],[data-slot="label"],[data-slot="index"],[data-slot="accent"],.eyebrow,.kicker,.label,.accent){color:var(--t-accent-bg,#ff5227)}',
    'html.is-themed .slide hr,html.is-themed .slide [data-slot="rule"],html.is-themed .slide [role="separator"]{border-color:var(--t-accent-bg,#ff5227);color:var(--t-accent-bg,#ff5227)}',
  ].join('');
  const style = `<style data-brand-theme>${vars ? `:root{${vars}}` : ''}${tokenRule}${SLIDE_FRAME_THEMED}${accentRule}</style>`;

  let out = raw;
  if (/<html[\s>]/i.test(out)) {
    out = out.replace(/<html\b([^>]*)>/i, (_, attrs) => {
      if (/\bclass\s*=/.test(attrs)) {
        return `<html${attrs.replace(/class\s*=\s*("|')([\s\S]*?)\1/i, (__, q, cls) => `class=${q}${cls} is-themed${q}`)}>`;
      }
      return `<html${attrs} class="is-themed">`;
    });
  } else {
    out = `<html class="is-themed">${out}`;
  }

  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${style}</body>`);
  if (/<\/html>/i.test(out)) return out.replace(/<\/html>/i, `${style}</html>`);
  return `${out}${style}`;
}

// Render the layout agent's output as-is. We only inject real image URLs and
// (when `scope` is set) prefix selectors so in-page embeds cannot leak. The
// Week View canvas skips scoping and iframes the fragment instead.
export function prepareLayoutHtml(raw, { scope, imageUrls } = {}) {
  let html = trim(raw);
  if (!html) return '';
  const urls = (Array.isArray(imageUrls) ? imageUrls : []).map(trim).filter(Boolean);
  html = injectSrc(html, urls);
  if (scope) {
    html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${scopeCss(css, scope)}</style>`);
  }
  if (!/class=["'][^"']*\bslide\b/i.test(html) && !/<article\b/i.test(html)) return '';
  return html;
}
