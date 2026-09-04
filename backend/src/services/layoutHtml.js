const MAX_LAYOUT_HTML = 24000;

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
  return /<img\b[^>]*data-slot\s*=\s*["']image["']/i.test(String(html || ''));
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

// Agent sometimes emits one shared <style> on slide 1 only. Each slide is stored
// and rendered alone — copy every style block onto slides that have none.
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

module.exports = {
  MAX_LAYOUT_HTML,
  extractLayoutHtml,
  hasImageSlot,
  shareLayoutStyles,
  collectLayoutStyleBlocks,
  stripDanger,
  sanitizeLayoutCss,
};
