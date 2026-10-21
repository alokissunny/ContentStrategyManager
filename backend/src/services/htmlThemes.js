/**
 * HTML themes (experimental) — Editor ⋯ › Theme › HTML themes.
 *
 * Fixed 1080 × 1350 HTML templates, modelled on the layouts that recur in
 * Canva's interior-design Instagram templates (photo with a caps label box,
 * diamond split, circle services column, script + serif boho, torn-paper
 * header, elegant split, framed collage, curved photo on concrete, wave
 * services, mood board, inspiration collage …). They are our own builds of
 * those arrangements — not copies of any one template's artwork or copy.
 *
 * Applying one is deterministic (no model call): the slide's own text runs
 * (by `data-slot`) and pictures are poured into the template.
 *  - Every text run is kept once, with its `data-slot` and inner html; the
 *    template decides font, size (fitted to the words), colour and place.
 *  - Pictures fill the template's photo frames in order. A frame with no
 *    picture gets an empty `<img data-slot="image">` placeholder, which the
 *    studio fills later (Content › Image binds pictures to slots in order).
 *  - The root `<article>` keeps its attributes; it gets `data-html-theme`.
 * Everything is inline-styled, and nothing below the root keeps a class (the
 * old look's CSS — e.g. `.photo { position:absolute … }` — must not reach in).
 *
 * Fonts: HTML_THEME_FONTS_URL is loaded into any slide frame holding an
 * HTML-themed slide (frontend DynamicLayout).
 */

const HTML_THEME_FONTS_URL = 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Great+Vibes&family=Italiana&family=Jost:wght@300;400;500;600&family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,500&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap';

// ── families + the rough width of one character, as a share of font size ──
const F = {
  pf: { fam: "'Playfair Display', Georgia, serif", w: 0.53 },
  bd: { fam: "'Bodoni Moda', Georgia, serif", w: 0.55 },
  cg: { fam: "'Cormorant Garamond', Georgia, serif", w: 0.46 },
  ms: { fam: "'Montserrat', 'Inter', system-ui, sans-serif", w: 0.6 },
  jo: { fam: "'Jost', 'Inter', system-ui, sans-serif", w: 0.5 },
  gv: { fam: "'Great Vibes', cursive", w: 0.4 },
};

// ── reading the slide ─────────────────────────────────────────────────────
const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base', 'embed', 'param', 'track']);
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'span', 'blockquote', 'figcaption', 'small', 'strong', 'em', 'a', 'div', 'b', 'i', 'label', 'cite', 'q', 'dt', 'dd']);
const attr = (tag, name) => {
  const m = String(tag || '').match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
};
const escAttr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const plainOf = (html) => String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/gi, 'x').replace(/\s+/g, ' ').trim();

// a tiny tag tree — enough to find each text run and picture once
function parse(html) {
  const root = { tag: '#root', open: '', kids: [], start: 0, innerStart: 0, end: html.length, innerEnd: html.length };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/g;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[0];
    if (raw.startsWith('<!--')) continue;
    const tag = m[1].toLowerCase();
    if (raw.startsWith('</')) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at <= 0) continue;
      // anything left open inside closes here too
      while (stack.length - 1 > at) {
        const n = stack.pop();
        n.innerEnd = m.index;
        n.end = m.index;
      }
      const n = stack.pop();
      n.innerEnd = m.index;
      n.end = m.index + raw.length;
      continue;
    }
    const node = { tag, open: raw, kids: [], start: m.index, innerStart: m.index + raw.length, end: m.index + raw.length, innerEnd: m.index + raw.length };
    stack[stack.length - 1].kids.push(node);
    if (!VOID.has(tag) && !raw.endsWith('/>')) stack.push(node);
  }
  return root;
}

// inner html of a run, with the old look's classes/styles taken off its children
function cleanInner(html) {
  let out = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta)\b[\s\S]*?(?:<\/\1>|\/?>)/gi, '');
  for (let k = 0; k < 4; k += 1) out = out.replace(/(<[a-z][a-z0-9-]*\b[^>]*?)\s(?:class|style|on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '$1');
  return out.trim();
}

function readSlide(article) {
  const src = String(article || '');
  const tree = parse(src);
  const art = tree.kids.find((n) => n.tag === 'article') || tree.kids[0] || tree;
  const runs = [];
  const imgs = [];
  const walk = (node) => {
    node.kids.forEach((n) => {
      if (n.tag === 'img') {
        const slot = attr(n.open, 'data-slot');
        if (slot && !/^(image|illustration|photo)$/i.test(slot)) return; // a logo or mark, not the slide's photo
        imgs.push({
          key: attr(n.open, 'data-asset-key'),
          src: attr(n.open, 'src'),
          alt: attr(n.open, 'alt'),
          focus: attr(n.open, 'data-focus'),
        });
        return;
      }
      if (['script', 'style', 'svg', 'template'].includes(n.tag)) return;
      if (attr(n.open, 'aria-hidden') === 'true') return;
      const slot = attr(n.open, 'data-slot');
      const inner = src.slice(n.innerStart, n.innerEnd);
      if (slot && !/^(image|illustration|photo|logo|mark)$/i.test(slot)) {
        const html = cleanInner(inner.replace(/<img\b[^>]*>/gi, ''));
        // pictures inside a text run still count as the slide's pictures
        walk({ kids: n.kids.filter((k) => k.tag === 'img') });
        if (plainOf(html)) runs.push({ slot, tag: n.tag, html, text: plainOf(html) });
        return;
      }
      // text the carousel left without a slot (rare) — kept as plain text
      const direct = inner.replace(/<[a-z][\s\S]*?<\/[a-z0-9]+>|<[^>]+>/gi, '');
      if (TEXT_TAGS.has(n.tag) && plainOf(direct) && !n.kids.some((k) => attr(k.open, 'data-slot'))) {
        const html = cleanInner(inner.replace(/<img\b[^>]*>/gi, ''));
        walk({ kids: n.kids.filter((k) => k.tag === 'img') });
        if (plainOf(html)) runs.push({ slot: 'text', tag: n.tag, html, text: plainOf(html) });
        return;
      }
      walk(n);
    });
  };
  walk(art);
  // the same picture twice (a blurred copy, a duplicate) is one picture
  const seen = new Set();
  const pictures = imgs.filter((p) => {
    const id = p.key || p.src;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { open: src.slice(art.start, art.innerStart), runs, pictures };
}

// A Theme Apply picture's words may have been re-lettered in the Editor (its
// themeRegions.texts) after the html under it was saved. Put each region's
// current words onto the run in that html they came from — matched by word
// overlap, each run used once, changed runs only.
const wordsOf = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
function similarity(a, b) {
  const A = new Set(wordsOf(a));
  const Bs = new Set(wordsOf(b));
  if (!A.size || !Bs.size) return 0;
  let both = 0;
  A.forEach((w) => { if (Bs.has(w)) both += 1; });
  return both / Math.max(A.size, Bs.size);
}
function withRegionWords(article, texts) {
  const list = (Array.isArray(texts) ? texts : []).filter((t) => String(t?.text || '').trim());
  if (!list.length) return article;
  const src = String(article || '');
  const nodes = [];
  const walk = (node) => node.kids.forEach((n) => {
    const slot = attr(n.open, 'data-slot');
    if (n.tag !== 'img' && slot && !/^(image|illustration|photo|logo|mark)$/i.test(slot)) {
      const text = plainOf(src.slice(n.innerStart, n.innerEnd));
      if (text) { nodes.push({ n, text }); return; }
    }
    walk(n);
  });
  walk(parse(src));
  const used = new Set();
  const edits = [];
  list.forEach((t) => {
    const want = String(t.text).replace(/\s+/g, ' ').trim();
    let best = null;
    let score = 0.45;
    nodes.forEach((x, k) => {
      if (used.has(k)) return;
      const sc = similarity(want, x.text);
      if (sc > score) { score = sc; best = k; }
    });
    if (best == null) return;
    used.add(best);
    if (nodes[best].text === want) return;
    edits.push({ from: nodes[best].n.innerStart, to: nodes[best].n.innerEnd, html: escAttr(want).replace(/&quot;/g, '"') });
  });
  return edits.sort((a, b) => b.from - a.from)
    .reduce((acc, e) => acc.slice(0, e.from) + e.html + acc.slice(e.to), src);
}

// which run plays which part in a template
function roles(runs) {
  const left = runs.slice();
  const take = (re) => {
    const i = left.findIndex((r) => re.test(r.slot));
    return i >= 0 ? left.splice(i, 1)[0] : null;
  };
  const title = take(/title|headline|heading|hook|quote|stat|statement|display/i) || left.shift() || null;
  const eyebrow = take(/eyebrow|kicker|label|index|category|tag|overline|section|series|number|step/i);
  const cta = take(/action|cta|button|link|swipe|save/i);
  const body = take(/body|support|text|caption|subtitle|subhead|description|copy|paragraph|lede|deck|detail|point|note/i) || left.shift() || null;
  return { title, eyebrow, cta, body, extras: left };
}

// ── sizing: the biggest size whose lines fit the box ─────────────────────
function fit(run, { w, h, max, min = 18, font = F.ms, lh = 1.1, caps = false, track = 0 }) {
  const words = String(run?.text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return max;
  for (let s = max; s > min; s -= 2) {
    const cw = s * (font.w * (caps ? 1.16 : 1) + track);
    const per = Math.max(1, Math.floor(w / cw));
    if (words.some((x) => x.length > per)) continue;
    let lines = 1;
    let cur = 0;
    words.forEach((x) => {
      if (!cur) cur = x.length;
      else if (cur + 1 + x.length <= per) cur += 1 + x.length;
      else { lines += 1; cur = x.length; }
    });
    if (lines * s * lh <= h) return s;
  }
  return min;
}

// ── building blocks ──────────────────────────────────────────────────────
const RESET = 'position:relative;inset:auto;transform:none;float:none;width:auto;max-width:none;height:auto;min-height:0;max-height:none;margin:0;padding:0;box-sizing:border-box;display:block;background:none;border:0;opacity:1;white-space:normal;overflow:visible;text-shadow:none;';
const BLOCK_IN = /<(div|p|ul|ol|li|h[1-6]|section|figure|blockquote|table)\b/i;
function tagFor(run) {
  if (/^h[1-6]$/.test(run.tag)) return run.tag;
  return BLOCK_IN.test(run.html) ? 'div' : 'p';
}
const type = (font, size, more = '') => `font-family:${font.fam};font-size:${size}px;${more}`;
function T(run, style) {
  if (!run) return '';
  const tag = tagFor(run);
  return `<${tag} data-slot="${escAttr(run.slot)}" style="${RESET}${style}">${run.html}</${tag}>`;
}
// a headline whose last word is set in a script face (boho / services looks)
function scriptTitle(run, { serif, size, script = F.gv, scriptSize, color, more = '' }) {
  if (!run) return '';
  const words = run.text.split(/\s+/);
  if (/<[a-z]/i.test(run.html) || words.length < 2 || words.length > 5) {
    return T(run, `${type(serif, size, more)}color:${color};`);
  }
  const tag = tagFor(run);
  const last = words.pop();
  return `<${tag} data-slot="${escAttr(run.slot)}" style="${RESET}${type(serif, size, more)}color:${color};">`
    + `<span style="display:block;">${escAttr(words.join(' '))}</span> `
    + `<span style="display:block;font-family:${script.fam};font-size:${scriptSize}px;font-weight:400;text-transform:none;letter-spacing:0;line-height:1;margin-top:-0.08em;">${escAttr(last)}</span></${tag}>`;
}
const box = (style, inner = '') => `<div style="${RESET}${style}">${inner}</div>`;
const deco = (style, inner = '') => `<div aria-hidden="true" style="${RESET}pointer-events:none;${style}">${inner}</div>`;
const abs = (l, t, w, h) => `position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;`;
const PLACEHOLDER_BG = 'background:repeating-linear-gradient(135deg,#D9D2C8 0 16px,#D1C9BE 16px 32px);';
function focusPos(focus) {
  const [x, y, w, h] = String(focus || '').split(/[\s,]+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return '';
  return `object-position:${Math.round(x + w / 2)}% ${Math.round(y + h / 2)}%;`;
}
function imgTag(p) {
  const style = `display:block;position:static;width:100%;height:100%;max-width:none;margin:0;padding:0;border:0;object-fit:cover;${p ? focusPos(p.focus) : ''}`;
  if (!p) return `<img data-slot="image" alt="" data-placeholder="1" style="${style}${PLACEHOLDER_BG}">`;
  const bits = [
    'data-slot="image"',
    p.key ? `data-asset-key="${escAttr(p.key)}"` : '',
    p.src ? `src="${escAttr(p.src)}"` : '',
    `alt="${escAttr(p.alt)}"`,
    p.focus ? `data-focus="${escAttr(p.focus)}"` : '',
  ].filter(Boolean).join(' ');
  return `<img ${bits} style="${style}">`;
}
const pic = (c, i, frame) => `<div style="${RESET}overflow:hidden;${PLACEHOLDER_BG}${frame}">${imgTag(c.pics[i])}</div>`;
const extrasOf = (c, style) => c.extras.map((r) => T(r, style)).join('');
// an absolutely placed text run (no RESET position)
const At = (run, place, style) => (run ? T(run, style).replace('position:relative;inset:auto;', place) : '');

// a torn-paper top edge / a wave bottom edge, as clip-path polygons
function tornTop(depth = 26, step = 36) {
  const pts = [];
  for (let x = 0, k = 0; x <= 1080; x += step, k += 1) pts.push(`${x}px ${Math.round((((k * 7919) % 13) / 12) * depth)}px`);
  return `clip-path:polygon(${pts.join(',')},1080px 100%,0 100%);`;
}
function waveBottom(h, amp = 34, waves = 1.5) {
  const pts = ['0 0', '1080px 0'];
  for (let x = 1080; x >= 0; x -= 30) pts.push(`${x}px ${Math.round(h - amp - amp * Math.sin((x / 1080) * Math.PI * 2 * waves))}px`);
  return `clip-path:polygon(${pts.join(',')});`;
}

// ── the templates ─────────────────────────────────────────────────────────
// Each: build(c) → { bg, inner }. `c` = { title, eyebrow, body, cta, extras, pics }.
const TEMPLATES = [
  {
    id: 'classic-overlay',
    name: 'Classic Overlay',
    note: 'Full photo, caps serif title in a soft box, framed inset',
    photos: 2,
    build: (c) => ({
      bg: '#CFC8BF',
      inner: [
        pic(c, 0, abs(0, 0, 1080, 1350)),
        box('position:absolute;left:64px;top:80px;width:660px;background:rgba(246,243,239,0.92);padding:44px 48px;display:flex;flex-direction:column;gap:18px;', [
          T(c.eyebrow, `${type(F.ms, 20, 'font-weight:500;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#6A625A;`),
          T(c.title, `${type(F.bd, fit(c.title, { w: 564, h: 330, max: 100, min: 46, font: F.bd, caps: true, lh: 1.04 }), 'font-weight:500;text-transform:uppercase;letter-spacing:0.01em;line-height:1.04;')}color:#34302B;`),
          T(c.body, `${type(F.ms, fit(c.body, { w: 564, h: 210, max: 30, min: 22, lh: 1.45 }), 'font-weight:400;line-height:1.45;')}color:#4A443E;`),
          extrasOf(c, `${type(F.ms, 22, 'line-height:1.45;')}color:#4A443E;`),
        ].join('')),
        pic(c, 1, `${abs(1080 - 64 - 340, 1350 - 96 - 420, 340, 420)}border:10px solid #FFFFFF;`),
        c.cta ? box('position:absolute;left:64px;bottom:96px;background:#FFFFFF;padding:18px 30px;', T(c.cta, `${type(F.ms, 22, 'font-weight:600;letter-spacing:0.16em;text-transform:uppercase;line-height:1.2;')}color:#2E2A26;`)) : '',
      ].join(''),
    }),
  },
  {
    id: 'framed-feature',
    name: 'Framed Feature',
    note: 'Big photo, white outline frame, caps label box, caption band',
    photos: 1,
    build: (c) => ({
      bg: '#8B857D',
      inner: [
        pic(c, 0, abs(0, 0, 1080, 1000)),
        deco(`${abs(150, 140, 780, 1010)}border:3px solid rgba(255,255,255,0.92);`),
        At(c.eyebrow, 'position:absolute;left:72px;top:64px;', `${type(F.ms, 20, 'font-weight:500;letter-spacing:0.12em;line-height:1.3;')}color:#FFFFFF;`),
        c.title ? box('position:absolute;left:110px;bottom:300px;width:560px;background:#FFFFFF;padding:30px 40px;', T(c.title, `${type(F.ms, fit(c.title, { w: 480, h: 250, max: 72, min: 38, caps: true, lh: 1.08 }), 'font-weight:700;text-transform:uppercase;letter-spacing:0.02em;line-height:1.08;')}color:#262626;`)) : '',
        box('position:absolute;left:140px;right:140px;top:1080px;bottom:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;', [
          T(c.body, `${type(F.ms, fit(c.body, { w: 800, h: 150, max: 28, min: 19, lh: 1.45 }), 'line-height:1.45;')}color:#FFFFFF;`),
          extrasOf(c, `${type(F.ms, 20, 'line-height:1.4;')}color:#F1EEEA;`),
          T(c.cta, `${type(F.ms, 20, 'font-weight:600;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#FFFFFF;border-bottom:2px solid #FFFFFF;padding-bottom:4px;`),
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'diamond-split',
    name: 'Diamond Split',
    note: 'Serif title column, tall photo, diamond-cut inset',
    photos: 2,
    build: (c) => ({
      bg: '#F1ECE4',
      inner: [
        pic(c, 0, abs(580, 0, 500, 800)),
        deco(`${abs(326, 546, 368, 368)}border:2px solid #C9B9A6;transform:rotate(45deg);`),
        pic(c, 1, `${abs(300, 520, 420, 420)}clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);`),
        box('position:absolute;left:72px;top:110px;width:440px;display:flex;flex-direction:column;gap:22px;', [
          T(c.eyebrow, `${type(F.ms, 20, 'font-weight:500;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#8A7F73;`),
          T(c.title, `${type(F.pf, fit(c.title, { w: 440, h: 300, max: 100, min: 46, font: F.pf, lh: 1.05 }), 'font-weight:600;line-height:1.05;')}color:#3E3A36;`),
          deco('width:70px;height:6px;background:#3E3A36;'),
        ].join('')),
        box('position:absolute;left:72px;bottom:80px;width:430px;display:flex;flex-direction:column;justify-content:flex-end;gap:14px;', [
          T(c.body, `${type(F.ms, fit(c.body, { w: 430, h: 250, max: 26, min: 19, lh: 1.5 }), 'line-height:1.5;')}color:#5B544D;`),
        ].join('')),
        box('position:absolute;right:72px;bottom:80px;width:290px;display:flex;flex-direction:column;gap:12px;', [
          T(c.cta, `${type(F.ms, fit(c.cta, { w: 290, h: 100, max: 28, min: 20, lh: 1.25 }), 'font-weight:700;line-height:1.25;')}color:#3E3A36;`),
          extrasOf(c, `${type(F.ms, 20, 'line-height:1.45;')}color:#5B544D;`),
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'circle-services',
    name: 'Circle Services',
    note: 'Bold title, icon list, three round photos on a curved band',
    photos: 3,
    build: (c) => ({
      bg: '#FFFFFF',
      inner: [
        deco(`${abs(720, 0, 360, 1350)}background:#8C7357;border-radius:220px 0 0 220px;`),
        ...[120, 530, 940].map((top, i) => pic(c, i, `${abs(718, top, 290, 290)}border-radius:50%;border:10px solid #FFFFFF;`)),
        box('position:absolute;left:72px;top:90px;bottom:90px;width:590px;display:flex;flex-direction:column;justify-content:center;gap:26px;', [
          T(c.eyebrow, `${type(F.ms, 20, 'font-weight:600;letter-spacing:0.18em;text-transform:uppercase;line-height:1.3;')}color:#8C7357;`),
          T(c.title, `${type(F.ms, fit(c.title, { w: 580, h: 320, max: 108, min: 50, lh: 1.02 }), 'font-weight:800;line-height:1.02;letter-spacing:-0.01em;')}color:#1F1F1F;`),
          T(c.body, `${type(F.ms, fit(c.body, { w: 570, h: 200, max: 32, min: 21, lh: 1.35 }), 'font-style:italic;font-weight:500;line-height:1.35;')}color:#3A3A3A;`),
          c.extras.map((r) => box('display:flex;align-items:center;gap:22px;', deco('flex:none;width:56px;height:56px;border-radius:50%;background:#2B2B2B;display:flex;align-items:center;justify-content:center;', deco('width:16px;height:16px;border-radius:50%;background:#FFFFFF;')) + T(r, `${type(F.ms, 24, 'font-weight:600;line-height:1.25;')}color:#2B2B2B;`))).join(''),
          c.cta ? box('align-self:flex-start;border:3px solid #1F1F1F;padding:14px 26px;', T(c.cta, `${type(F.ms, 22, 'font-weight:800;letter-spacing:0.06em;text-transform:uppercase;line-height:1.2;')}color:#1F1F1F;`)) : '',
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'modern-boho',
    name: 'Modern Boho',
    note: 'Toned full photo, serif + script title in a thin frame',
    photos: 1,
    build: (c) => {
      const size = fit(c.title, { w: 800, h: 250, max: 136, min: 56, font: F.pf, lh: 1 });
      return {
        bg: '#3A2F28',
        inner: [
          pic(c, 0, abs(0, 0, 1080, 1350)),
          deco(`${abs(0, 0, 1080, 1350)}background:rgba(35,27,22,0.5);`),
          deco(`${abs(70, 70, 940, 1210)}border:2px solid rgba(255,255,255,0.75);`),
          box('position:absolute;left:130px;right:130px;top:130px;bottom:130px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;text-align:center;', [
            T(c.eyebrow, `${type(F.gv, 50, 'line-height:1.1;')}color:#FFFFFF;`),
            scriptTitle(c.title, { serif: F.pf, size, scriptSize: Math.min(180, Math.round(size * 1.25)), color: '#FFFFFF', more: 'font-weight:500;line-height:1;' }),
            T(c.body, `${type(F.ms, fit(c.body, { w: 640, h: 220, max: 30, min: 21, lh: 1.5 }), 'line-height:1.5;')}color:#FFFFFF;max-width:660px;`),
            extrasOf(c, `${type(F.ms, 20, 'letter-spacing:0.22em;text-transform:uppercase;line-height:1.5;')}color:#F3ECE4;`),
            T(c.cta, `${type(F.ms, 20, 'font-weight:600;letter-spacing:0.25em;text-transform:uppercase;line-height:1.3;')}color:#FFFFFF;border-top:1px solid rgba(255,255,255,0.7);padding-top:14px;`),
          ].join('')),
        ].join(''),
      };
    },
  },
  {
    id: 'torn-paper',
    name: 'Torn Paper',
    note: 'Script + caps serif header over a torn-edge photo, swatches',
    photos: 1,
    build: (c) => {
      const hasPanel = c.body || c.extras.length || c.cta;
      return {
        bg: '#FBF8F2',
        inner: [
          box('position:absolute;left:72px;right:72px;top:60px;height:310px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;', [
            T(c.eyebrow, `${type(F.gv, 58, 'line-height:1.1;')}color:#3B3530;`),
            T(c.title, `${type(F.cg, fit(c.title, { w: 936, h: c.eyebrow ? 200 : 260, max: 96, min: 42, font: F.cg, caps: true, track: 0.08, lh: 1.05 }), 'font-weight:500;text-transform:uppercase;letter-spacing:0.08em;line-height:1.05;')}color:#3B3530;`),
          ].join('')),
          pic(c, 0, `${abs(0, 380, 1080, 970)}${tornTop()}`),
          box('position:absolute;right:90px;top:540px;display:flex;flex-direction:column;gap:22px;', ['#D2BFA6', '#A78A6A', '#5E4B3B'].map((hex) => deco(`width:96px;height:96px;border-radius:50%;background:${hex};border:4px solid #FBF8F2;`)).join('')),
          hasPanel ? box('position:absolute;left:72px;right:72px;bottom:64px;background:rgba(251,248,242,0.94);padding:30px 40px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;', [
            T(c.body, `${type(F.ms, fit(c.body, { w: 856, h: 170, max: 28, min: 20, lh: 1.45 }), 'line-height:1.45;')}color:#3B3530;`),
            extrasOf(c, `${type(F.ms, 20, 'line-height:1.45;')}color:#5A514A;`),
            T(c.cta, `${type(F.ms, 20, 'font-weight:600;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#3B3530;`),
          ].join('')) : '',
        ].join(''),
      };
    },
  },
  {
    id: 'elegant-split',
    name: 'Elegant Split',
    note: 'Spaced caps serif column, palette dots, two stacked photos',
    photos: 2,
    build: (c) => ({
      bg: '#F1EAE0',
      inner: [
        pic(c, 0, abs(500, 0, 580, 665)),
        pic(c, 1, abs(500, 685, 580, 665)),
        box('position:absolute;left:50px;top:70px;bottom:70px;width:410px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px;text-align:center;', [
          T(c.eyebrow, `${type(F.ms, 18, 'font-weight:500;letter-spacing:0.3em;text-transform:uppercase;line-height:1.4;')}color:#7D6A58;`),
          T(c.title, `${type(F.cg, fit(c.title, { w: 400, h: 380, max: 80, min: 36, font: F.cg, caps: true, track: 0.12, lh: 1.08 }), 'font-weight:600;text-transform:uppercase;letter-spacing:0.12em;line-height:1.08;')}color:#7A5A3F;`),
          deco('width:90px;height:1px;background:#7A5A3F;'),
          T(c.body, `${type(F.cg, fit(c.body, { w: 390, h: 250, max: 32, min: 22, font: F.cg, lh: 1.35 }), 'font-style:italic;line-height:1.35;')}color:#6B5A4B;`),
          deco('display:flex;gap:12px;', ['#4A3B30', '#7A5A3F', '#A88B6C', '#CDB89C', '#E4D6C3'].map((hex) => `<span style="display:block;width:26px;height:26px;border-radius:50%;background:${hex};"></span>`).join('')),
          extrasOf(c, `${type(F.ms, 18, 'line-height:1.5;')}color:#6B5A4B;`),
          c.cta ? box('background:#3A2E26;padding:12px 26px;', T(c.cta, `${type(F.ms, 16, 'font-weight:600;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#F1EAE0;`)) : '',
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'warm-collage',
    name: 'Warm Collage',
    note: 'Framed photo collage with a brown story card',
    photos: 2,
    build: (c) => ({
      bg: 'radial-gradient(circle at 30% 20%, #E6DBCD, #CDBDA9)',
      inner: [
        pic(c, 0, `${abs(80, 90, 920, 560)}border:12px solid #F5EFE7;`),
        pic(c, 1, `${abs(80, 680, 450, 580)}border:12px solid #F5EFE7;`),
        box(`${abs(550, 680, 450, 580)}background:#8B6A4F;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center;`, [
          T(c.eyebrow, `${type(F.ms, 18, 'font-weight:500;letter-spacing:0.25em;text-transform:uppercase;line-height:1.4;')}color:#EADBC8;`),
          T(c.title, `${type(F.cg, fit(c.title, { w: 370, h: 250, max: 62, min: 32, font: F.cg, lh: 1.1 }), 'font-weight:500;line-height:1.1;')}color:#F5EFE7;`),
          T(c.body, `${type(F.ms, fit(c.body, { w: 370, h: 170, max: 24, min: 17, lh: 1.45 }), 'line-height:1.45;')}color:#F5EFE7;`),
          extrasOf(c, `${type(F.ms, 17, 'line-height:1.45;')}color:#EADBC8;`),
          T(c.cta, `${type(F.ms, 17, 'font-weight:600;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#F5EFE7;border-bottom:1px solid #F5EFE7;padding-bottom:4px;`),
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'curve-concrete',
    name: 'Curve & Concrete',
    note: 'Photo with a curved base on concrete, light sans wordmark',
    photos: 1,
    build: (c) => ({
      bg: '#E2E0DC radial-gradient(rgba(0,0,0,0.045) 1px, transparent 1.6px) 0 0 / 7px 7px',
      inner: [
        pic(c, 0, `${abs(0, 0, 1080, 900)}border-radius:0 0 50% 50% / 0 0 170px 170px;`),
        c.cta ? box('position:absolute;right:72px;top:852px;background:#111111;padding:10px 18px;', T(c.cta, `${type(F.ms, 18, 'font-weight:700;letter-spacing:0.12em;text-transform:uppercase;line-height:1.2;')}color:#FFFFFF;`)) : '',
        box('position:absolute;left:72px;right:72px;top:950px;bottom:60px;display:flex;align-items:center;gap:40px;', [
          box('flex:0 0 380px;display:flex;flex-direction:column;gap:12px;', [
            T(c.body, `${type(F.ms, fit(c.body, { w: 380, h: 280, max: 26, min: 18, lh: 1.45 }), 'line-height:1.45;')}color:#3A3A3A;`),
            extrasOf(c, `${type(F.ms, 18, 'line-height:1.45;')}color:#3A3A3A;`),
          ].join('')),
          deco('flex:none;width:2px;height:240px;background:#3A3A3A;'),
          box('flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-end;gap:10px;text-align:right;', [
            T(c.title, `${type(F.jo, fit(c.title, { w: 480, h: 230, max: 108, min: 42, font: F.jo, lh: 1 }), 'font-weight:300;line-height:1;')}color:#3A3A3A;`),
            T(c.eyebrow, `${type(F.jo, 24, 'font-weight:400;letter-spacing:0.45em;text-transform:uppercase;line-height:1.3;')}color:#3A3A3A;`),
          ].join('')),
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'wave-services',
    name: 'Wave Services',
    note: 'Wave-cut photo, bold + script title, round photo column',
    photos: 4,
    build: (c) => {
      const size = fit(c.title, { w: 540, h: 240, max: 92, min: 46, lh: 1.05 });
      return {
        bg: '#6E4E3A',
        inner: [
          pic(c, 0, `${abs(0, 0, 1080, 600)}${waveBottom(600)}`),
          deco(`${abs(72, 500, 130, 130)}border-radius:50%;background:#F2E6D8;border:6px solid #6E4E3A;display:flex;align-items:center;justify-content:center;`, deco('width:44px;height:44px;border-left:7px solid #6E4E3A;border-top:7px solid #6E4E3A;transform:translateY(8px) rotate(45deg);')),
          deco(`${abs(640, 660, 90, 6)}background:#F2E6D8;`),
          deco(`${abs(704, 650, 26, 26)}border-top:6px solid #F2E6D8;border-right:6px solid #F2E6D8;transform:rotate(45deg);`),
          ...[560, 820, 1080].map((top, i) => pic(c, i + 1, `${abs(768, top, 240, 240)}border-radius:50%;border:10px solid #F2E6D8;`)),
          box('position:absolute;left:72px;top:680px;bottom:64px;width:540px;display:flex;flex-direction:column;justify-content:center;gap:20px;', [
            T(c.eyebrow, `${type(F.ms, 20, 'font-weight:600;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#E6D3BF;`),
            scriptTitle(c.title, { serif: F.ms, size, scriptSize: Math.min(120, Math.round(size * 1.05)), color: '#F6EDE3', more: 'font-weight:700;line-height:1.05;' }),
            T(c.body, `${type(F.ms, fit(c.body, { w: 520, h: 190, max: 26, min: 19, lh: 1.5 }), 'line-height:1.5;')}color:#F6EDE3;`),
            c.cta ? box('align-self:flex-start;background:#F2E6D8;border-radius:999px;padding:14px 30px;', T(c.cta, `${type(F.ms, 22, 'font-weight:700;line-height:1.2;')}color:#4A3426;`)) : '',
            c.extras.map((r) => box('display:flex;align-items:center;gap:16px;', deco('flex:none;width:14px;height:14px;border-radius:50%;background:#F2E6D8;') + T(r, `${type(F.ms, 20, 'line-height:1.35;')}color:#F6EDE3;`))).join(''),
          ].join('')),
        ].join(''),
      };
    },
  },
  {
    id: 'mood-board',
    name: 'Mood Board',
    note: 'Photo, heavy caps title band, photo + dark swatch grid',
    photos: 2,
    build: (c) => ({
      bg: '#F4F3F1',
      inner: [
        pic(c, 0, abs(40, 40, 1000, 440)),
        box('position:absolute;left:40px;right:40px;top:500px;height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;', [
          T(c.title, `${type(F.ms, fit(c.title, { w: 980, h: 140, max: 84, min: 38, caps: true, lh: 1.02 }), 'font-weight:800;text-transform:uppercase;letter-spacing:0.03em;line-height:1.02;')}color:#1C1C1C;`),
          c.eyebrow ? box('display:flex;align-items:center;gap:18px;', deco('flex:none;width:90px;height:2px;background:#1C1C1C;') + T(c.eyebrow, `${type(F.ms, 22, 'font-weight:500;letter-spacing:0.4em;text-transform:uppercase;line-height:1.3;')}color:#1C1C1C;`) + deco('flex:none;width:90px;height:2px;background:#1C1C1C;')) : '',
        ].join('')),
        pic(c, 1, abs(40, 720, 560, 590)),
        box('position:absolute;left:630px;right:40px;top:720px;bottom:40px;display:flex;flex-direction:column;gap:22px;', [
          deco('display:grid;grid-template-columns:repeat(3,116px);gap:18px;', ['#1F1F1F', '#3B3836', '#5A5047', '#7A6A5C', '#9A8D80', '#C8BEB3'].map((hex) => `<span style="display:block;width:116px;height:116px;background:${hex};"></span>`).join('')),
          T(c.body, `${type(F.ms, fit(c.body, { w: 410, h: 220, max: 24, min: 17, lh: 1.45 }), 'line-height:1.45;')}color:#3A3A3A;`),
          extrasOf(c, `${type(F.ms, 17, 'line-height:1.45;')}color:#3A3A3A;`),
          c.cta ? box('align-self:flex-start;border:2px solid #1C1C1C;padding:10px 18px;', T(c.cta, `${type(F.ms, 18, 'font-weight:700;letter-spacing:0.15em;text-transform:uppercase;line-height:1.2;')}color:#1C1C1C;`)) : '',
        ].join('')),
      ].join(''),
    }),
  },
  {
    id: 'inspiration-collage',
    name: 'Inspiration Collage',
    note: 'Photo rows around a heavy caps title and a script line',
    photos: 4,
    build: (c) => ({
      bg: '#FFFFFF',
      inner: [
        pic(c, 0, abs(50, 50, 600, 380)),
        pic(c, 1, abs(670, 50, 360, 380)),
        box('position:absolute;left:50px;right:50px;top:450px;height:440px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;', [
          T(c.title, `${type(F.ms, fit(c.title, { w: 980, h: 230, max: 150, min: 48, caps: true, lh: 0.98 }), 'font-weight:900;text-transform:uppercase;letter-spacing:0.02em;line-height:0.98;')}color:#6B4A33;`),
          T(c.eyebrow, `${type(F.gv, fit(c.eyebrow, { w: 900, h: 90, max: 76, min: 40, font: F.gv, lh: 1.1 }), 'line-height:1.1;')}color:#8B6A4F;`),
          T(c.body, `${type(F.ms, fit(c.body, { w: 860, h: 110, max: 26, min: 18, lh: 1.4 }), 'line-height:1.4;')}color:#5B4636;max-width:880px;`),
          extrasOf(c, `${type(F.ms, 18, 'line-height:1.4;')}color:#5B4636;`),
          T(c.cta, `${type(F.ms, 18, 'font-weight:700;letter-spacing:0.2em;text-transform:uppercase;line-height:1.3;')}color:#6B4A33;margin-top:8px;`),
        ].join('')),
        pic(c, 2, abs(50, 910, 360, 390)),
        pic(c, 3, abs(430, 910, 600, 390)),
      ].join(''),
    }),
  },
];

const HTML_THEMES = TEMPLATES.map(({ id, name, note, photos }) => ({ id, name, note, photos }));
const templateOf = (id) => TEMPLATES.find((t) => t.id === String(id || '')) || null;
const htmlThemeOf = (id) => HTML_THEMES.find((t) => t.id === String(id || '')) || null;

/**
 * The slide's `<article>` re-built in the template.
 * @returns {{ html, placed, placeholders, dropped, runs }} — pictures kept,
 *   empty frames left for the studio, pictures the template had no frame for
 */
function applyHtmlTheme(article, id) {
  const tpl = templateOf(id);
  if (!tpl) throw Object.assign(new Error('Pick one of the HTML themes.'), { status: 400 });
  const { open, runs, pictures } = readSlide(article);
  if (!/^<article\b/i.test(open)) throw Object.assign(new Error('This slide has no layout to restyle.'), { status: 400 });
  const c = { ...roles(runs), pics: pictures.slice(0, tpl.photos) };
  const { bg, inner } = tpl.build(c);
  const rootStyle = `position:relative;display:block;width:1080px;height:1350px;overflow:hidden;box-sizing:border-box;margin:0;padding:0;background:${bg};color:#1F1F1F;font-family:${F.ms.fam};`;
  const rootOpen = open
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i, '')
    .replace(/\sdata-html-theme\s*=\s*("[^"]*"|'[^']*')/i, '')
    .replace(/\s*\/?>$/, ` data-html-theme="${tpl.id}" style="${rootStyle}">`);
  return {
    html: `${rootOpen}${inner}</article>`,
    placed: Math.min(pictures.length, tpl.photos),
    placeholders: Math.max(0, tpl.photos - pictures.length),
    dropped: Math.max(0, pictures.length - tpl.photos),
    runs: runs.length,
  };
}

// the menu's tile previews: each template with sample words and empty frames
const SAMPLE = `<article class="slide" data-index="1">
  <p data-slot="eyebrow">Studio notes</p>
  <h2 data-slot="title">Interior design</h2>
  <p data-slot="body">Calm rooms, honest materials and light that changes through the day.</p>
  <p data-slot="item">Custom interiors</p>
  <p data-slot="item">Furniture &amp; decor</p>
  <p data-slot="action">Book a consultation</p>
</article>`;
function htmlThemePreviews() {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, note: t.note, photos: t.photos, html: applyHtmlTheme(SAMPLE, t.id).html }));
}

module.exports = { HTML_THEMES, HTML_THEME_FONTS_URL, htmlThemeOf, applyHtmlTheme, htmlThemePreviews, readSlide, withRegionWords };
