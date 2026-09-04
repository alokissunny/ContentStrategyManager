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

// Render the layout agent's output as-is. We only inject real image URLs and
// scope the agent's <style> so it cannot leak past this slide. Faces, colours,
// sizes, scrims, and composition all come straight from the agent — the app no
// longer re-skins them from Library Settings.
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
