import { parseMarked, plainOf } from '../../lib/slidetext';
import { collectEditableElements, metaForSlotName, parseRoleSlotKey } from './slideTextRoles';

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
  // Real photos load lazily and asynchronously; a shimmer placeholder (shell CSS)
  // shows until they paint, and the parent adds `is-loaded` on load to stop it.
  const lazyAttrs = src && !/\bloading\s*=/.test(clean) ? ' loading="lazy" decoding="async"' : '';
  return `<img${clean ? ` ${clean}` : ''}${slot}${alt}${lazyAttrs}${srcAttr}>`;
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

export function paintSlideCopy(frame, { direction, index, title, subtitle, slots } = {}) {
  const slide = slideRootOf(frame, { direction, index });
  if (!slide) return false;
  if (slots && typeof slots === 'object') {
    Object.entries(slots).forEach(([key, value]) => {
      if (value == null) return;
      const parsed = parseRoleSlotKey(key);
      if (parsed.line) {
        const el = slide.querySelector(`[data-slot="line-${parsed.lineAt}"]`)
          || collectEditableElements(slide).filter((node) => !node.getAttribute('data-slot'))[parsed.lineAt];
        if (!el) return;
        const html = escText(plainOf(value));
        const leaf = el.querySelector('h1, h2, h3, h4, h5, h6, p') || el;
        if (leaf !== el) leaf.innerHTML = html;
        else el.innerHTML = withPreservedFrame(el.innerHTML, html);
        return;
      }
      const meta = metaForSlotName(parsed.slot);
      const list = [...slide.querySelectorAll(`[data-slot="${parsed.slot}"]`)];
      const el = list[parsed.at];
      if (!el) return;
      const html = meta.marked ? markedToInner(value) : escText(plainOf(value));
      const leaf = el.querySelector('h1, h2, h3, h4, h5, h6, p') || el;
      if (leaf !== el) leaf.innerHTML = html;
      else el.innerHTML = withPreservedFrame(el.innerHTML, html);
    });
    return true;
  }
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
// so patching slide.title/subtitle alone never shows. Rewrite matching slots in
// place. `slots` is a map of discovery keys (title, label#1, line-0, …).
export function rewriteLayoutText(html, { title, subtitle, slots, direction, index } = {}) {
  let out = String(html || '');
  if (!out) return out;
  if (slots && typeof slots === 'object') {
    Object.entries(slots).forEach(([key, value]) => {
      if (value == null) return;
      const parsed = parseRoleSlotKey(key);
      if (parsed.line) {
        out = rewriteUnlabeledLine(out, {
          direction,
          index,
          lineAt: parsed.lineAt,
          value,
        });
        return;
      }
      const meta = metaForSlotName(parsed.slot);
      const inner = meta.marked ? markedToInner(value) : escText(plainOf(value));
      out = replaceSlotInnerAt(out, parsed.slot, inner, parsed.at).html;
    });
    return out;
  }
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

function replaceSlotInnerAt(html, slot, inner, at = 0) {
  let n = -1;
  let found = false;
  const re = new RegExp(
    `(<([a-z][a-z0-9]*)\\b[^>]*\\bdata-slot\\s*=\\s*["']${slot}["'][^>]*>)([\\s\\S]*?)(<\\/\\2>)`,
    'gi',
  );
  const out = String(html || '').replace(re, (_all, open, _tag, prev, close) => {
    n += 1;
    if (n !== at) return _all;
    found = true;
    return `${open}${withPreservedFrame(prev, inner)}${close}`;
  });
  return { html: out, found };
}

function rewriteUnlabeledLine(html, { direction, index, lineAt, value } = {}) {
  const raw = String(html || '');
  if (!raw || typeof DOMParser === 'undefined') return raw;
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const slide = findCarouselSlide(doc, direction, index)
    || doc.querySelector('article.slide, .slide, article');
  if (!slide) return raw;
  const el = slide.querySelector(`[data-slot="line-${lineAt}"]`)
    || collectEditableElements(slide).filter((node) => !node.getAttribute('data-slot'))[lineAt];
  if (!el) return raw;
  const inner = escText(plainOf(value));
  const leaf = el.querySelector('h1, h2, h3, h4, h5, h6, p') || el;
  if (leaf !== el) leaf.innerHTML = inner;
  else el.innerHTML = withPreservedFrame(el.innerHTML, inner);
  if (!el.getAttribute('data-slot')) el.setAttribute('data-slot', `line-${lineAt}`);
  return serializeParsed(raw, doc);
}

export function rewriteCarouselDocumentText(html, { index, title, subtitle, slots, direction } = {}) {
  const raw = String(html || '');
  if (!raw) return raw;
  const idx = String(Number(index) > 0 ? Number(index) : 1);
  return raw.replace(/<article\b[^>]*>[\s\S]*?<\/article>/gi, (article) => {
    const n = (article.match(/\bdata-index=["']([^"']+)["']/i) || [])[1];
    if (String(n || '') !== idx) return article;
    return rewriteLayoutText(article, { title, subtitle, slots, direction, index });
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
  { id: 'natural-tactile', match: /natural\s*(?:and|&)?\s*tactile/i },
  { id: 'contemporary-gallery', match: /contemporary\s*gallery/i },
  { id: 'editorial', match: /^editorial$/i },
  { id: 'architectural', match: /^architectural$/i },
  { id: 'bold-minimal', match: /bold\s*-?\s*minimal/i },
  // Change-theme catalog (instagram-carousel-themes.html)
  { id: 'scrapbook-diary', match: /scrapbook\s*diary/i },
  { id: 'editorial-magazine', match: /editorial\s*magazine/i },
  { id: 'annotated-photo-dump', match: /annotated\s*photo\s*dump/i },
  { id: 'before-process-after', match: /before\s*(?:→|->|to)?\s*process\s*(?:→|->|to)?\s*after/i },
  { id: 'myth-vs-reality', match: /myth\s*(?:vs\.?|versus)\s*reality/i },
  { id: 'moodboard-story', match: /moodboard\s*story/i },
  { id: 'seamless-panorama', match: /seamless\s*panorama/i },
  { id: 'personal-field-notes', match: /personal\s*field\s*notes/i },
];

const THEME_IDS = new Set(THEME_CATALOG.map((t) => t.id));

// Offered themes, in rank order. Architectural Minimal is the default (first).
// warm-editorial was removed as a theme; it stays parseable via THEME_CATALOG so
// carousels generated before the removal still render, but it is never offered
// or defaulted to any more.
export const THEME_ORDER = [
  'architectural-minimal',
  'quiet-luxury',
  'natural-tactile',
  'contemporary-gallery',
];

function canonThemeId(value) {
  const original = String(value || '').trim();
  const raw = original.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw) return '';
  if (THEME_IDS.has(raw)) return raw;
  if (raw === 'natural-and-tactile') return 'natural-tactile';
  // Agent / Change-theme slugs (e.g. scrapbook-diary) must stay verbatim so
  // `section[data-direction="…"]` still matches. Fuzzy catalog matching is only
  // for human labels like "Architectural Minimal".
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw)) return raw;
  const hit = THEME_CATALOG.find((t) => t.match.test(original));
  return hit?.id || raw;
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

// True when a slide renders by cropping the carousel document (a themed carousel
// slide). False when it renders from its own layoutHtml — an on-demand layout
// variation, which is a standalone <style>+<article> fragment not in the
// document. The distinction is the presence of a real theme direction.
export function slideIsThemed(slide) {
  // Empty studio-added pages never crop the carousel document.
  if (slide?.blank || slide?.layout === 'blank') return false;
  if (slide?.manual || String(slide?.layout || '').startsWith('el-')) return false;
  // Any stored layoutTheme (including Change-theme catalog slugs) means the
  // slide belongs to the carousel document — do not require the legacy catalog.
  if (trim(slide?.layoutTheme) || canonThemeId(slide?.layoutTheme)) return true;
  const opts = Array.isArray(slide?.layoutOptions) ? slide.layoutOptions : [];
  const applied = opts.find((o) => o.html && o.html === slide?.layoutHtml);
  if (applied) {
    return Boolean(trim(applied.direction) || canonThemeId(applied.direction));
  }
  if (opts.length) {
    return opts.some((o) => trim(o?.direction) || canonThemeId(o?.direction));
  }
  return true;
}

export function layoutDirectionOf(slide) {
  const stored = canonThemeId(slide?.layoutTheme) || trim(slide?.layoutTheme).toLowerCase();
  if (stored) return stored;
  const opts = Array.isArray(slide?.layoutOptions) ? slide.layoutOptions : [];
  const hit = opts.find((o) => o.html && o.html === slide?.layoutHtml) || opts[0] || {};
  return canonThemeId(hit.direction)
    || trim(hit.direction).toLowerCase()
    || canonThemeId(hit.label)
    || THEME_ORDER[0];
}

export function themeIdOf(opt) {
  return canonThemeId(opt?.direction)
    || trim(opt?.direction).toLowerCase()
    || canonThemeId(opt?.label);
}

// The carousel theme an option belongs to, from its `direction` ONLY (never the
// label). On-demand Change-layout variations carry an empty direction and a
// composition-name label ("Centered Verdict"); those are standalone fragments,
// not document themes, so they must not be mistaken for a theme via the label.
export function themeDirectionOf(opt) {
  return canonThemeId(opt?.direction) || trim(opt?.direction).toLowerCase();
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
      // Force the target theme visible with !important: the agent's document
      // hides non-default `section[data-direction]` via its own CSS (only the
      // loaded theme shows), so merely clearing the inline display leaves the
      // section at the stylesheet's `display:none` and its slide measures as
      // zero-size — the crop then falls back to the preview chrome.
      sec.style.setProperty('display', 'block', 'important');
      sec.style.setProperty('visibility', 'visible', 'important');
      sec.style.setProperty('opacity', '1', 'important');
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

  // The width the carousel designed this slide at: a document that sizes its
  // slides itself (`width: min(100%, 720px)`, type in px capped for that
  // width) must be laid out at THAT width — forcing 1100px kept its px type at
  // 720px sizes and re-flowed the layout, so the editor no longer matched the
  // model's output. A slide that just fills its container (width:100%) has no
  // design width of its own and keeps the full layout width. Measured with any
  // earlier pin cleared, since crop runs again on every repaint.
  slide.style.width = '';
  slide.style.height = '';
  void doc.documentElement.offsetWidth;
  const natural = slide.getBoundingClientRect().width;
  const designWidth = natural >= 280 && natural < CAROUSEL_LAYOUT_WIDTH - 1
    ? Math.round(natural)
    : CAROUSEL_LAYOUT_WIDTH;

  // Every slide previews as one 4:5 Instagram frame, so pin the slide to that
  // exact box. A composition shorter (or taller) than 4:5 would otherwise be
  // contain-fitted and letterboxed — the card's own background then shows as
  // top/bottom (or side) margins, which is the gap we want gone. Sizing the box
  // also gives absolute-positioned compositions (which collapse to 0 height on an
  // indefinite parent) a canvas to lay out against. The slide's own overflow:hidden
  // clips any internal overflow past the frame.
  slide.style.boxSizing = 'border-box';
  slide.style.width = `${designWidth}px`;
  slide.style.height = `${Math.round(designWidth * 1.25)}px`;
  void doc.documentElement.offsetWidth;

  const bottom = slide.getBoundingClientRect().bottom;
  frame.style.height = `${Math.max(Math.ceil(bottom + 48), 800)}px`;
  void doc.documentElement.offsetWidth;

  const box = slide.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  // CONTAIN-fit: show the whole slide, never crop its content. The media track is
  // kept at 4:5 in CSS (matching the slide), so contain fills it exactly with no
  // letterbox — the fit only ever matters as a safety net if the track is briefly
  // off-ratio, and there it must letterbox rather than truncate the composition.
  const scale = Math.min(fw / box.width, fh / box.height);
  const tx = -box.left * scale + (fw - box.width * scale) / 2;
  const ty = -box.top * scale + (fh - box.height * scale) / 2;
  frame.style.transformOrigin = '0 0';
  frame.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  // The whole carousel is one tall document, so every slide above/below the
  // target sits in the same iframe. Clip the iframe to exactly the target slide's
  // box (in its own pre-transform pixel space; the transform then scales the
  // clipped region), so no neighbouring slide can ever paint. The host's own
  // overflow:hidden then trims the cover overflow to the frame. box.left/top are
  // iframe-local offsets (the document never scrolls).
  const frameW = CAROUSEL_LAYOUT_WIDTH;
  const frameH = parseFloat(frame.style.height) || (box.top + box.height);
  const clip = (v) => Math.max(0, v);
  frame.style.clipPath = `inset(${clip(box.top)}px ${clip(frameW - (box.left + box.width))}px `
    + `${clip(frameH - (box.top + box.height))}px ${clip(box.left)}px)`;
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
// Skeleton shimmer behind a real photo until it paints (it lazy-loads). The
// parent (DynamicLayout) adds `is-loaded` on the img's load event to stop the
// animation; an opaque photo covers the background, so nothing shows through once
// loaded. Shared by the single-slide shell and the themed carousel document.
// Until a photo has FULLY loaded its pixels are pushed out of the box
// (object-position far off) so only the shimmer shows — WebP/PNG are not
// progressive, and a large image otherwise paints in visibly top-down as it
// downloads. On load it fades in.
export const IMG_SHIMMER_CSS = [
  'img[data-slot="image"][src]:not(.is-loaded){background-color:#e9e6df;'
    + 'background-image:linear-gradient(100deg,rgba(255,255,255,0) 36%,rgba(255,255,255,.6) 50%,rgba(255,255,255,0) 64%);'
    + 'background-size:200% 100%;background-repeat:no-repeat;animation:hf-imgshimmer 1.15s ease-in-out infinite;'
    + 'object-position:-99999px -99999px !important;color:transparent}',
  'img[data-slot="image"].is-loaded{animation:hf-imgin .28s ease-out}',
  '@keyframes hf-imgshimmer{0%{background-position:180% 0}100%{background-position:-60% 0}}',
  '@keyframes hf-imgin{from{opacity:0}to{opacity:1}}',
  '@media (prefers-reduced-motion:reduce){img[data-slot="image"][src]:not(.is-loaded){animation:none}img[data-slot="image"].is-loaded{animation:none}}',
  // a picture space with no picture — none bound to it yet, or one that failed
  // to load — shows as an empty picture placeholder (a hatch), never as a gap
  'img[data-slot="image"]:not([src]),img[data-slot="image"].is-placeholder,img[data-slot="image"].is-broken{'
    + 'background-color:#e6e3dd;background-image:repeating-linear-gradient(135deg,rgba(27,16,13,.08) 0 10px,transparent 10px 20px);'
    + 'color:transparent;object-position:-99999px -99999px !important;animation:none}',
].join('');

const SLIDE_FRAME_SHELL = [
  'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#fff}',
  'body>section[data-direction],body>.slide,body>article{width:100%;height:100%;box-sizing:border-box}',
  IMG_SHIMMER_CSS,
].join('');

// the ground image sits BETWEEN the theme colour and the slide's own content:
// it is painted as the element's background-image over the ground colour, so a
// slide's injected photos and its text (both DOM children) always draw on top.
// Unset, `--t-ground-image` falls back to `none` and only the flat colour shows.
const GROUND_LAYER = 'background-color:var(--t-ground-bg,#f4f2ee);background-image:var(--t-ground-image,none);background-size:cover;background-position:center;background-repeat:no-repeat';
// No blanket `color` here: text inherits it, including text on a slide's own
// cards (cream notes, stickers) where the set's ink can be unreadable.
// DynamicLayout's paintSetInk() recolours exactly the text on the ground.
const SLIDE_FRAME_THEMED_COLOURS = [
  `html.is-themed,html.is-themed body{${GROUND_LAYER}}`,
  `html.is-themed .slide{${GROUND_LAYER}}`,
  'html.is-themed .slide em,html.is-themed .slide [data-slot="stat"]{color:var(--t-accent-bg,#ff5227)}',
  // the marks that point take the accent in both render paths (the document
  // path also adds this in applyThemeToCarouselDocument)
  'html.is-themed .slide u,html.is-themed .slide [class*="underline"]{text-decoration-color:var(--t-accent-bg,#ff5227)}',
  'html.is-themed .slide hr,html.is-themed .slide [data-slot="rule"]{border-color:var(--t-accent-bg,#ff5227)}',
].join('');
const SLIDE_FRAME_THEMED = [
  SLIDE_FRAME_THEMED_COLOURS,
  'html.is-themed,html.is-themed body,html.is-themed .slide{color:var(--t-ground-fg,#1b100d)}',
  'html.is-themed .slide,html.is-themed .slide *{font-family:var(--t-body-face,sans-serif)}',
  'html.is-themed .slide :is(h1,h2,h3,[data-slot="title"],[data-slot="stat"],[data-slot="quote"]){font-family:var(--t-headline-face,sans-serif)}',
].join('');

// `themed === 'ground'` — Editor mode › Background on a slide with no colour
// set: lay the chosen background (or none, for plain canvas) over the slide's
// own ground colour. Nothing else about the carousel is repainted.
const SLIDE_FRAME_GROUND = 'html.is-themed .slide{background-image:var(--t-ground-image,none);background-size:cover;background-position:center;background-repeat:no-repeat}';
const groundOnly = (themed) => themed === 'ground';
const groundVars = (paint) => Object.fromEntries(
  Object.entries(paint || {}).filter(([k]) => k === '--t-ground-image'),
);

// `themed === 'colours'` — a Brand Kit colour set on one slide: repaint the
// palette, keep the slide's own typefaces (no face vars, no font rules).
const coloursOnly = (themed) => themed === 'colours';
const withoutFaces = (paint) => Object.fromEntries(
  Object.entries(paint || {}).filter(([k]) => !/-face$|post-font/.test(k)),
);

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
  if (coloursOnly(themed)) paint = withoutFaces(paint);
  if (groundOnly(themed)) paint = groundVars(paint);
  const vars = themed ? paintCssVars(paint) : '';
  const frame = groundOnly(themed)
    ? SLIDE_FRAME_GROUND
    : (coloursOnly(themed) ? SLIDE_FRAME_THEMED_COLOURS : SLIDE_FRAME_THEMED);
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<style>${SLIDE_FRAME_SHELL}</style>`,
    css ? `<style>${css}</style>` : '',
    themed ? `<style>${vars ? `:root{${vars}}` : ''}${frame}</style>` : '',
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
  // A Brand Kit colour set: the carousel agent writes its palette as literal
  // hex values (not tokens), so recolour those values in place — every colour
  // keeps the role the agent gave it (ground / ink / accent, dark slides too).
  // A background the slide was given is still laid over its ground.
  if (coloursOnly(themed)) {
    // Newer carousels name their colour roles (--brand-primary / -background /
    // -accent, prompts/plan-carousel.md › Colour roles): just re-point those.
    // Older ones wrote literal hex values, recoloured by inference.
    const roles = colourRoleVars(paint);
    const named = roles && BRAND_ROLE_RE.test(raw);
    const recoloured = named ? raw : recolourCarouselDocument(raw, paint);
    const gv = paintCssVars(groundVars(paint));
    const extra = `${named ? `:root:root,html.is-themed [data-direction],html.is-themed .slide{${roles}}` : ''}${gv ? `:root{${gv}}${SLIDE_FRAME_GROUND}` : ''}`;
    return markThemed(recoloured, `<style data-brand-theme>${extra}${IMG_SHIMMER_CSS}</style>`);
  }
  if (groundOnly(themed)) {
    const gv = paintCssVars(groundVars(paint));
    const groundStyle = `<style data-brand-theme>${gv ? `:root{${gv}}` : ''}${SLIDE_FRAME_GROUND}${IMG_SHIMMER_CSS}</style>`;
    return markThemed(raw, groundStyle);
  }
  if (coloursOnly(themed)) paint = withoutFaces(paint);
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
  const frame = coloursOnly(themed) ? SLIDE_FRAME_THEMED_COLOURS : SLIDE_FRAME_THEMED;
  const style = `<style data-brand-theme>${vars ? `:root{${vars}}` : ''}${tokenRule}${frame}${accentRule}${IMG_SHIMMER_CSS}</style>`;
  return markThemed(raw, style);
}

// ── Brand Kit fonts ─────────────────────────────────────────────────────────
// The Brand Kit's Typography (`--bk-font-heading/-body/-detail` in paint, only
// the slots the studio chose — identity.brandFontVars) restyles every slide.
// Newer carousels name their font roles (--brand-font-heading / -body / -detail,
// prompts/plan-carousel.md › Font roles): those are re-pointed. Older ones get
// the faces by element job. The slide is its own document, so the app's font
// stylesheets (`links`) and the studio's uploaded faces (`faceCss`) go in too.
const BRAND_FONT_ROLE_RE = /--brand-font-(?:heading|body|detail)\s*:/i;
const HEAD_SEL = 'h1,h2,h3,[data-slot="title"],[data-slot="stat"],[data-slot="quote"]';
const DETAIL_SEL = '[data-slot="eyebrow"],[data-slot="kicker"],[data-slot="label"],[data-slot="caption"],[data-slot="index"],[data-slot="detail"],[data-slot="note"],[data-slot="action"],.eyebrow,.kicker,.label';

export function applyBrandFonts(page, paint, { links = [], faceCss = '' } = {}) {
  const html = trim(page);
  const heading = paint?.['--bk-font-heading'];
  const body = paint?.['--bk-font-body'];
  const detail = paint?.['--bk-font-detail'];
  if (!html || (!heading && !body && !detail)) return html;
  const roles = [
    ['--brand-font-heading', heading],
    ['--brand-font-body', body],
    ['--brand-font-detail', detail],
  ].filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(';');
  let rules;
  if (BRAND_FONT_ROLE_RE.test(html)) {
    rules = `:root:root,html [data-direction],html .slide{${roles}}`;
  } else {
    const within = (sel) => sel.split(',').map((s) => `html .slide ${s},html .slide ${s} *`).join(',');
    rules = [
      // body first, sparing the headline and detail runs (so an untouched slot
      // keeps the carousel's face); then the headline and detail faces
      body ? `html .slide,html .slide :not(:is(${HEAD_SEL},${DETAIL_SEL}),:is(${HEAD_SEL},${DETAIL_SEL}) *){font-family:${body} !important}` : '',
      heading ? `${within(HEAD_SEL)}{font-family:${heading} !important}` : '',
      detail ? `${within(DETAIL_SEL)}{font-family:${detail} !important}` : '',
    ].join('');
  }
  const head = [
    ...links.filter((h) => /^https:\/\//.test(h)).map((h) => `<link rel="stylesheet" href="${h.replace(/"/g, '&quot;')}">`),
    faceCss ? `<style>${faceCss}</style>` : '',
  ].join('');
  let out = html;
  if (head) {
    out = /<head[^>]*>/i.test(out) ? out.replace(/<head([^>]*)>/i, (m) => `${m}${head}`) : `${head}${out}`;
  }
  const style = `<style data-brand-fonts>${rules}</style>`;
  if (/<\/body>/i.test(out)) return out.replace(/<\/body>/i, `${style}</body>`);
  return `${out}${style}`;
}

// The carousel's declared colour roles → the set's three colours.
const BRAND_ROLE_RE = /--brand-(?:primary|background|accent)\s*:/i;
function colourRoleVars(paint) {
  const decls = [
    ['--brand-primary', paint?.['--t-ground-fg']],
    ['--brand-background', paint?.['--t-ground-bg']],
    ['--brand-accent', paint?.['--t-accent-bg']],
  ].filter(([, v]) => parseHex(v)).map(([k, v]) => `${k}:${v}`);
  return decls.length ? decls.join(';') : '';
}

// ── Colour-set recolour (older carousels with literal colours) ──────────────
// Reads the carousel's own palette from its CSS (ground = the most-used
// background, ink = the most-used text colour that reads on it, accent = the
// colour furthest off the ground↔ink axis), then maps every colour in the
// document onto the set: accent-family colours become the set's accent, and
// the neutrals keep their place between ground and ink (a tint of the ground
// stays a tint, an espresso "dark slide" becomes the set's ink with ground text).
// Only declaration values and SVG paint attributes are touched — never
// selectors, url(#id) references or image sources.
const NAMED_COLOURS = { white: [255, 255, 255], black: [0, 0, 0] };
const COLOUR_RE = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)|\b(?:white|black)\b/gi;

function colourOf(token) {
  const t = String(token).trim().toLowerCase();
  if (NAMED_COLOURS[t]) return { rgb: NAMED_COLOURS[t], alpha: null };
  if (t[0] === '#') {
    let s = t.slice(1);
    if (s.length <= 4) s = s.split('').map((c) => c + c).join('');
    const rgb = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
    const alpha = s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : null;
    return rgb.some(Number.isNaN) ? null : { rgb, alpha };
  }
  const nums = t.replace(/^rgba?\(|\)$/g, '').split(/[\s,/]+/).filter(Boolean);
  if (nums.length < 3) return null;
  const chan = (v) => (v.endsWith('%') ? parseFloat(v) * 2.55 : parseFloat(v));
  const rgb = nums.slice(0, 3).map(chan);
  if (rgb.some(Number.isNaN)) return null;
  const a = nums[3];
  return { rgb, alpha: a == null ? null : (a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a)) };
}

const rgbKey = (rgb) => rgb.map((n) => Math.round(n)).join(',');
const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lum = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
// position of c along ground→ink (0 = ground, 1 = ink) and its distance off that axis
function onAxis(c, g, i) {
  const d = [i[0] - g[0], i[1] - g[1], i[2] - g[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
  const t = ((c[0] - g[0]) * d[0] + (c[1] - g[1]) * d[1] + (c[2] - g[2]) * d[2]) / len2;
  const tc = Math.max(0, Math.min(1, t));
  const p = [g[0] + d[0] * tc, g[1] + d[1] * tc, g[2] + d[2] * tc];
  return { t: tc, off: rgbDist(c, p) };
}
const mixRgb = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
function rgbOut(rgb, alpha) {
  const [r, g, b] = rgb.map((n) => Math.max(0, Math.min(255, Math.round(n))));
  if (alpha != null && alpha < 1) return `rgba(${r},${g},${b},${Math.round(alpha * 1000) / 1000})`;
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// every `prop: value` in a CSS text (style blocks and style="" attributes)
const DECL_RE = /(^|[{;])(\s*)(--[\w-]+|[a-z-]+)(\s*:\s*)([^;{}]+)/gi;
// SVG / legacy paint attributes that carry a colour
const PAINT_ATTR_RE = /(\s(?:fill|stroke|stop-color|flood-color|lighting-color|color|bgcolor)\s*=\s*)(["'])([^"']*)\2/gi;
const STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const STYLE_ATTR_RE = /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi;

function eachColour(value, fn) {
  // never a url(#gradient) reference
  return String(value).replace(/url\([^)]*\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/gi, (m) => {
    if (/^url\(/i.test(m)) return m;
    if (!new RegExp(`^(?:${COLOUR_RE.source})$`, 'i').test(m)) return m;
    const c = colourOf(m);
    return c ? fn(c, m) : m;
  });
}

function recolourCarouselDocument(html, paint) {
  const target = {
    ground: parseHex(paint?.['--t-ground-bg']),
    ink: parseHex(paint?.['--t-ground-fg']),
    accent: parseHex(paint?.['--t-accent-bg']),
  };
  if (!target.ground && !target.ink && !target.accent) return html;

  // 1. read the document's palette
  const bg = new Map();
  const fg = new Map();
  const all = new Map();
  const vote = (map, rgb) => { const k = rgbKey(rgb); map.set(k, { rgb, n: (map.get(k)?.n || 0) + 1 }); };
  const readDecls = (css) => {
    String(css).replace(DECL_RE, (m, _a, _b, prop, _c, value) => {
      const p = prop.toLowerCase();
      eachColour(value, (c, tok) => {
        if (c.alpha != null && c.alpha < 0.35) return tok; // scrims don't define the palette
        vote(all, c.rgb);
        if (p === 'background' || p === 'background-color') vote(bg, c.rgb);
        else if (p === 'color') vote(fg, c.rgb);
        return tok;
      });
      return m;
    });
  };
  html.replace(STYLE_BLOCK_RE, (m, _o, css) => { readDecls(css); return m; });
  html.replace(STYLE_ATTR_RE, (m, _p, _q, css) => { readDecls(`;${css}`); return m; });

  const top = (map, ok = () => true) => [...map.values()].filter((x) => ok(x.rgb))
    .sort((a, b) => (b.n - a.n) || ((all.get(rgbKey(b.rgb))?.n || 0) - (all.get(rgbKey(a.rgb))?.n || 0)))[0]?.rgb || null;
  const srcGround = top(bg) || top(all);
  if (!srcGround) return html;
  const reads = (rgb) => Math.abs(lum(rgb) - lum(srcGround)) > 70;
  const srcInk = top(fg, reads)
    || [...all.values()].map((x) => x.rgb).sort((a, b) => Math.abs(lum(b) - lum(srcGround)) - Math.abs(lum(a) - lum(srcGround)))[0]
    || null;
  if (!srcInk || rgbDist(srcInk, srcGround) < 30) return html;
  const srcAccent = [...all.values()].map((x) => x.rgb)
    .map((rgb) => ({ rgb, off: onAxis(rgb, srcGround, srcInk).off }))
    .sort((a, b) => b.off - a.off)
    .find((x) => x.off > 40)?.rgb || null;

  const newGround = target.ground || srcGround;
  const newInk = target.ink || srcInk;
  const newAccent = target.accent || newInk;

  // 2. map every colour onto the set
  // the carousel's main copy colour is text, never the accent
  const mainText = top(fg, reads);
  const cache = new Map(mainText ? [[rgbKey(mainText), newInk]] : []);
  const mapColour = (c) => {
    const k = rgbKey(c.rgb);
    let rgb = cache.get(k);
    if (!rgb) {
      const axis = onAxis(c.rgb, srcGround, srcInk);
      rgb = (srcAccent && rgbDist(c.rgb, srcAccent) < axis.off)
        ? newAccent
        : mixRgb(newGround, newInk, axis.t);
      cache.set(k, rgb);
    }
    return rgbOut(rgb, c.alpha);
  };
  const recolourDecls = (css) => String(css).replace(DECL_RE, (m, a, b, prop, c, value) => `${a}${b}${prop}${c}${eachColour(value, mapColour)}`);

  let out = html.replace(STYLE_BLOCK_RE, (m, open, css, close) => `${open}${recolourDecls(css)}${close}`);
  out = out.replace(STYLE_ATTR_RE, (m, p, q, css) => `${p}${q}${recolourDecls(css)}${q}`);
  out = out.replace(PAINT_ATTR_RE, (m, p, q, value) => `${p}${q}${eachColour(value, mapColour)}${q}`);
  return out;
}

// Flag <html> as `is-themed` and put the theme <style> last (end of body) so it
// wins source-order ties.
function markThemed(raw, style) {
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

// The carousel agent sometimes places a panel with top/bottom offsets but forgets
// `position:absolute` (it relied on a helper class like `.taped` and left it off).
// A static element ignores its offsets, so the panel falls to the top of the
// slide and covers the copy. getComputedStyle reports a static element's
// specified offset (e.g. "47%") rather than "auto" only when one was authored,
// so this matches exactly the elements the agent meant to place — promote them.
export function repairStrandedOffsets(doc) {
  const view = doc?.defaultView;
  if (!view) return 0;
  let fixed = 0;
  doc.querySelectorAll('.slide *, article[data-index] *').forEach((el) => {
    const cs = view.getComputedStyle(el);
    if (cs.position !== 'static') return;
    if (cs.top === 'auto' && cs.bottom === 'auto') return;
    el.style.position = 'absolute';
    fixed += 1;
  });
  return fixed;
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
