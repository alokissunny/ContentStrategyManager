/*
 * Carousel layout check — a geometry pass over the carousel agent's HTML,
 * without a browser. It reads the <style> rules, builds each slide's element
 * tree, estimates how every text block wraps (per-character widths × font
 * size, word by word) and flags what a studio would call a broken slide:
 *   - text blocks that overlap each other (the classic: a headline that wraps
 *     to one more line than the agent guessed runs into the copy below it,
 *     because both were pinned with a fixed `top`);
 *   - text running onto the photo without a band/scrim behind it;
 *   - text outside the 7% safe area or off the slide;
 *   - sibling text blocks each pinned with their own absolute `top` (the
 *     pattern that produces overlaps) — reported so the retry stacks them in
 *     one flex column instead.
 * Estimates are deliberately a little generous (wider glyphs) so borderline
 * wraps are caught; everything returned is a plain sentence the carousel
 * agent can act on.
 */

const TEXT_SLOTS = new Set(['title', 'supporting-text', 'subtitle', 'body', 'eyebrow', 'label', 'caption', 'note', 'detail', 'action', 'quote', 'stat', 'index', 'kicker', 'cta']);
const VOID = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'source', 'wbr']);
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'figcaption']);
const SAFE = 0.065; // every letter stays this share of the slide width inside each edge (prompt asks 7%; 0.5% slack)
const WRAP_SAFETY = 1.04;

// the slide being checked — container units (cqw/vw) resolve against it
const SLIDE = { w: 1080, h: 1350 };

// ── CSS ────────────────────────────────────────────────────────────────────
function parseDecls(text) {
  const out = {};
  String(text || '').split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i < 0) return;
    const k = d.slice(0, i).trim().toLowerCase();
    const v = d.slice(i + 1).trim().replace(/\s*!important\s*$/i, '');
    if (k) out[k] = v;
  });
  return out;
}

// Flat rules only (@media / @font-face / @keyframes blocks are skipped).
function parseCss(css) {
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const selector = src.slice(i, open).trim();
    if (selector.startsWith('@')) {
      // skip the whole at-rule block, nested braces included
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth += 1; else if (src[j] === '}') depth -= 1; j += 1; }
      i = j;
      continue;
    }
    const close = src.indexOf('}', open);
    if (close < 0) break;
    const decls = parseDecls(src.slice(open + 1, close));
    selector.split(',').forEach((sel) => {
      const s = sel.trim();
      if (!s || /[:[]/.test(s.replace(/::?(?:first-line|first-letter)/g, ''))) return; // no pseudo/attr selectors
      const last = s.split(/[\s>+~]+/).filter(Boolean).pop() || '';
      const tag = (last.match(/^[a-z][a-z0-9]*/i) || [''])[0].toLowerCase();
      const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (!tag && !classes.length) return;
      rules.push({ tag, classes, decls });
    });
    i = close + 1;
  }
  return rules;
}

// ── HTML → tree ────────────────────────────────────────────────────────────
function attrsOf(s) {
  const out = {};
  const re = /([\w:-]+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ? m[2].replace(/^["']|["']$/g, '') : '';
  return out;
}

const decode = (t) => String(t || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"').replace(/&mdash;/gi, '—').replace(/&ndash;/gi, '–');

function parseTree(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/?([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[3] !== undefined) {
      const t = decode(m[3]);
      if (t.trim() || /\s/.test(t)) cur.children.push({ text: t });
      continue;
    }
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const node = { tag, attrs: attrsOf(m[2] || ''), children: [], parent: cur };
    cur.children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[2] || '')) cur = node;
  }
  return root;
}

const els = (n) => n.children.filter((c) => c.tag);
function textOf(n) {
  if (n.text !== undefined) return n.text;
  if (n.tag === 'br') return '\n';
  if (n.tag === 'style' || n.tag === 'script') return '';
  return n.children.map(textOf).join('');
}
function* walk(n) { for (const c of els(n)) { yield c; yield* walk(c); } }

// ── styles ─────────────────────────────────────────────────────────────────
const INHERITED = ['font-size', 'font-family', 'line-height', 'letter-spacing', 'text-transform', 'font-weight', 'font-style'];

function styleOf(node, rules) {
  if (node._style) return node._style;
  const classes = new Set(String(node.attrs.class || '').split(/\s+/).filter(Boolean));
  const own = {};
  rules.forEach((r) => {
    if (r.tag && r.tag !== node.tag) return;
    if (r.classes.some((c) => !classes.has(c))) return;
    Object.assign(own, r.decls);
  });
  Object.assign(own, parseDecls(node.attrs.style));
  const parent = node.parent && node.parent.tag && node.parent.tag !== '#root' ? styleOf(node.parent, rules) : {};
  const style = { ...own };
  INHERITED.forEach((k) => { if (style[k] === undefined && parent[k] !== undefined) style[k] = parent[k]; });
  node._own = own;
  node._style = style;
  return style;
}

// px from "94px" / "5%" (of `ref`) / "2em" (of `em`) / "clamp(a, b, c)" (b's px, else a)
function px(v, ref = 0, em = 16) {
  const s = String(v ?? '').trim();
  if (!s || s === 'auto' || s === 'none') return null;
  const clamp = s.match(/^clamp\(([^,]+),([^,]+),([^)]+)\)$/i);
  if (clamp) return px(clamp[2], ref, em) ?? px(clamp[1], ref, em);
  const m = s.match(/^(-?[\d.]+)(px|%|em|rem|cqw|vw|cqh|vh)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'px').toLowerCase();
  if (u === 'px') return n;
  if (u === '%') return (n / 100) * ref;
  if (u === 'em') return n * em;
  if (u === 'rem') return n * 16;
  if (u === 'cqw' || u === 'vw') return (n / 100) * SLIDE.w;
  if (u === 'cqh' || u === 'vh') return (n / 100) * SLIDE.h;
  return null;
}

function box4(v, ref) {
  const parts = String(v || '').trim().split(/\s+/).map((p) => px(p, ref) || 0);
  if (!parts.length || String(v || '').trim() === '') return [0, 0, 0, 0];
  const [t, r = t, b = t, l = r] = parts;
  return [t, r, b, l];
}
const pad = (st, ref) => {
  const p = box4(st.padding, ref);
  return {
    t: px(st['padding-top'], ref) ?? p[0], r: px(st['padding-right'], ref) ?? p[1],
    b: px(st['padding-bottom'], ref) ?? p[2], l: px(st['padding-left'], ref) ?? p[3],
  };
};
const margin = (st, ref) => {
  const m = box4(st.margin, ref);
  return { t: px(st['margin-top'], ref) ?? m[0], b: px(st['margin-bottom'], ref) ?? m[2] };
};

// ── text wrapping ──────────────────────────────────────────────────────────
const isSerif = (family) => /serif|fraunces|garamond|playfair|lora|libre|cormorant|dm serif|instrument serif|bodoni|didot|georgia|times|merriweather|prata|spectral|newsreader|gloock|marcellus|crimson|eb /i.test(String(family || ''))
  && !/sans/i.test(String(family || '').split(',')[0]);

function charW(ch, serif) {
  if (ch === ' ') return 0.27;
  if (/[iljtf.,:;'!|ı]/.test(ch)) return 0.3;
  if (/[mwMW@]/.test(ch)) return 0.86;
  if (/[A-Z]/.test(ch)) return serif ? 0.7 : 0.68;
  if (/[0-9]/.test(ch)) return 0.58;
  if (/[—–-]/.test(ch)) return ch === '—' ? 0.9 : 0.4;
  return serif ? 0.52 : 0.55;
}

function measure(word, st, size) {
  const serif = isSerif(st['font-family']);
  const tracking = px(st['letter-spacing'], 0, size) || 0;
  const bold = /bold|[6-9]00/.test(String(st['font-weight'] || '')) ? 1.05 : 1;
  const w = [...word].reduce((a, ch) => a + charW(ch, serif) * size + tracking, 0);
  return w * bold * WRAP_SAFETY;
}

// → { lines, height } for `text` in a box `width` wide
function wrap(text, st, width) {
  const size = px(st['font-size'], 0, 16) || 16;
  const t = /uppercase/i.test(st['text-transform'] || '') ? String(text).toUpperCase() : String(text);
  const lh = String(st['line-height'] || '').trim();
  const lineH = !lh || lh === 'normal' ? size * 1.2 : (/px$/.test(lh) ? parseFloat(lh) : (/%$/.test(lh) ? (parseFloat(lh) / 100) * size : parseFloat(lh) * size));
  const space = measure(' ', st, size);
  let lines = 0;
  t.split('\n').forEach((para) => {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    let cur = 0;
    lines += 1;
    words.forEach((w) => {
      const ww = measure(w, st, size);
      if (cur && cur + space + ww > width) { lines += 1; cur = ww; } else cur += (cur ? space : 0) + ww;
    });
  });
  return { lines, height: lines * lineH, size };
}

// the widest unwrapped line of a text element (for shrink-to-fit boxes)
function naturalWidth(node, st) {
  const size = px(st['font-size'], 0, 16) || 16;
  const t = /uppercase/i.test(st['text-transform'] || '') ? textOf(node).toUpperCase() : textOf(node);
  const p = pad(st, 0);
  return Math.max(0, ...t.split('\n').map((l) => measure(l.trim().replace(/\s+/g, ' '), st, size))) + p.l + p.r;
}

// ── layout estimate ────────────────────────────────────────────────────────
const isAbs = (st) => /absolute|fixed/.test(st.position || '');
const isText = (n) => TEXT_SLOTS.has(String(n.attrs['data-slot'] || '').toLowerCase()) || (TEXT_TAGS.has(n.tag) && textOf(n).trim());
const isImg = (n) => n.tag === 'img' || n.tag === 'picture' || n.tag === 'video' || String(n.attrs['data-slot'] || '').toLowerCase() === 'image';
const labelOf = (n) => {
  const slot = n.attrs['data-slot'];
  const words = textOf(n).replace(/\s+/g, ' ').trim();
  return `${slot ? `the ${slot}` : `the ${n.tag}`}${words ? ` "${words.length > 38 ? `${words.slice(0, 36)}…` : words}"` : ''}`;
};
const hasBg = (st) => {
  const bg = String(st.background || st['background-color'] || st['background-image'] || '').trim();
  return bg && !/^(none|transparent|initial|unset)$/i.test(bg) && !/rgba\([^)]*,\s*0\)/.test(bg);
};

// Height of `node` laid out `width` wide, in flow. null = unknown.
function flowHeight(node, width, rules, depth = 0) {
  const st = styleOf(node, rules);
  const fixed = px(st.height, 0, px(st['font-size']) || 16);
  if (isImg(node)) {
    if (fixed != null) return fixed;
    const ar = String(st['aspect-ratio'] || '').split('/').map(Number);
    if (ar.length === 2 && ar[0] && ar[1]) return (width * ar[1]) / ar[0];
    return 0; // flex-filled / unknown — counted as no height
  }
  if (depth > 12) return fixed;
  const p = pad(st, width);
  const inner = width - p.l - p.r;
  const kids = els(node).filter((c) => !isAbs(styleOf(c, rules)) && !/none/.test(styleOf(c, rules).display || ''));
  const hasOwnText = node.children.some((c) => c.text !== undefined && c.text.trim()) || (!kids.length && isText(node));
  let content = 0;
  if (hasOwnText || (isText(node) && kids.every((k) => ['br', 'em', 'strong', 'span', 'b', 'i', 'u', 'mark', 'a', 'sup', 'sub', 'small'].includes(k.tag)))) {
    content = wrap(textOf(node), st, inner).height;
  } else {
    const row = /flex/.test(st.display || '') && !/column/.test(st['flex-direction'] || '');
    const gap = px(st['row-gap'] ?? st.gap, 0) || 0;
    const hs = kids.map((k) => {
      const kst = styleOf(k, rules);
      const kw = px(kst.width, inner) ?? (row ? inner / Math.max(1, kids.length) : inner);
      const h = flowHeight(k, Math.min(kw, inner), rules, depth + 1);
      const m = margin(kst, inner);
      return h == null ? null : h + m.t + m.b;
    });
    if (hs.some((h) => h == null)) return fixed;
    content = row ? Math.max(0, ...hs) : hs.reduce((a, h) => a + h, 0) + gap * Math.max(0, hs.length - 1);
  }
  const natural = content + p.t + p.b;
  node._natural = natural;
  return fixed != null ? fixed : natural;
}

// An absolutely placed element's box on the slide (W×H). null = can't tell.
function absBox(node, W, H, rules) {
  const st = styleOf(node, rules);
  const em = px(st['font-size']) || 16;
  const inset = String(st.inset || '').trim() ? box4(st.inset, W) : null;
  const left = px(st.left, W, em) ?? (inset ? inset[3] : null);
  const right = px(st.right, W, em) ?? (inset ? inset[1] : null);
  const top = px(st.top, H, em) ?? (inset ? inset[0] : null);
  const bottom = px(st.bottom, H, em) ?? (inset ? inset[2] : null);
  let width = px(st.width, W, em);
  if (width == null && left != null && right != null) width = W - left - right;
  if (width == null) {
    // shrink-to-fit: as wide as its longest line, up to the room it has
    const room = W - (left || 0) - (right || 0);
    const lineW = isText(node) ? naturalWidth(node, st) : null;
    width = lineW != null ? Math.min(room, lineW + 2) : room;
  }
  const x = left != null ? left : (right != null ? W - right - width : 0);
  let height = px(st.height, H, em);
  if (height == null && top != null && bottom != null) height = H - top - bottom;
  const natural = flowHeight(node, width, rules);
  if (height == null) height = natural;
  if (height == null) return null;
  const y = top != null ? top : (bottom != null ? H - bottom - height : null);
  if (y == null) return null;
  return { x, y, w: width, h: height, natural: node._natural ?? natural };
}

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) > 6
  && Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function checkSlide(article, rules, idx) {
  const out = [];
  const sst = styleOf(article, rules);
  const W = px(sst.width) || 1080;
  const H = px(sst.height) || Math.round((W * 5) / 4);
  SLIDE.w = W;
  SLIDE.h = H;
  const n = `Slide ${idx}`;
  const round = (v) => Math.round(v);

  // positioned children of the slide (and of plain wrappers without position)
  const placed = [];
  const collect = (parent) => els(parent).forEach((c) => {
    const st = styleOf(c, rules);
    if (isAbs(st)) placed.push(c);
    else if (!/relative|sticky/.test(st.position || '') && !isText(c) && !isImg(c)) collect(c);
  });
  collect(article);

  const items = placed.map((node) => {
    const b = absBox(node, W, H, rules);
    if (!b) return null;
    const texty = isText(node) || [...walk(node)].some(isText);
    // where the words actually are: a card/panel taller than its content only
    // holds text in its natural height; a left-aligned line shorter than its
    // box ends where the words end
    const st = styleOf(node, rules);
    const tb = { ...b };
    const centred = /flex-end|end|center/.test(`${st['justify-content'] || ''} ${st['align-content'] || ''}`) && /flex|grid/.test(st.display || '');
    if (b.natural != null && b.natural < b.h && !centred) tb.h = b.natural;
    if (isText(node) && !/center|right|end/.test(st['text-align'] || '')) {
      const nw = naturalWidth(node, st);
      if (nw < tb.w) tb.w = nw;
    }
    return { node, box: b, tbox: tb, text: texty && textOf(node).trim().length > 0, img: isImg(node) || (!texty && [...walk(node)].some(isImg)), bg: hasBg(styleOf(node, rules)) };
  }).filter(Boolean);

  // Only text elements pinned on their own (an <h1>/<p> with position:absolute
  // and inline content) are measured — their wrap estimate matches the browser
  // within a few px. Cards, flex groups and flow layouts can't collide this
  // way (their contents push each other) and estimating them is noisy.
  const INLINE = new Set(['br', 'em', 'strong', 'span', 'b', 'i', 'u', 'mark', 'a', 'sup', 'sub', 'small']);
  const texts = items.filter((i) => i.text && isText(i.node) && els(i.node).every((k) => INLINE.has(k.tag)));
  // sibling text blocks each pinned by their own top — the overlap-prone pattern
  const pinned = texts.filter((t) => isText(t.node) && styleOf(t.node, rules).top !== undefined);
  const pinnedNote = pinned.length < 2 ? '' : (`${n}: ${pinned.length} text blocks (${pinned.map((t) => t.node.attrs['data-slot'] || t.node.tag).join(', ')}) are each absolutely positioned with their own fixed top — stack them inside ONE flex-column text group so a line that wraps pushes the rest down.`);
  // text box taller than the height it was given
  texts.forEach((t) => {
    if (t.box.natural != null && t.box.natural > t.box.h + 8) {
      out.push(`${n}: ${labelOf(t.node)} needs about ${round(t.box.natural)}px but its box is ${round(t.box.h)}px tall — its text overflows.`);
    }
  });
  for (let a = 0; a < texts.length; a += 1) {
    for (let b = a + 1; b < texts.length; b += 1) {
      const A = texts[a];
      const B = texts[b];
      if ([...walk(A.node)].includes(B.node) || [...walk(B.node)].includes(A.node)) continue;
      const o = overlap(A.tbox, B.tbox);
      if (o) {
        const [up, down] = A.tbox.y <= B.tbox.y ? [A, B] : [B, A];
        const lines = isText(up.node) ? wrap(textOf(up.node), styleOf(up.node, rules), up.box.w - pad(styleOf(up.node, rules), up.box.w).l - pad(styleOf(up.node, rules), up.box.w).r).lines : 0;
        out.push(`${n}: ${labelOf(up.node)} (${lines ? `wraps to ~${lines} lines, ` : ''}ends near y=${round(up.tbox.y + up.tbox.h)}px) overlaps ${labelOf(down.node)} (starts at y=${round(down.tbox.y)}px) by ~${round(o)}px.`);
      }
    }
  }
  // text on the photo with nothing solid behind it
  const imgs = items.filter((i) => i.img && !i.text);
  const scrims = items.filter((i) => !i.text && !i.img && i.bg);
  texts.forEach((t) => {
    if (t.bg || [...walk(t.node)].some((c) => hasBg(styleOf(c, rules)) && isText(c))) return;
    imgs.forEach((im) => {
      const o = overlap(t.tbox, im.box);
      if (!o || o < 6) return;
      const onScrim = scrims.some((s) => overlap(t.tbox, s.box) >= Math.min(t.tbox.h, o) * 0.9);
      if (!onScrim) out.push(`${n}: ${labelOf(t.node)} runs ~${round(o)}px onto the photo with no solid band behind it — end the text group at least 40px above the photo (or set it on a solid band).`);
    });
  });
  // safe area / off the slide
  texts.forEach((t) => {
    const { x, y, w, h } = t.tbox;
    // 7% of the slide WIDTH on every side (~76px on 1080) — the prompt's rule
    const mx = W * SAFE - 2;
    const my = mx;
    if (x < mx || x + w > W - mx + 1 || y < my || y + h > H - my) {
      const where = [x < mx && 'left', x + w > W - mx + 1 && 'right', y < my && 'top', y + h > H - my && 'bottom'].filter(Boolean).join('/');
      out.push(`${n}: ${labelOf(t.node)} breaks the ${Math.round(SAFE * 100)}% safe area at the ${where} (box ${round(x)},${round(y)} ${round(w)}×${round(h)}px on a ${W}×${H} slide).`);
    }
  });
  // the pinned-tops pattern is only worth a fix where it actually broke the slide
  if (out.length && pinnedNote) out.push(pinnedNote);
  return out;
}

/**
 * @param {string} html  the carousel agent's full document
 * @returns {string[]}   problems, one sentence each (empty = looks clean)
 */
function carouselLayoutProblems(html) {
  const doc = String(html || '');
  if (!doc) return [];
  try {
    const css = [...doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const rules = parseCss(css);
    const tree = parseTree(doc.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, ''));
    const articles = [...walk(tree)].filter((n) => n.tag === 'article' && /\bslide\b/.test(n.attrs.class || ''));
    return articles.flatMap((a, i) => checkSlide(a, rules, Number(a.attrs['data-index']) || i + 1));
  } catch (err) {
    console.warn('[carouselLayoutCheck] could not check the layout:', err.message);
    return [];
  }
}

module.exports = { carouselLayoutProblems, wrap, parseCss };
