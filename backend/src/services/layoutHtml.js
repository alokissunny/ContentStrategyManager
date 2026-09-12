const MAX_LAYOUT_HTML = 120000;

function stripDanger(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/expression\s*\(/gi, '');
}

// The layout agent's CSS is preserved as-is — sizes, colours, transforms, and
// pseudo-elements all render exactly as emitted. Only HTML-level danger
// (scripts, on* handlers, iframes, javascript:/expression()) is stripped, by
// stripDanger() over the whole document. No re-colouring or re-sizing here.
function sanitizeLayoutCss(css) {
  return String(css || '');
}

function hasImageSlot(html) {
  return /<img\b[^>]*data-slot\s*=\s*["']image["']/i.test(String(html || ''))
    || /data-slot\s*=\s*["'](?:image|illustration)["']/i.test(String(html || ''));
}

function collectLayoutStyleBlocks(htmls) {
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

function shareLayoutStyles(htmls) {
  const list = (Array.isArray(htmls) ? htmls : []).map((h) => String(h || ''));
  const blocks = collectLayoutStyleBlocks(list);
  if (!blocks.length) return list;
  const head = blocks.join('');
  return list.map((html) => {
    const raw = String(html || '').trim();
    if (!raw) return html;
    if (/<style\b/i.test(raw)) return html;
    return `${head}${raw}`;
  });
}

function extractLayoutHtml(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  const fenced = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  s = stripDanger(s);
  if (/<html[\s>]/i.test(s) || /<body[\s>]/i.test(s)) {
    const styles = [...s.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n');
    const body = (s.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || '';
    s = `${styles}\n${body}`.trim();
    s = stripDanger(s);
  }
  s = s.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<style>${sanitizeLayoutCss(css)}</style>`);
  if (!/class=["'][^"']*\bslide\b/i.test(s) && !/<article\b/i.test(s)) return '';
  if (s.length > MAX_LAYOUT_HTML) s = s.slice(0, MAX_LAYOUT_HTML);
  return s;
}

function extractHtmlDocument(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  const fenced = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  const start = s.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) s = s.slice(start).trim();
  return s;
}

const CAROUSEL_THEMES = [
  { id: 'warm-editorial', label: 'Warm Editorial' },
  { id: 'architectural-minimal', label: 'Architectural Minimal' },
  { id: 'quiet-luxury', label: 'Quiet Luxury' },
  { id: 'natural-tactile', label: 'Natural & Tactile' },
  { id: 'contemporary-gallery', label: 'Contemporary Gallery' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'architectural', label: 'Architectural' },
  { id: 'bold-minimal', label: 'Bold Minimal' },
];

function labelFromId(id) {
  const known = CAROUSEL_THEMES.find((d) => d.id === id);
  if (known) return known.label;
  return String(id || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function canonThemeId(value) {
  const raw = String(value || '').trim().toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw) return '';
  if (CAROUSEL_THEMES.some((d) => d.id === raw)) return raw;
  if (raw === 'natural-and-tactile') return 'natural-tactile';
  return raw;
}

function discoveredThemes(html) {
  const found = [];
  const seen = new Set();
  const add = (value) => {
    const id = canonThemeId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    found.push({ id, label: labelFromId(id) });
  };
  // Prefer real theme blocks that contain slides — ignore bare buttons/labels
  // that also carry data-direction for the preview UI.
  CAROUSEL_THEMES.forEach((d) => {
    const block = blockForDirection(html, d.id);
    if (block && slideArticles(block).length) add(d.id);
  });
  if (found.length) return found;
  CAROUSEL_THEMES.forEach((d) => {
    if (blockForDirection(html, d.id)) add(d.id);
  });
  [...String(html || '').matchAll(/\bdata-direction=["']([^"']+)["']/gi)].forEach((m) => add(m[1]));
  return found;
}

function htmlAttr(tag, name) {
  const m = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return m ? m[1].trim() : '';
}

function articleBlocks(html) {
  return [...String(html || '').matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi)].map((m) => m[0]);
}

function slideArticles(html) {
  const fromArticles = articleBlocks(html).filter((a) => (
    /class=["'][^"']*\bslide\b/i.test(a)
    || /\bdata-index\s*=/i.test(a)
    || /\bdata-slot\s*=/i.test(a)
  ));
  if (fromArticles.length) return fromArticles;
  // Some model runs emit canvases as div.slide instead of article.slide.
  return balancedBlocks(html, 'div').filter((a) => (
    /class=["'][^"']*\bslide\b/i.test(a) && /\bdata-index\s*=/i.test(a)
  ));
}

/** Match an open/close tag pair with correct nesting (non-greedy </tag> breaks on nested chrome). */
function balancedBlocks(html, tagName) {
  const s = String(html || '');
  const tag = String(tagName || 'section').toLowerCase();
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = openRe.exec(s))) {
    if (/\/>\s*$/.test(m[0])) continue;
    const start = m.index;
    let depth = 1;
    const walk = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
    walk.lastIndex = start + m[0].length;
    let t;
    while ((t = walk.exec(s))) {
      if (/^<\//.test(t[0])) {
        depth -= 1;
        if (depth === 0) {
          out.push(s.slice(start, t.index + t[0].length));
          openRe.lastIndex = t.index + t[0].length;
          break;
        }
      } else if (!/\/>\s*$/.test(t[0])) {
        depth += 1;
      }
    }
  }
  return out;
}

function blockForDirection(html, id) {
  const want = String(id || '').trim().toLowerCase();
  if (!want) return '';
  const s = String(html || '');
  const openRe = /<(section|div)\b[^>]*>/gi;
  let m;
  while ((m = openRe.exec(s))) {
    if (/\/>\s*$/.test(m[0])) continue;
    const dir = canonThemeId(htmlAttr(m[0], 'data-direction'));
    if (dir !== want) continue;
    const tag = m[1].toLowerCase();
    const start = m.index;
    let depth = 1;
    const walk = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
    walk.lastIndex = start + m[0].length;
    let t;
    while ((t = walk.exec(s))) {
      if (/^<\//.test(t[0])) {
        depth -= 1;
        if (depth === 0) return s.slice(start, t.index + t[0].length);
      } else if (!/\/>\s*$/.test(t[0])) {
        depth += 1;
      }
    }
    return s.slice(start);
  }
  return '';
}

function sectionForDirection(html, id) {
  return blockForDirection(html, id);
}

function packSlidesByTheme(all, expected) {
  const byDirection = {};
  const pack = expected > 0 && all.length >= expected * 5
    ? CAROUSEL_THEMES.slice(0, 5)
    : (expected > 0 && all.length >= expected * 3
      ? CAROUSEL_THEMES.filter((d) => ['editorial', 'architectural', 'bold-minimal'].includes(d.id))
      : CAROUSEL_THEMES.slice(0, 1));
  pack.forEach((d, i) => {
    byDirection[d.id] = expected
      ? all.slice(i * expected, i * expected + expected)
      : (i === 0 ? all : []);
  });
  const directions = pack.filter((d) => (byDirection[d.id] || []).length);
  return { byDirection, directions };
}

function stylesheetImports(html) {
  return [...String(html || '').matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /rel\s*=\s*["']stylesheet["']/i.test(tag))
    .map((tag) => {
      const href = htmlAttr(tag, 'href');
      if (!href || /^(javascript:|data:)/i.test(href)) return '';
      return `@import url("${href.replace(/["\\]/g, '')}");`;
    })
    .filter(Boolean)
    .join('\n');
}

function parseCarouselDocument(html, expectedCount) {
  const doc = extractHtmlDocument(html);
  const imports = stylesheetImports(doc);
  const styleBlocks = [...doc.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n');
  const styles = [imports ? `<style>${imports}</style>` : '', styleBlocks].filter(Boolean).join('\n');
  let byDirection = {};
  let directions = discoveredThemes(doc);
  const expected = Number(expectedCount) > 0 ? Number(expectedCount) : 0;
  if (directions.length) {
    directions.forEach((d) => {
      byDirection[d.id] = slideArticles(blockForDirection(doc, d.id));
    });
  }
  const themedCount = directions.reduce((n, d) => n + (byDirection[d.id] || []).length, 0);
  // Theme buttons often carry data-direction without wrapping slides; nested
  // preview <section> used to truncate theme blocks. Fall back to a flat pack.
  if (!themedCount) {
    const packed = packSlidesByTheme(slideArticles(doc), expected);
    byDirection = packed.byDirection;
    directions = packed.directions;
  }
  const count = expected
    || Math.max(...directions.map((d) => (byDirection[d.id] || []).length), 0);
  const slides = [];
  for (let i = 1; i <= count; i += 1) {
    const options = [];
    directions.forEach((d, di) => {
      const list = byDirection[d.id] || [];
      const article = list.find((a) => Number(htmlAttr(a, 'data-index')) === i) || list[i - 1];
      if (!article) return;
      // Keep the direction section around the canvas so selectors like
      // `section[data-direction="warm-editorial"] .slide` still match when this
      // fragment is rendered alone in Week View.
      // Prefer the canvas over shared CSS when the combined fragment would exceed
      // MAX_LAYOUT_HTML (slice-from-start used to cut off </article> and drop the slide).
      const canvas = `<section data-direction="${d.id}">${article}</section>`;
      const styleBudget = MAX_LAYOUT_HTML - canvas.length - 8;
      const stylePart = styleBudget > 0 && styles.length > styleBudget
        ? styles.slice(0, styleBudget)
        : styles;
      const piece = extractLayoutHtml(`${stylePart}\n${canvas}`);
      if (!piece) return;
      options.push({
        rank: di + 1,
        label: d.label,
        reason: d.label,
        direction: d.id,
        html: piece,
      });
    });
    if (!options.length) continue;
    slides.push({
      index: i,
      options,
      html: options[0].html,
      reason: options[0].reason,
    });
  }
  return { html: doc, slides };
}

module.exports = {
  MAX_LAYOUT_HTML,
  extractLayoutHtml,
  extractHtmlDocument,
  parseCarouselDocument,
  hasImageSlot,
  shareLayoutStyles,
  collectLayoutStyleBlocks,
  stripDanger,
  sanitizeLayoutCss,
};
