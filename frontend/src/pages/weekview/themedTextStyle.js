// How each text block on a Theme Apply picture is SET — read from the slide's
// last saved HTML (the carousel agent's design kept in agentTrace.preTheme),
// not guessed from the picture's pixels. The pixel read takes tape edges,
// paper seams and rules for underlines / strike-throughs; the HTML says
// exactly which words are bold, italic, crossed out or coloured.
//
// `readSlideTextStyles(carouselHtml, direction, index)` renders the document
// off-screen once and returns every text block of that slide as
// { text, style: { bold, italic, underline, strike, color, align }, runs: [{ words, …differs }] }.
// `styleForRegion(blocks, region)` picks the block(s) the region's words come
// from and lays the studio's own redraw marks (`region.applied`) back on top.

import { findCarouselSlide } from './layoutHtml';

const norm = (t) => String(t || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const wordsOf = (t) => norm(t).split(' ').filter(Boolean);

function hexOf(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(String(c || ''));
  if (!m) return '';
  if (m[4] !== undefined && Number(m[4]) < 0.05) return '';
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

// text-decoration is not inherited in the computed value — a line drawn by a
// wrapper still crosses the words, so the wrappers up to the slide are read too
function linesOf(el, stop, win) {
  let underline = false;
  let strike = false;
  for (let n = el; n && n !== stop.parentElement; n = n.parentElement) {
    const d = win.getComputedStyle(n).textDecorationLine || '';
    if (d.includes('underline')) underline = true;
    if (d.includes('line-through')) strike = true;
    if (n === stop) break;
  }
  return { underline, strike };
}

function lookOf(el, stop, win) {
  const cs = win.getComputedStyle(el);
  return {
    bold: (Number(cs.fontWeight) || 400) >= 600,
    italic: cs.fontStyle === 'italic' || cs.fontStyle === 'oblique',
    ...linesOf(el, stop, win),
    color: hexOf(cs.color),
  };
}

const BLOCKISH = /^(block|flex|grid|list-item|table|table-cell|flow-root)$/;

function blocksOf(article, win) {
  const out = [];
  const visit = (el) => {
    const kids = [...el.children];
    const blockKids = kids.filter((k) => BLOCKISH.test(win.getComputedStyle(k).display) && (k.textContent || '').trim());
    const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (own && !blockKids.length && el !== article) {
      const cs = win.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      // a wrapper that holds the whole line (`<h1><span>…</span></h1>`) is
      // where its look is set
      let src = el;
      for (;;) {
        const only = [...src.children].filter((k) => (k.textContent || '').trim());
        if (only.length !== 1 || (only[0].textContent || '').replace(/\s+/g, ' ').trim() !== own) break;
        src = only[0];
      }
      const style = { ...lookOf(src, article, win), align: /center/.test(cs.textAlign) ? 'center' : (/right|end/.test(cs.textAlign) ? 'right' : 'left') };
      const runs = [];
      src.querySelectorAll('*').forEach((k) => {
        const words = (k.textContent || '').replace(/\s+/g, ' ').trim();
        if (!words || words === own) return;
        const l = lookOf(k, article, win);
        const diff = {};
        ['bold', 'italic', 'underline', 'strike'].forEach((f) => { if (l[f] !== style[f]) diff[f] = l[f]; });
        if (l.color && l.color !== style.color) diff.color = l.color;
        const bg = hexOf(win.getComputedStyle(k).backgroundColor);
        if (bg) diff.highlight = bg;
        if (Object.keys(diff).length && !runs.some((r) => r.words === words)) runs.push({ words, ...diff });
      });
      out.push({ text: own, style, runs });
      return;
    }
    blockKids.forEach(visit);
  };
  visit(article);
  return out;
}

const cache = new Map();

/** Every text block of slide `index` (1-based) in `direction`, as the HTML sets it. */
export function readSlideTextStyles(carouselHtml, direction, index) {
  const key = `${direction}|${index}|${carouselHtml.length}|${carouselHtml.slice(0, 64)}`;
  if (cache.has(key)) return cache.get(key);
  const job = new Promise((resolve) => {
    if (!carouselHtml || typeof document === 'undefined') { resolve([]); return; }
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1080px;height:1350px;border:0;visibility:hidden;pointer-events:none;';
    let done = false;
    const finish = (list) => {
      if (done) return;
      done = true;
      resolve(list);
      frame.remove();
    };
    frame.onload = () => {
      try {
        const doc = frame.contentDocument;
        const article = findCarouselSlide(doc, direction, index);
        finish(article ? blocksOf(article, frame.contentWindow) : []);
      } catch {
        finish([]);
      }
    };
    setTimeout(() => finish([]), 8000);
    // scripts off: only the styles matter
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.srcdoc = carouselHtml;
    document.body.appendChild(frame);
  });
  cache.set(key, job);
  return job;
}

const overlap = (a, b) => {
  const A = wordsOf(a);
  const B = new Set(wordsOf(b));
  if (!A.length || !B.size) return 0;
  const hit = A.filter((w) => B.has(w)).length;
  return hit / Math.max(A.length, B.size);
};

const MARK_FIELD = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strike' };
const MARK_ALIGN = { alignl: 'left', alignc: 'center', alignr: 'right' };

// the studio's own redraw marks, laid over the HTML's look (as the server's
// restyleRegion lays them over the map's)
function withApplied(look, region) {
  const style = { ...look.style };
  let runs = look.runs.filter((r) => String(region.text || '').includes(r.words)).map((r) => ({ ...r }));
  (Array.isArray(region.applied) ? region.applied : []).forEach((m) => {
    if (MARK_ALIGN[m.id]) { style.align = MARK_ALIGN[m.id]; return; }
    const field = MARK_FIELD[m.id] || (/^hl-/.test(m.id) ? 'highlight' : (['ink', 'accent', 'ground'].includes(m.id) ? 'color' : ''));
    if (!field) return;
    const value = field === 'color' || field === 'highlight' ? (m.off ? '' : (m.hex || '')) : !m.off;
    if (!m.words) {
      style[field] = value;
      runs = runs.map((r) => { const { [field]: _drop, ...rest } = r; return rest; }).filter((r) => Object.keys(r).length > 1);
    } else {
      const at = runs.find((r) => r.words === m.words);
      if (at) at[field] = value; else runs.push({ words: m.words, [field]: value });
    }
  });
  return { style, runs };
}

/**
 * The look of `region` from the slide's HTML blocks, or null when its words
 * can't be found there (the map's own read is used then). A region the map
 * merged from several blocks (a two-line headline set as two elements) takes
 * the first block's look and every block's runs.
 */
export function styleForRegion(blocks, region) {
  if (!Array.isArray(blocks) || !blocks.length || !region?.text) return null;
  const scored = blocks.map((b) => ({ b, s: overlap(b.text, region.text) }));
  const best = scored.reduce((a, c) => (c.s > a.s ? c : a), scored[0]);
  let look = null;
  if (best.s >= 0.5) look = { style: best.b.style, runs: best.b.runs };
  else {
    const inside = blocks.filter((b) => wordsOf(b.text).length && overlap(b.text, region.text) > 0
      && wordsOf(b.text).every((w) => wordsOf(region.text).includes(w)));
    const covered = inside.reduce((n, b) => n + wordsOf(b.text).length, 0);
    if (!inside.length || covered / wordsOf(region.text).length < 0.5) return null;
    look = { style: inside[0].style, runs: inside.flatMap((b) => b.runs) };
  }
  return withApplied(look, region);
}
