/*
 * Carousel contrast check — measures each text block on a full-bleed photo
 * slide against the real photo pixels behind it (plan-carousel.md › Full-bleed
 * text — always readable). No browser: the text boxes come from the
 * layout check's CSS estimate, the photo is the 768px copy the carousel agent
 * was shown, cropped the way `object-fit` / `object-position` crop it, with
 * any wash (a translucent band, gradient or ::before/::after layer) blended
 * on top. A block whose worst-case contrast (the 10th percentile of its
 * sampled pixels) misses 4.5:1 under 32px or 3:1 at 32px+ is returned as a
 * plain sentence the carousel agent's layout-fix call can act on.
 * A reserved image slot (data-image-request, filled after the agent) has no
 * pixels yet, so it is measured against the worst case — a black-and-white
 * checkerboard: only light text on a strong wash passes. Skipped: slides whose
 * photo wasn't attached and text on its own opaque background.
 * `makeCarouselReadable` is the last resort for whatever still fails after the
 * repair call: light text + a strong primary wash on that side of the slide.
 */

const sharp = require('sharp');
const {
  parseCss, parseDecls, parseTree, styleOf, absBox, flowHeight, naturalWidth, labelOf,
  walk, els, isAbs, isText, isImg, pad, margin, px, SLIDE,
} = require('./carouselLayoutCheck');

const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };

// ── colours ────────────────────────────────────────────────────────────────
function cssVarsOf(css, rules) {
  const vars = {};
  for (const m of String(css || '').matchAll(/:root\s*\{([^}]*)\}/gi)) {
    Object.entries(parseDecls(m[1])).forEach(([k, v]) => { if (k.startsWith('--')) vars[k] = v; });
  }
  rules.forEach((r) => Object.entries(r.decls).forEach(([k, v]) => { if (k.startsWith('--') && !(k in vars)) vars[k] = v; }));
  return vars;
}

function substituteVars(v, vars) {
  let s = String(v || '');
  for (let i = 0; i < 8 && /var\(/i.test(s); i += 1) {
    s = s.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/gi, (_, name, fb) => (
      vars[name.toLowerCase()] != null ? vars[name.toLowerCase()] : (fb || '')
    ));
  }
  return s;
}

// split on top-level commas
function topArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// → [r, g, b, a] (0–255, a 0–1) or null
function parseColor(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (NAMED[s]) return NAMED[s];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) * 2.55 : parseFloat(x)));
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    const a = p[3] == null ? 1 : (m[1].split(/[\s,/]+/).filter(Boolean)[3].endsWith('%') ? p[3] / 255 : p[3]);
    return [p[0], p[1], p[2], a];
  }
  m = s.match(/^color-mix\(\s*in\s+[\w-]+\s*,(.*)\)$/);
  if (m) {
    const [A, B] = topArgs(m[1]);
    if (!A || !B) return null;
    const split = (t) => {
      const pm = t.match(/\s(\d+(?:\.\d+)?)%\s*$/) || t.match(/^(\d+(?:\.\d+)?)%\s/);
      return { c: parseColor(pm ? t.replace(pm[0], ' ').trim() : t), p: pm ? parseFloat(pm[1]) / 100 : null };
    };
    const a = split(A);
    const b = split(B);
    if (!a.c || !b.c) return null;
    let pa = a.p;
    let pb = b.p;
    if (pa == null && pb == null) { pa = 0.5; pb = 0.5; } else if (pa == null) pa = 1 - pb; else if (pb == null) pb = 1 - pa;
    const sum = pa + pb || 1;
    pa /= sum; pb /= sum;
    // premultiplied, as browsers mix
    const alpha = a.c[3] * pa + b.c[3] * pb;
    const ch = (i) => (alpha ? (a.c[i] * a.c[3] * pa + b.c[i] * b.c[3] * pb) / alpha : 0);
    return [ch(0), ch(1), ch(2), alpha];
  }
  return null;
}

const resolve = (v, vars) => parseColor(substituteVars(v, vars));

// every colour mentioned in a background (gradient stops included)
function colorsIn(bg, vars) {
  const s = substituteVars(bg, vars);
  const found = [];
  const re = /color-mix\((?:[^()]|\([^()]*\))*\)|rgba?\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?:white|black|transparent)\b/gi;
  for (const m of s.matchAll(re)) {
    const c = parseColor(m[0]);
    if (c) found.push(c);
  }
  return found;
}

const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// ── geometry ───────────────────────────────────────────────────────────────
function objectPos(v) {
  const parts = String(v || '50% 50%').trim().toLowerCase().split(/\s+/);
  const kw = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  let x = 0.5;
  let y = 0.5;
  const val = (p) => (p in kw ? kw[p] : (p.endsWith('%') ? parseFloat(p) / 100 : null));
  if (parts.length === 1) {
    const p = parts[0];
    if (p === 'top' || p === 'bottom') y = kw[p]; else if (val(p) != null) x = val(p);
  } else {
    let [a, b] = parts;
    if (a === 'top' || a === 'bottom') [a, b] = [b, a];
    if (val(a) != null) x = val(a);
    if (val(b) != null) y = val(b);
  }
  return { x: Number.isFinite(x) ? x : 0.5, y: Number.isFinite(y) ? y : 0.5 };
}

// leaf text blocks inside an absolutely placed container, stacked in flow
function stackTexts(node, x, y, w, rules, out, depth = 0) {
  if (depth > 10) return;
  const st = styleOf(node, rules);
  const p = pad(st, w);
  const inner = w - p.l - p.r;
  const row = /flex/.test(st.display || '') && !/column/.test(st['flex-direction'] || '');
  const gap = px(st['row-gap'] ?? st.gap, 0) || 0;
  let cy = y + p.t;
  let cx = x + p.l;
  const kids = els(node).filter((c) => !isAbs(styleOf(c, rules)) && !/none/.test(styleOf(c, rules).display || ''));
  kids.forEach((k) => {
    const kst = styleOf(k, rules);
    const m = margin(kst, inner);
    const kw = Math.min(px(kst.width, inner) ?? (row ? inner / Math.max(1, kids.length) : inner), inner);
    const h = flowHeight(k, kw, rules) || 0;
    const top = cy + m.t;
    if (isText(k)) {
      const centred = /center|right|end/.test(kst['text-align'] || '');
      const tw = centred ? kw : Math.min(kw, naturalWidth(k, kst));
      out.push({ node: k, box: { x: cx, y: top, w: tw, h } });
    } else if (!isImg(k)) {
      stackTexts(k, cx, top, kw, rules, out, depth + 1);
    }
    if (row) cx += kw + gap; else cy = top + h + m.b + gap;
  });
}

function inheritedOwn(node, prop, rules) {
  for (let n = node; n && n.tag && n.tag !== '#root'; n = n.parent) {
    styleOf(n, rules);
    if (n._own && n._own[prop] != null && n._own[prop] !== 'inherit') return n._own[prop];
  }
  return null;
}

const ownBg = (st) => String(st.background || st['background-color'] || st['background-image'] || '').trim();

// pseudo-element layers (`.x::before { background: … }`) the tree can't see
function pseudoWashes(css, vars) {
  const out = [];
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = parseDecls(m[2]);
    const bg = decls.background || decls['background-image'] || decls['background-color'];
    if (!bg) continue;
    m[1].split(',').forEach((sel) => {
      const pm = sel.trim().match(/^(.*?)::?(before|after)\s*$/i);
      if (!pm) return;
      const last = pm[1].trim().split(/[\s>+~]+/).pop() || '';
      const tag = (last.match(/^[a-z][a-z0-9]*/i) || [''])[0].toLowerCase();
      const classes = [...last.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
      const colors = colorsIn(bg, vars);
      if ((tag || classes.length) && colors.length) out.push({ tag, classes, colors });
    });
  }
  return out;
}

const matchesCompound = (node, c) => (!c.tag || c.tag === node.tag)
  && c.classes.every((k) => String(node.attrs?.class || '').split(/\s+/).includes(k));

// strongest layer colour a wash puts behind the text (gradients assumed at full
// strength behind the text group, as the prompt requires)
function strongest(colors) {
  return colors.filter((c) => c[3] > 0.02).sort((a, b) => b[3] - a[3])[0] || null;
}

async function decodePhoto(b64) {
  const { data, info } = await sharp(Buffer.from(b64, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}

// ── check ──────────────────────────────────────────────────────────────────
/**
 * @param {string} html            the carousel agent's document
 * @param {Map<string,string>} photos  asset key → base64 JPEG (the copies sent to the agent)
 * @returns {Promise<{slide:number, problem:string, box:object}[]>}
 */
async function carouselContrastFailures(html, photos = new Map()) {
  const doc = String(html || '');
  if (!doc) return [];
  try {
    const css = [...doc.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const rules = parseCss(css);
    const vars = cssVarsOf(css, rules);
    const pseudo = pseudoWashes(css, vars);
    const tree = parseTree(doc.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, ''));
    const articles = [...walk(tree)].filter((n) => n.tag === 'article' && /\bslide\b/.test(n.attrs.class || ''));
    const decoded = new Map();
    const out = [];
    for (const [i, article] of articles.entries()) {
      const idx = Number(article.attrs['data-index']) || i + 1;
      // eslint-disable-next-line no-await-in-loop
      out.push(...await checkSlide(article, idx, { rules, vars, pseudo, photos, decoded }));
    }
    return out;
  } catch (err) {
    console.warn('[carouselContrastCheck] could not check contrast:', err.message);
    return [];
  }
}

// → problems, one sentence each
async function carouselContrastProblems(html, photos) {
  return (await carouselContrastFailures(html, photos)).map((f) => f.problem);
}

async function checkSlide(article, idx, { rules, vars, pseudo, photos, decoded }) {
  const sst = styleOf(article, rules);
  const W = px(sst.width) || 1080;
  const H = px(sst.height) || Math.round((W * 5) / 4);
  SLIDE.w = W;
  SLIDE.h = H;
  const all = [...walk(article)];
  const img = all.find((n) => isImg(n) && isAbs(styleOf(n, rules))
    && (photos.has(n.attrs['data-asset-key'] || '') || (n.attrs['data-image-request'] && !n.attrs['data-asset-key'])));
  if (!img) return [];
  const ib = absBox(img, W, H, rules);
  if (!ib || ib.w < W * 0.6 || ib.h < H * 0.6) return []; // not a full-bleed photo
  const key = img.attrs['data-asset-key'] || '';
  let pixel;
  if (key && photos.has(key)) {
    if (!decoded.has(key)) decoded.set(key, await decodePhoto(photos.get(key)));
    const photo = decoded.get(key);
    const ist = styleOf(img, rules);
    const fit = /contain/.test(ist['object-fit'] || '') ? 'contain' : 'cover';
    const s = fit === 'cover' ? Math.max(ib.w / photo.w, ib.h / photo.h) : Math.min(ib.w / photo.w, ib.h / photo.h);
    const pos = objectPos(ist['object-position']);
    const ox = ib.x + (ib.w - photo.w * s) * pos.x;
    const oy = ib.y + (ib.h - photo.h * s) * pos.y;
    pixel = (X, Y) => {
      const sx = Math.floor((X - ox) / s);
      const sy = Math.floor((Y - oy) / s);
      if (sx < 0 || sy < 0 || sx >= photo.w || sy >= photo.h) return null;
      const o = (sy * photo.w + sx) * photo.ch;
      return [photo.data[o], photo.data[o + 1], photo.data[o + 2]];
    };
  } else {
    // picture not made yet: assume the worst — both white and black behind the text
    pixel = (X, Y) => ((Math.floor(X / 24) + Math.floor(Y / 24)) % 2 ? [255, 255, 255] : [0, 0, 0]);
  }

  // absolutely placed layers: text containers and washes
  const placed = all.filter((n) => n !== img && isAbs(styleOf(n, rules)));
  const boxes = new Map(placed.map((n) => [n, absBox(n, W, H, rules)]).filter(([, b]) => b));
  const washes = [];
  for (const [n, b] of boxes) {
    const bg = ownBg(styleOf(n, rules));
    const c = bg ? strongest(colorsIn(bg, vars)) : null;
    if (c) washes.push({ node: n, box: b, color: c });
  }
  // ::before / ::after layers: assume they cover their element's box
  const ownerBox = (n) => (n === article ? { x: 0, y: 0, w: W, h: H } : boxes.get(n));
  [article, ...placed].forEach((n) => pseudo.filter((p) => matchesCompound(n, p)).forEach((p) => {
    const b = ownerBox(n);
    const c = strongest(p.colors);
    if (b && c) washes.push({ node: n, box: b, color: c });
  }));

  const texts = [];
  for (const [n, b] of boxes) {
    if (isText(n)) texts.push({ node: n, box: { ...b, h: Math.min(b.h, b.natural || b.h) } });
    else if ([...walk(n)].some(isText)) {
      const nst = styleOf(n, rules);
      const natural = flowHeight(n, b.w, rules) || b.h;
      // a taller box centres / bottom-aligns its column
      const extra = Math.max(0, b.h - natural);
      const jc = String(nst['justify-content'] || '');
      const shift = /flex-end|end/.test(jc) ? extra : (/center/.test(jc) ? extra / 2 : 0);
      stackTexts(n, b.x, b.y + shift, b.w, rules, texts);
    }
  }

  const failures = [];
  const seen = new Set();
  texts.forEach(({ node, box }) => {
    if (seen.has(node) || !(box.w > 4 && box.h > 4)) return;
    seen.add(node);
    const st = styleOf(node, rules);
    // its own opaque surface (a highlight, a label chip) — not on the photo
    const own = ownBg(st) ? strongest(colorsIn(ownBg(st), vars)) : null;
    if (own && own[3] > 0.9) return;
    const color = resolve(inheritedOwn(node, 'color', rules) || '#000', vars);
    if (!color) return;
    const tL = lum(color[0], color[1], color[2]);
    const size = px(st['font-size'], 0, 16) || 16;
    const need = size >= 32 ? 3 : 4.5;
    // washes behind this text: any layer (not the text itself) overlapping it
    const inside = new Set(walk(node));
    const under = washes.filter((w) => w.node !== node && !inside.has(w.node)
      && w.box.x < box.x + box.w && w.box.x + w.box.w > box.x && w.box.y < box.y + box.h && w.box.y + w.box.h > box.y);
    const step = Math.max(4, Math.min(box.w, box.h) / 12);
    const ratios = [];
    for (let Y = box.y + step / 2; Y < box.y + box.h; Y += step) {
      for (let X = box.x + step / 2; X < box.x + box.w; X += step) {
        let p = pixel(X, Y);
        if (!p) continue;
        under.forEach((w) => {
          if (X < w.box.x || X > w.box.x + w.box.w || Y < w.box.y || Y > w.box.y + w.box.h) return;
          const a = w.color[3];
          p = [0, 1, 2].map((c) => p[c] * (1 - a) + w.color[c] * a);
        });
        ratios.push(ratio(tL, lum(p[0], p[1], p[2])));
      }
    }
    if (ratios.length < 4) return;
    ratios.sort((a, b) => a - b);
    const worst = ratios[Math.floor(ratios.length * 0.1)];
    if (worst >= need) return;
    const dark = tL < 0.18;
    const fix = dark
      ? 'it is dark text on a photo: set the whole text group in var(--brand-background) and put a primary wash behind that whole group, strong enough that every line reaches the ratio'
      : 'light text over a bright or busy area: move the group to a calmer area clear of the focal point, and strengthen the primary wash behind the whole text group until every line reaches the ratio';
    failures.push({
      slide: idx,
      box,
      problem: `Slide ${idx}: ${labelOf(node)} reads only ~${worst.toFixed(1)}:1 against the photo behind it (needs ${need}:1 at ${Math.round(size)}px) — ${fix} (see "Full-bleed text").`,
    });
  });
  if (!failures.length) return [];
  // the wash has to cover every line on the slide, including a headline that
  // already passed: the last resort recolours the whole group light
  const y0 = Math.min(...texts.map((t) => t.box.y));
  const y1 = Math.max(...texts.map((t) => t.box.y + t.box.h));
  const group = { x: 0, y: y0, w: W, h: Math.max(1, y1 - y0) };
  failures.forEach((f) => { f.group = group; });
  return failures;
}

// ── last resort ────────────────────────────────────────────────────────────
// For each slide in `failures`: every text run on it turns light
// (--brand-background) and a primary gradient wash — 78% across the text,
// fading out 200px beyond it — goes over the photo on the text's side. The
// photo's far side (where the focal point is) stays untouched.
function makeCarouselReadable(html, failures) {
  const bySlide = new Map();
  (failures || []).forEach((f) => {
    const span = bySlide.get(f.slide) || { y0: Infinity, y1: -Infinity };
    const box = f.group || f.box;
    span.y0 = Math.min(span.y0, box.y);
    span.y1 = Math.max(span.y1, box.y + box.h);
    bySlide.set(f.slide, span);
  });
  if (!bySlide.size) return String(html || '');
  const H = 1350;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / H) * 100)).toFixed(1)}%`;
  const strong = 'color-mix(in srgb, var(--brand-primary) 78%, transparent)';
  return String(html || '').replace(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi, (full, attrs, body) => {
    const idx = Number((attrs.match(/data-index\s*=\s*["']?(\d+)/i) || [])[1]);
    const span = bySlide.get(idx);
    if (!span) return full;
    // wash on the text's side: top text fades downward, bottom text upward,
    // middle text fades both ways
    const mid = (span.y0 + span.y1) / 2;
    const fade = 200;
    let gradient;
    if (mid < H * 0.4) {
      gradient = `linear-gradient(to bottom, ${strong} 0%, ${strong} ${pct(span.y1 + 24)}, transparent ${pct(span.y1 + fade)})`;
    } else if (mid > H * 0.6) {
      gradient = `linear-gradient(to top, ${strong} 0%, ${strong} ${pct(H - span.y0 + 24)}, transparent ${pct(H - span.y0 + fade)})`;
    } else {
      gradient = `linear-gradient(to bottom, transparent ${pct(span.y0 - fade)}, ${strong} ${pct(span.y0 - 24)}, ${strong} ${pct(span.y1 + 24)}, transparent ${pct(span.y1 + fade)})`;
    }
    const wash = `<div data-wash="readability" style="position: absolute; inset: 0; pointer-events: none; background: ${gradient};"></div>`;
    // right after the full-bleed picture, so it paints above it and below the text
    let placed = false;
    let next = body.replace(/<img\b[^>]*\bdata-slot\s*=\s*["']image["'][^>]*>/i, (tag) => {
      placed = true;
      const z = (tag.match(/z-index\s*:\s*(-?\d+)/i) || [])[1];
      return `${tag}${z != null ? wash.replace('pointer-events: none;', `pointer-events: none; z-index: ${z};`) : wash}`;
    });
    if (!placed) return full;
    // every text run light
    next = next.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-slot\s*=\s*["'](?!image["'])[\w-]+["'][^>]*)>/gi, (tag, name, a) => {
      const light = 'color: var(--brand-background) !important;';
      if (/\sstyle\s*=\s*"/i.test(a)) return `<${name}${a.replace(/(\sstyle\s*=\s*")/i, `$1${light} `)}>`;
      if (/\sstyle\s*=\s*'/i.test(a)) return `<${name}${a.replace(/(\sstyle\s*=\s*')/i, `$1${light} `)}>`;
      return `<${name}${a} style="${light}">`;
    });
    return `<article${attrs}>${next}</article>`;
  });
}

module.exports = { carouselContrastProblems, carouselContrastFailures, makeCarouselReadable, parseColor };
