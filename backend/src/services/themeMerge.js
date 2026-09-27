/**
 * One carousel, more than one theme — Editor mode › Themes › This slide.
 *
 * A carousel document can hold several `<section data-direction="…">` blocks;
 * the editor renders each slide from the section its `layoutTheme` names (see
 * frontend layoutHtml.findCarouselSlide), and parseCarouselDocument gives each
 * slide the html of the section that holds it. So giving ONE slide a new theme
 * is: run the carousel agent in that theme, take that slide's article, and move
 * it into a section of its own — every other slide stays where it is.
 *
 * The catch is CSS. The agent writes theme CSS unscoped (`.slide {…}`,
 * `section {…}`), so two themes in one document would fight. Before they meet,
 * each theme's rules are scoped to its own section (`scopeCss`).
 *
 * Invariant kept here: every slide index lives in exactly ONE section.
 */
const { extractHtmlDocument, discoveredThemes, blockForDirection, slideArticles, htmlAttr } = require('./layoutHtml');

const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

// Split a selector list on top-level commas (not the ones inside :is(a, b)).
function splitSelectors(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(list)) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && !depth) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function scopeSelector(sel, scope) {
  const s = sel.trim();
  if (!s) return s;
  if (/\[data-direction\b/i.test(s)) return s; // already about one theme
  const lead = s.match(/^(html|body|:root|section)(?![\w-])/i);
  if (lead) return `${scope}${s.slice(lead[0].length)}`;
  if (s === '*') return `${scope} *`;
  return `${scope} ${s}`;
}

/**
 * Prefix every style rule with `section[data-direction="<dir>"]`. Rules inside
 * @media / @supports / @container / @layer are scoped too; @keyframes,
 * @font-face and @page are left alone.
 */
function scopeCss(css, dir) {
  const scope = `section[data-direction="${String(dir).replace(/"/g, '')}"]`;
  const parts = String(css || '').split(/([{}])/);
  const stack = []; // 'group' | 'raw' | 'rule'
  let out = '';
  let prelude = '';
  parts.forEach((tok) => {
    if (tok === '{') {
      const p = prelude;
      prelude = '';
      const head = p.trim();
      const inRaw = stack.includes('raw');
      if (head.startsWith('@')) {
        stack.push(/^@(media|supports|container|layer|document)\b/i.test(head) && !inRaw ? 'group' : 'raw');
        out += `${p}{`;
        return;
      }
      if (inRaw || stack[stack.length - 1] === 'rule') { stack.push('rule'); out += `${p}{`; return; }
      const lead = p.match(/^\s*/)[0];
      out += `${lead}${splitSelectors(head).map((x) => scopeSelector(x, scope)).join(', ')} {`;
      stack.push('rule');
      return;
    }
    if (tok === '}') {
      out += `${prelude}}`;
      prelude = '';
      stack.pop();
      return;
    }
    prelude += tok;
  });
  return out + prelude;
}

function stylesOf(doc) {
  return [...String(doc || '').matchAll(STYLE_RE)].map((m) => m[1]);
}
function linksOf(doc) {
  return [...String(doc || '').matchAll(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi)].map((m) => m[0]);
}
function indexOf(article) {
  const open = String(article || '').match(/^<[a-z]+\b[^>]*>/i)?.[0] || '';
  return Number(htmlAttr(open, 'data-index')) || 0;
}

// Every direction section that holds slides, with its articles.
function sectionsOf(doc) {
  return discoveredThemes(doc)
    .map((d) => ({ dir: d.id, articles: slideArticles(blockForDirection(doc, d.id)) }))
    .filter((s) => s.articles.length);
}

/** Build a document from { links, css: [string], sections: [{ dir, articles }] }. */
function buildDocument({ links = [], css = [], sections = [] }) {
  const head = [
    '<meta charset="utf-8">',
    ...[...new Set(links)],
    ...css.filter((c) => String(c).trim()).map((c) => `<style>\n${c}\n</style>`),
  ].join('\n');
  const body = sections
    .filter((s) => s.articles.length)
    .map((s) => `<section data-direction="${s.dir}">\n${s.articles.join('\n')}\n</section>`)
    .join('\n');
  return `<!DOCTYPE html>\n<html><head>\n${head}\n</head><body>\n${body}\n</body></html>`;
}

/**
 * Move slide `slideIndex` of `currentDoc` into the theme `newDoc` was written in.
 * @returns {{ html: string, dir: string }} the merged document and the new section's id
 */
function applySlideTheme({ currentDoc, newDoc, slideIndex }) {
  const cur = extractHtmlDocument(String(currentDoc || ''));
  const next = extractHtmlDocument(String(newDoc || ''));
  if (!next) throw new Error('The carousel agent returned no document.');
  const want = Number(slideIndex) || 0;

  const nextSections = sectionsOf(next);
  if (!nextSections.length) throw new Error('The new theme has no slides.');
  const from = nextSections[0];
  const article = from.articles.find((a) => indexOf(a) === want) || from.articles[want - 1];
  if (!article) throw new Error(`The new theme has no slide ${want}.`);

  const curSections = cur ? sectionsOf(cur) : [];
  // a theme the document already holds gets its own id for this slide, so the
  // two sets of CSS (same theme, different run) cannot overwrite each other
  const taken = new Set(curSections.map((s) => s.dir));
  let dir = from.dir;
  for (let k = want; taken.has(dir); k += 1) dir = `${from.dir}-s${k}`;

  // the document's own CSS is scoped once — when it still holds one theme and
  // nothing in it is scoped yet
  const curCssRaw = stylesOf(cur);
  const alreadyScoped = curCssRaw.some((c) => /\[data-direction\b/i.test(c));
  const curCss = curSections.length === 1 && !alreadyScoped
    ? curCssRaw.map((c) => scopeCss(c, curSections[0].dir))
    : curCssRaw;
  const nextCss = stylesOf(next).map((c) => scopeCss(
    c.split(`data-direction="${from.dir}"`).join(`data-direction="${dir}"`),
    dir,
  ));

  const sections = curSections
    .map((s) => ({ dir: s.dir, articles: s.articles.filter((a) => indexOf(a) !== want) }))
    .filter((s) => s.articles.length);
  sections.push({ dir, articles: [article] });
  return {
    html: buildDocument({ links: [...linksOf(cur), ...linksOf(next)], css: [...curCss, ...nextCss], sections }),
    dir,
  };
}

module.exports = { scopeCss, applySlideTheme, buildDocument, sectionsOf, indexOf };
