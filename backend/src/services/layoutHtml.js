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
  if (!/class=["'][^"']*\bslide\b/i.test(s) && !/<article\b/i.test(s)) return '';
  if (s.length > MAX_LAYOUT_HTML) s = s.slice(0, MAX_LAYOUT_HTML);
  return s;
}

module.exports = {
  MAX_LAYOUT_HTML,
  extractLayoutHtml,
  stripDanger,
};
