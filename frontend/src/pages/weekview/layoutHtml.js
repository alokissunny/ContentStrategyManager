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

// The only rewrite we apply to the agent's markup: wire real image URLs into the
// image slots (and drop truly empty images). Empty slots fall back to a neutral
// placeholder so the composition still holds its space.
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
