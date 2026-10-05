/**
 * Theme Apply renders are flat pictures. This makes them editable by REGION:
 *
 *   mapRegions  — where each line of text and the photo sit on the render
 *                 (Haiku vision over a labelled 10% ruler grid; the photo box
 *                 comes from the placeholder paste when it is known). Stored on
 *                 the slide as `themeRegions` { key, texts[], images[] }.
 *   editText    — re-letter one text region with new words (image model),
 *   regenImage  — repaint one picture region (image model, optional brief),
 *   placePhoto  — put a studio photo into one picture region (no model).
 *
 * Every model edit is composited back into the ORIGINAL render through a
 * feathered mask of the region only, so nothing outside it can change.
 */
const sharp = require('sharp');
const { completeToolCall } = require('./llmComplete');
const { composeImage } = require('./openaiImage');

const REGION_MODEL = () => process.env.THEME_REGIONS_MODEL || process.env.THEME_CHECK_MODEL || 'claude-haiku-4-5-20251001';
const EDIT_MODEL = () => process.env.OPENAI_THEME_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
const PRICE = { in: Number(process.env.THEME_STYLE_PRICE_IN) || 1, out: Number(process.env.THEME_STYLE_PRICE_OUT) || 5 };

const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));
function pctBox(b) {
  const left = clampPct(b?.left);
  const top = clampPct(b?.top);
  return {
    left,
    top,
    width: Math.max(0, Math.min(100 - left, Number(b?.width) || 0)),
    height: Math.max(0, Math.min(100 - top, Number(b?.height) || 0)),
  };
}
const round1 = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 10) / 10]));
function padBox(b, pad) {
  return pctBox({ left: b.left - pad, top: b.top - pad, width: b.width + 2 * pad, height: b.height + 2 * pad });
}

// ── Where the text is: pixels first, the model only groups ─────────────────
// "Ink" = pixels that stand out from the paper around them (letters in any
// colour, faint grid/paper texture excluded), on a downscaled copy with the
// photos blanked out. Rows of ink → text lines; each line split where a wide
// horizontal gap leaves it → candidate boxes. The candidates are drawn numbered
// on the slide and the model says which numbers form each text block — so the
// boxes are exact (pixels) and the grouping is semantic (the model).
const INK_W = 384;
async function inkMap(buffer, pictures = []) {
  const { data, info } = await sharp(buffer).rotate().resize({ width: INK_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const at = (x, y) => (y * w + x) * 3;
  const pic = new Uint8Array(w * h);
  pictures.forEach((b) => {
    const x0 = Math.max(0, Math.floor(((b.left - 0.8) / 100) * w));
    const x1 = Math.min(w - 1, Math.ceil(((b.left + b.width + 0.8) / 100) * w));
    const y0 = Math.max(0, Math.floor(((b.top - 0.8) / 100) * h));
    const y1 = Math.min(h - 1, Math.ceil(((b.top + b.height + 0.8) / 100) * h));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) pic[y * w + x] = 1;
  });
  // the paper behind the letters: a median filter wipes thin strokes out
  const bg = await sharp(buffer).rotate().resize({ width: INK_W }).removeAlpha().median(9).raw().toBuffer();
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (pic[y * w + x]) continue;
      const i = at(x, y);
      if (Math.hypot(data[i] - bg[i], data[i + 1] - bg[i + 1], data[i + 2] - bg[i + 2]) > 48) mask[y * w + x] = 1;
    }
  }
  return { mask: dropNonLetters(mask, w, h), w, h };
}

// Torn paper, tape and frame edges are "ink" too, and they run down the slide
// beside the type — one edge bridges the label and the headline into a band too
// tall to be a line, and both are lost. Connected blobs that cannot be letters
// are wiped: taller than a line, or wide wiggles (a lot of box, little ink).
// A straight rule (an underline) is thin, so it stays.
function dropNonLetters(mask, w, h) {
  return dropBlobs(mask, w, h, ({ n, bw, bh }) => bh > h * 0.11 // taller than a line
    || (bw > w * 0.2 && bh > h * 0.012 && n / (bw * bh) < 0.1) // a wide wiggle
    || n <= 2);
}

// wipe the 8-connected blobs of `mask` that `drop({ n, bw, bh })` picks
function dropBlobs(mask, w, h, drop) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = new Uint8Array(mask);
  for (let s = 0; s < w * h; s += 1) {
    if (!mask[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    const px = [];
    let x0 = w; let x1 = 0; let y0 = h; let y1 = 0;
    while (top) {
      const p = stack[--top];
      px.push(p);
      const x = p % w; const y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) { seen[q] = 1; stack[top++] = q; }
        }
      }
    }
    if (drop({ n: px.length, bw: x1 - x0 + 1, bh: y1 - y0 + 1 })) px.forEach((p) => { out[p] = 0; });
  }
  return out;
}

// The picture inside a rough box (a model's guess, a kept area): the slide's
// ground is the commonest colour along the box's edge; the picture is the
// biggest blob standing off it (a photo with its frame, a cut-out sticker),
// holes filled. → { rect (px, the area searched), alpha (rect-sized, 0/255),
// box (px, the blob's bounds) } or null when nothing stands out.
// A rough box can also be SMALLER than the picture: while the blob runs into
// the searched area's edge, the area grows.
async function pictureBlob(buffer, box) {
  let found = null;
  for (const pad of [3, 8, 14, 22]) {
    found = await blobIn(buffer, box, pad); // eslint-disable-line no-await-in-loop
    if (!found) return null;
    const { rect: r, box: b } = found;
    const clipped = (b.left <= r.left + 1 && r.left > 0) || (b.top <= r.top + 1 && r.top > 0)
      || (b.left + b.width >= r.left + r.width - 1 && r.left + r.width < found.W)
      || (b.top + b.height >= r.top + r.height - 1 && r.top + r.height < found.H);
    if (!clipped) break;
  }
  return found;
}
async function blobIn(buffer, box, pad) {
  const { width: W, height: H } = await sharp(buffer).rotate().metadata();
  const rect = pxBox(padBox(box, pad), W, H);
  const { data } = await sharp(buffer).rotate().extract(rect).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = rect.width; const h = rect.height;
  const counts = new Map();
  const edge = (x, y) => {
    const i = (y * w + x) * 3;
    const k = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
    const c = counts.get(k) || [0, 0, 0, 0];
    c[0] += 1; c[1] += data[i]; c[2] += data[i + 1]; c[3] += data[i + 2];
    counts.set(k, c);
  };
  for (let x = 0; x < w; x += 1) { edge(x, 0); edge(x, h - 1); }
  for (let y = 0; y < h; y += 1) { edge(0, y); edge(w - 1, y); }
  let g = null;
  counts.forEach((c) => { if (!g || c[0] > g[0]) g = c; });
  const ground = [g[1] / g[0], g[2] / g[0], g[3] / g[0]];
  const off = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 3;
    if (Math.hypot(data[i] - ground[0], data[i + 1] - ground[1], data[i + 2] - ground[2]) > 60) off[p] = 1;
  }
  // the blob of off-ground pixels that fills most of the box asked about (the
  // area searched may have grown into a neighbour)
  const own = pxBox(box, W, H);
  const inBox = (x, y) => x + rect.left >= own.left && x + rect.left < own.left + own.width
    && y + rect.top >= own.top && y + rect.top < own.top + own.height;
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best = -1; let bestN = 0;
  for (let s0 = 0; s0 < w * h; s0 += 1) {
    if (!off[s0] || label[s0] >= 0) continue;
    let top = 0; let n = 0;
    stack[top++] = s0; label[s0] = s0;
    while (top) {
      const q = stack[--top];
      const x = q % w; const y = (q - x) / w;
      if (inBox(x, y)) n += 1;
      if (x > 0 && off[q - 1] && label[q - 1] < 0) { label[q - 1] = s0; stack[top++] = q - 1; }
      if (x < w - 1 && off[q + 1] && label[q + 1] < 0) { label[q + 1] = s0; stack[top++] = q + 1; }
      if (y > 0 && off[q - w] && label[q - w] < 0) { label[q - w] = s0; stack[top++] = q - w; }
      if (y < h - 1 && off[q + w] && label[q + w] < 0) { label[q + w] = s0; stack[top++] = q + w; }
    }
    if (n > bestN) { bestN = n; best = s0; }
  }
  if (best < 0 || bestN < own.width * own.height * 0.04) return null;
  // fill its holes: whatever the outside cannot reach without crossing it
  const outside = new Uint8Array(w * h);
  let top = 0;
  const seed = (q) => { if (label[q] !== best && !outside[q]) { outside[q] = 1; stack[top++] = q; } };
  for (let x = 0; x < w; x += 1) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { seed(y * w); seed(y * w + w - 1); }
  while (top) {
    const q = stack[--top];
    const x = q % w; const y = (q - x) / w;
    if (x > 0) seed(q - 1); if (x < w - 1) seed(q + 1); if (y > 0) seed(q - w); if (y < h - 1) seed(q + w);
  }
  const alpha = Buffer.alloc(w * h);
  let x0 = w; let x1 = -1; let y0 = h; let y1 = -1;
  for (let q = 0; q < w * h; q += 1) {
    if (outside[q]) continue;
    alpha[q] = 255;
    const x = q % w; const y = (q - x) / w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { rect, alpha, box: { left: rect.left + x0, top: rect.top + y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }, W, H };
}

// candidate line boxes (percent), top to bottom
function lineCandidates({ mask, w, h }) {
  const rowCount = (y) => { let c = 0; for (let x = 0; x < w; x += 1) c += mask[y * w + x]; return c; };
  const runs = [];
  let start = -1;
  // a few stray pixels (a paper edge beside the type) do not join two lines
  const minRow = Math.max(2, Math.round(w * 0.012));
  for (let y = 0; y < h; y += 1) {
    const on = rowCount(y) >= minRow;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { runs.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, h - 1]);
  // tightly set lines touch (a descender into the cap height below) and read
  // as one band too tall to be a line: cut it at its thinnest row until each
  // piece is line-sized. Bands far too tall (a shape, a photo) stay whole.
  const maxH = h * 0.11;
  const minH = Math.max(3, Math.round(h * 0.015));
  const split = ([y0, y1]) => {
    if (y1 - y0 + 1 <= maxH || y1 - y0 + 1 > h * 0.35) return [[y0, y1]];
    let cut = -1; let least = Infinity;
    for (let y = y0 + minH; y <= y1 - minH; y += 1) { const c = rowCount(y); if (c < least) { least = c; cut = y; } }
    if (cut < 0) return [[y0, y1]];
    return [...split([y0, cut - 1]), ...split([cut + 1, y1])];
  };
  const gapCols = Math.round(w * 0.05);
  const out = [];
  runs.flatMap(split).forEach(([y0, y1]) => {
    const colOn = [];
    for (let x = 0; x < w; x += 1) {
      let c = 0;
      for (let y = y0; y <= y1; y += 1) c += mask[y * w + x];
      colOn.push(c > 0);
    }
    let a = -1; let lastOn = -1;
    const segs = [];
    colOn.forEach((on, x) => {
      if (on) { if (a < 0) a = x; lastOn = x; } else if (a >= 0 && x - lastOn > gapCols) { segs.push([a, lastOn]); a = -1; }
    });
    if (a >= 0) segs.push([a, lastOn]);
    segs.forEach(([x0, x1]) => {
      const box = pctBox({ left: (x0 / w) * 100, top: (y0 / h) * 100, width: ((x1 - x0 + 1) / w) * 100, height: ((y1 - y0 + 1) / h) * 100 });
      // letters: not a speck, not a slab (a photo or a big shape)
      if (box.height >= 0.7 && box.height <= 11 && box.width >= 1.5) out.push(box);
    });
  });
  return out;
}

// The boxes are drawn in the marker colour the slide uses least — type set in
// the marker's own colour reads as part of the annotation and is left out.
const MARKERS = [
  { name: 'blue', hex: '#00b7ff', rgb: [0, 183, 255] },
  { name: 'magenta', hex: '#ff00aa', rgb: [255, 0, 170] },
  { name: 'green', hex: '#00c853', rgb: [0, 200, 83] },
  { name: 'orange', hex: '#ff6d00', rgb: [255, 109, 0] },
];
async function pickMarker(jpeg) {
  const { data } = await sharp(jpeg).resize({ width: 64, height: 80, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const uses = MARKERS.map((m) => {
    let n = 0;
    for (let i = 0; i < data.length; i += 3) if (Math.hypot(data[i] - m.rgb[0], data[i + 1] - m.rgb[1], data[i + 2] - m.rgb[2]) < 110) n += 1;
    return n;
  });
  return MARKERS[uses.indexOf(Math.min(...uses))];
}

async function drawCandidates(jpeg, cands, marker = MARKERS[0]) {
  const { width: W, height: H } = await sharp(jpeg).metadata();
  const marks = cands.map((b, n) => {
    const x = (b.left / 100) * W;
    const y = (b.top / 100) * H;
    const bw = (b.width / 100) * W;
    const bh = (b.height / 100) * H;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="none" stroke="${marker.hex}" stroke-width="2"/>`
      + `<rect x="${Math.max(0, x - 26)}" y="${y}" width="24" height="18" fill="${marker.hex}"/>`
      + `<text x="${Math.max(0, x - 25)}" y="${y + 14}" font-size="14" font-family="sans-serif" font-weight="700" fill="#fff">${n + 1}</text>`;
  }).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks}</svg>`);
  return sharp(jpeg).composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 88 }).toBuffer();
}

// v2: text blocks carry `style` {bold, italic, underline, strike, color,
// highlight, align} and `runs` [{words, …the same}]; v4: paper edges no longer
// hide lines, touching lines are split; v5: styles / colour / box read off
// the letters only (not the tape or backgrounds around them); v6: a line the
// model drops (type in the marker colour) is folded back in; v7: the logo's box
// (`logo`); v8: model-guessed picture boxes tightened to the pixels — older
// maps are re-read
const REGIONS_V = 8;
// stroke thickness / line height at and above which letters read as bold
const BOLD_WEIGHT = Number(process.env.THEME_REGIONS_BOLD_WEIGHT) || 0.12;
const HEX = /^#[0-9a-f]{6}$/i;
const hexOr = (v) => (HEX.test(String(v || '').trim()) ? String(v).trim().toLowerCase() : '');
function cleanStyle(st = {}) {
  const align = ['left', 'center', 'right'].includes(st?.align) ? st.align : 'left';
  return {
    bold: Boolean(st?.bold),
    italic: Boolean(st?.italic),
    underline: Boolean(st?.underline),
    strike: Boolean(st?.strike),
    highlight: hexOr(st?.highlight),
    align,
  };
}
function cleanRuns(runs) {
  return (Array.isArray(runs) ? runs : []).slice(0, 12)
    .map((r) => {
      const out = { words: String(r?.words || '').trim().slice(0, 200) };
      ['bold', 'italic', 'underline', 'strike'].forEach((k) => { if (typeof r?.[k] === 'boolean') out[k] = r[k]; });
      if (hexOr(r?.color)) out.color = hexOr(r.color);
      if (hexOr(r?.highlight)) out.highlight = hexOr(r.highlight);
      return out;
    })
    .filter((r) => r.words && Object.keys(r).length > 1);
}

// The colour most of a block's letters are drawn in: pixels that stand out
// from the paper behind them (median-filtered), bucketed, the biggest bucket
// averaged — so anti-aliased edges and a differently coloured word don't win.
// One line of type read off the pixels. Its box may hold more than paper and
// letters — a label on tape has the tape, the slide around the tape and some
// doodles in it — so every BACKGROUND is found, not only the commonest colour:
// a colour that fills a solid patch a third of a line tall (letter strokes are
// thinner than that). Ink is what stands off all of them; the letters' box is
// where the ink is. `lineH` = the block's usual line height (px).
async function lineInk(buffer, box, W, H, below = 1, lineH = 0) {
  const own = pxBox(box, W, H);
  const r = { ...own, height: Math.max(1, Math.min(H - own.top, Math.round(own.height * below))) };
  const { data, info } = await sharp(buffer).rotate().extract(r).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width; const h = info.height;
  const near = (i, c, d) => Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]) <= d;
  const commonest = (skip) => {
    const counts = new Map();
    for (let i = 0; i < w * h * 3; i += 3) {
      if (skip(i)) continue;
      const k = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      const c = counts.get(k) || [0, 0, 0, 0];
      c[0] += 1; c[1] += data[i]; c[2] += data[i + 1]; c[3] += data[i + 2];
      counts.set(k, c);
    }
    let top = null;
    counts.forEach((c) => { if (!top || c[0] > top[0]) top = c; });
    return top ? { n: top[0], rgb: [top[1] / top[0], top[2] / top[0], top[3] / top[0]] } : null;
  };
  // a solid k×k patch of colour c somewhere in the box (integral image)
  const k = Math.max(3, Math.round((lineH || own.height) * 0.35));
  const solid = (c) => {
    const sum = new Int32Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y += 1) {
      let row = 0;
      for (let x = 0; x < w; x += 1) {
        row += near((y * w + x) * 3, c, 60) ? 1 : 0;
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
      }
    }
    for (let y = k; y <= h; y += 1) {
      for (let x = k; x <= w; x += 1) {
        const v = sum[y * (w + 1) + x] - sum[(y - k) * (w + 1) + x] - sum[y * (w + 1) + x - k] + sum[(y - k) * (w + 1) + x - k];
        if (v >= k * k * 0.97) return true;
      }
    }
    return false;
  };
  const backs = [];
  const first = commonest(() => false);
  if (!first) return null;
  backs.push(first.rgb);
  for (let n = 0; n < 2; n += 1) {
    const next = commonest((i) => backs.some((c) => near(i, c, 60)));
    if (!next || next.n < w * h * 0.08) break;
    if (k > Math.min(w, h) || !solid(next.rgb)) break;
    backs.push(next.rgb);
  }
  const mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p += 1) if (!backs.some((c) => near(p * 3, c, 80))) mask[p] = 1;
  // where two backgrounds meet (the tape's torn edge on the slide) a blended,
  // fibrous line is left: ink with BOTH backgrounds close by is that seam —
  // letters sit inside one background
  if (backs.length > 1) {
    const r = Math.max(2, Math.round((lineH || own.height) * 0.06));
    const near2 = backs.map((c) => {
      const sum = new Int32Array((w + 1) * (h + 1));
      for (let y = 0; y < h; y += 1) {
        let row = 0;
        for (let x = 0; x < w; x += 1) {
          row += near((y * w + x) * 3, c, 60) ? 1 : 0;
          sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row;
        }
      }
      return (x, y) => {
        const xa = Math.max(0, x - r); const xb = Math.min(w, x + r + 1);
        const ya = Math.max(0, y - r); const yb = Math.min(h, y + r + 1);
        return sum[yb * (w + 1) + xb] - sum[ya * (w + 1) + xb] - sum[yb * (w + 1) + xa] + sum[ya * (w + 1) + xa] > 0;
      };
    });
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (mask[y * w + x] && near2.filter((f) => f(x, y)).length > 1) mask[y * w + x] = 0;
      }
    }
  }
  // the letters' box: rows / columns with more than a speck of ink, inside the
  // line's own height (the part below is only looked at for an underline)
  // (a shape's outline — the tape's edge — leaves only a few pixels a row or
  // a column, letters many)
  const rowsOn = [];
  for (let y = 0; y < Math.min(h, own.height); y += 1) {
    let c = 0;
    for (let x = 0; x < w; x += 1) c += mask[y * w + x];
    rowsOn.push(c);
  }
  const ys = rowsOn.map((c, y) => (c >= Math.max(2, w * 0.015) ? y : -1)).filter((y) => y >= 0);
  const colsOn = new Array(w).fill(0);
  if (ys.length) for (let y = ys[0]; y <= ys[ys.length - 1]; y += 1) for (let x = 0; x < w; x += 1) colsOn[x] += mask[y * w + x];
  const span = ys.length ? ys[ys.length - 1] - ys[0] + 1 : 0;
  const xs = colsOn.map((c, x) => (c >= Math.max(2, span * 0.08) ? x : -1)).filter((x) => x >= 0);
  const tight = ys.length && xs.length
    ? { left: own.left + xs[0], top: own.top + ys[0], width: xs[xs.length - 1] - xs[0] + 1, height: ys[ys.length - 1] - ys[0] + 1 }
    : null;
  // the ink's colour: its commonest colour
  let colour = '';
  const inkTop = commonest((i) => !mask[i / 3]);
  if (inkTop && inkTop.n >= 12) colour = `#${inkTop.rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  return { mask, w, h, own, tight, colour, inkCount: mask.reduce((a, v) => a + v, 0) };
}

// What the pixels say about how a block is set — the model misses rules and
// weight often enough that these are measured: a strike is a rule crossing a
// text line at mid-height, an underline one at or just under its foot (or a
// thin, wide rule-only line under the type), and weight is the stroke
// thickness against the line's height. `lineBoxes` are the block's candidate
// lines (percent). Also returns the block's ink colour and the letters' box.
// a row of separate letter-sized blobs of ink (not one long edge or tape)
async function looksLikeLetters(buffer, box) {
  const { width: W, height: H } = await sharp(buffer).rotate().metadata();
  const ink = await lineInk(buffer, box, W, H);
  if (!ink?.tight) return false;
  const th = ink.tight.height;
  let letters = 0;
  dropBlobs(ink.mask, ink.w, ink.h, ({ n, bw, bh }) => {
    if (n >= 6 && bh >= th * 0.3 && bh <= th * 1.05 && bw <= th * 2.5) letters += 1;
    return false;
  });
  return letters >= 4;
}

async function typeFeatures(buffer, lineBoxes, text = '') {
  const { width: W, height: H } = await sharp(buffer).rotate().metadata();
  const heights = lineBoxes.map((b) => (b.height / 100) * H).sort((a, b) => a - b);
  // (the tallest line, not the median: slivers cut off the tops of tall
  // letters would drag a median down)
  const tallest = heights[heights.length - 1] || 1;
  let strike = false;
  let underline = false;
  const strokes = [];
  const slants = [];
  const reads = [];
  const lines = lineBoxes.map((b) => ({ b, thin: (b.height / 100) * H < tallest * 0.4 }));
  const typeLines = lines.filter((l) => !l.thin).map((l) => l.b);
  const blockW = Math.max(...lineBoxes.map((b) => b.width), 0);
  for (const { b, thin } of lines) {
    // look a little under the line for an underline — not into the next line
    const nextTop = Math.min(...typeLines.filter((t) => t.top > b.top + b.height * 0.5).map((t) => t.top));
    const below = thin ? 1 : Math.max(1, Math.min(1.4, (nextTop - b.top) / b.height));
    // eslint-disable-next-line no-await-in-loop
    const ink = await lineInk(buffer, b, W, H, below, tallest);
    if (!ink) continue;
    const { mask, w, h, own } = ink;
    const ruleRows = new Set();
    for (let y = 0; y < h; y += 1) {
      let best = 0; let run = 0; let gap = 0;
      for (let x = 0; x < w; x += 1) {
        if (mask[y * w + x]) { run += 1 + gap; gap = 0; } else if (run && gap < 2) gap += 1; else { run = 0; gap = 0; }
        if (run > best) best = run;
      }
      if (best >= w * 0.6) ruleRows.add(y);
    }
    if (thin) {
      // a rule of its own: an underline only when it is wide and sits under
      // the type (not the top of a tall letter cut off by the line split)
      const under = typeLines.some((t) => b.top >= t.top + t.height * 0.6 && b.top <= t.top + t.height * 1.6);
      if (ruleRows.size && under && b.width >= blockW * 0.5) underline = true;
      continue;
    }
    reads.push(ink);
    const t = ink.tight || { top: own.top, height: own.height, left: own.left, width: own.width };
    const y0 = t.top - own.top; const lh = t.height;
    ruleRows.forEach((y) => {
      const p = (y - y0) / lh;
      if (p > 0.28 && p < 0.72) strike = true;
      else if (p >= 0.72 && p <= 1.4) underline = true;
    });
    const x0 = t.left - own.left; const x1 = x0 + t.width;
    // slant: the shear that best stands the strokes upright (italic leans the
    // tops right) — the columns' ink is most peaked at that shear
    const peak = (k) => {
      const cols = new Map();
      for (let y = y0; y < y0 + lh; y += 1) {
        if (ruleRows.has(y)) continue;
        const shift = Math.round(k * (y0 + lh - y));
        for (let x = x0; x < x1; x += 1) if (mask[y * w + x]) cols.set(x - shift, (cols.get(x - shift) || 0) + 1);
      }
      let sq = 0;
      cols.forEach((c) => { sq += c * c; });
      return sq;
    };
    const upright = peak(0);
    if (upright > 0) {
      let best = 0; let bestK = 0;
      for (let k = -0.1; k <= 0.4001; k += 0.05) { const v = peak(k); if (v > best) { best = v; bestK = k; } }
      slants.push({ k: bestK, gain: best / upright, n: ink.inkCount });
    }
    // stroke widths across the middle of the letters, away from any rule
    for (let y = y0 + Math.floor(lh * 0.38); y < y0 + Math.ceil(lh * 0.62); y += 1) {
      if ([-2, -1, 0, 1, 2].some((d) => ruleRows.has(y + d))) continue;
      let run = 0;
      for (let x = x0; x <= x1; x += 1) {
        if (x < x1 && mask[y * w + x]) run += 1;
        else { if (run > 0 && run < lh * 0.5) strokes.push(run / lh); run = 0; }
      }
    }
  }
  strokes.sort((a, b) => a - b);
  // an all-caps line has no ascenders/descenders, so its box is only the cap
  // height (~0.72 of a mixed-case line) and every stroke reads thicker
  const caps = /[A-Z]/.test(text) && text === text.toUpperCase();
  const weight = (strokes.length ? strokes[Math.floor(strokes.length / 2)] : 0) * (caps ? 0.72 : 1);
  // the colour of the line with the most ink; the letters' box over all lines
  const main = reads.slice().sort((a, b) => b.inkCount - a.inkCount)[0];
  const tights = reads.map((r) => r.tight).filter(Boolean);
  const letters = tights.length ? (() => {
    const l = Math.min(...tights.map((t) => t.left)); const tp = Math.min(...tights.map((t) => t.top));
    const rr = Math.max(...tights.map((t) => t.left + t.width)); const bt = Math.max(...tights.map((t) => t.top + t.height));
    return pctBox({ left: (l / W) * 100, top: (tp / H) * 100, width: ((rr - l) / W) * 100, height: ((bt - tp) / H) * 100 });
  })() : null;
  // upright when the line with most of the ink stands best unsheared — then
  // it is not italic, whatever the model guessed. (A lean is not proof of
  // italic: rotated type leans too, so that call stays the model's.)
  const lean = slants.slice().sort((a, b) => b.n - a.n)[0];
  const upright = Boolean(lean && lean.n >= 300 && lean.k < 0.1);
  return { strike, underline, weight, upright, colour: main?.colour || '', letters };
}

const REGION_TOOL = {
  name: 'record_regions',
  description: 'Group the numbered line boxes into text blocks, and locate photographs.',
  input_schema: {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        description: 'One entry per text block (a headline, a paragraph, an eyebrow label, a CTA…), top to bottom. A multi-line headline or paragraph is ONE block.',
        items: {
          type: 'object',
          properties: {
            boxes: { type: 'array', items: { type: 'integer' }, description: 'The numbers of the boxes that make up this block.' },
            line: { type: 'integer', description: 'The number of the EXPECTED COPY line this block shows (0 when it is not in the list).' },
            text: { type: 'string', description: 'The words of this block exactly as they appear.' },
            style: {
              type: 'object',
              description: 'How MOST of this block is set, as you see it on the slide.',
              properties: {
                bold: { type: 'boolean', description: 'A heavy / bold weight.' },
                italic: { type: 'boolean', description: 'Italic or slanted letters.' },
                underline: { type: 'boolean', description: 'A line drawn under the words.' },
                strike: { type: 'boolean', description: 'A line drawn THROUGH the middle of the words.' },
                highlight: { type: 'string', description: 'Hex colour of a band / box painted behind the words, or "" when none.' },
                align: { type: 'string', enum: ['left', 'center', 'right'] },
              },
              required: ['bold', 'italic', 'underline', 'strike', 'highlight', 'align'],
            },
            runs: {
              type: 'array',
              description: 'Words set DIFFERENTLY from the rest of the block (e.g. one word in italic or another colour). Empty when the whole block is set alike.',
              items: {
                type: 'object',
                properties: {
                  words: { type: 'string', description: 'The words exactly as they appear in `text`.' },
                  bold: { type: 'boolean' },
                  italic: { type: 'boolean' },
                  underline: { type: 'boolean' },
                  strike: { type: 'boolean' },
                  color: { type: 'string', description: 'Hex colour of these letters.' },
                  highlight: { type: 'string', description: 'Hex colour behind these words, or "".' },
                },
                required: ['words'],
              },
            },
          },
          required: ['boxes', 'line', 'text', 'style', 'runs'],
        },
      },
      logo: {
        type: 'object',
        description: 'The brand logo / wordmark on the slide (percent of the slide, with the tag or sticker it sits on). Leave it out when there is none. A logo is NOT a text block and NOT a picture.',
        properties: { left: { type: 'number' }, top: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
      },
      pictures: {
        type: 'array',
        description: 'Photographs / illustrations (percent of the slide; not decorations, not the background, not the logo). Empty when none.',
        items: {
          type: 'object',
          properties: { left: { type: 'number' }, top: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
          required: ['left', 'top', 'width', 'height'],
        },
      },
    },
    required: ['blocks', 'pictures'],
  },
};
const regionSystem = (mark) => `You read an Instagram slide, given twice: as it is, and with numbered ${mark} boxes marking candidate lines of ink found on it. Group the boxes that are TEXT into text blocks — each block is one headline, one paragraph, one label or one CTA (a block usually spans several consecutive lines in the same style). Leave out boxes that are not text (doodles, underline swooshes, tape, leaves, photo edges, and the brand logo / wordmark — give that as logo). Match each block to the expected copy line it shows, and describe how it is set, judged on the clean image: bold = a heavy weight (thicker strokes than regular text); italic = slanted letters; underline = a rule below the baseline; strike = a rule crossing the letters at mid-height; highlight = a painted band or box of colour directly behind the words (paper, texture or the slide background is NOT a highlight; the ${mark} annotation boxes are NOT a highlight); alignment. Type may be set in any colour, including one close to the boxes — judge it on image 1. List words set differently from the rest of their block as runs. Also give the bounding boxes of any photographs (percent of the slide). Call record_regions.`;

/**
 * @param {{ buffer: Buffer, lines?: {role,text}[], photoBox?: {left,top,width,height}|null (pixels), key?: string }} p
 * @returns {Promise<{ key, texts: {id,role,text,box}[], images: {id,box}[], usage } | null>}
 */
// do two strings carry mostly the same words (spelling / punctuation aside)?
function sameWords(a, b) {
  const words = (t) => new Set(String(t || '').toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean));
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return !B.size;
  let both = 0;
  A.forEach((x) => { if (B.has(x)) both += 1; });
  return both / Math.max(A.size, B.size) >= 0.6;
}

async function mapRegions({ buffer, lines = [], photoBox = null, key = '' }) {
  const started = Date.now();
  const model = REGION_MODEL();
  try {
    const meta = await sharp(buffer).metadata();
    const W = Number(meta.width) || 1;
    const H = Number(meta.height) || 1;
    const known = photoBox && photoBox.width
      ? [pctBox({ left: (photoBox.left / W) * 100, top: (photoBox.top / H) * 100, width: (photoBox.width / W) * 100, height: (photoBox.height / H) * 100 })]
      : [];
    const cands = lineCandidates(await inkMap(buffer, known));
    const jpeg = await sharp(buffer).rotate().resize({ width: 1024, height: 1280, fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
    const marker = await pickMarker(jpeg);
    const REGION_SYSTEM = regionSystem(marker.name);
    const marked = await drawCandidates(jpeg, cands, marker);
    const expected = lines.length ? lines.map((l, i) => `${i + 1}. ${l.role}: ${JSON.stringify(l.text)}`).join('\n') : '(none given)';
    const userText = `There are ${cands.length} numbered boxes.\n\nEXPECTED COPY:\n${expected}`;
    const done = await completeToolCall({
      model,
      system: REGION_SYSTEM,
      userParts: [
        { type: 'text', text: 'Image 1 — the slide as it is (read the type styles and colours from THIS one):' },
        { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
        { type: 'text', text: `Image 2 — the same slide with our numbered ${marker.name} candidate boxes drawn on it (the ${marker.name} boxes and numbers are OUR annotations, not part of the design):` },
        { type: 'image', mediaType: 'image/jpeg', data: marked.toString('base64') },
        { type: 'text', text: userText },
      ],
      tool: REGION_TOOL,
      maxTokens: 1200,
      reasoningEffort: 'low',
      retryHint: 'Call record_regions with valid JSON.',
    });
    const p = done.parsed && typeof done.parsed === 'object' ? done.parsed : {};
    let pictures = (known.length ? known : (Array.isArray(p.pictures) ? p.pictures : []).map(pctBox))
      .filter((b) => b.width > 3 && b.height > 3);
    // the model's picture boxes are rough (round numbers, often over the text
    // beside them): tightened to the picture the pixels show
    if (!known.length) {
      pictures = await Promise.all(pictures.map(async (b) => {
        const blob = await pictureBlob(buffer, b).catch(() => null);
        return blob ? pctBox({ left: (blob.box.left / W) * 100, top: (blob.box.top / H) * 100, width: (blob.box.width / W) * 100, height: (blob.box.height / H) * 100 }) : b;
      }));
    }
    const images = pictures.map((b, n) => ({ id: `i${n + 1}`, box: round1(b) }));
    const lg = p.logo && typeof p.logo === 'object' ? pctBox(p.logo) : null;
    const logo = lg && lg.width > 1 && lg.height > 1 && lg.width < 60 && lg.height < 40 ? round1(lg) : null;
    const union = (list) => {
      const l = Math.min(...list.map((b) => b.left));
      const t = Math.min(...list.map((b) => b.top));
      return pctBox({ left: l, top: t, width: Math.max(...list.map((b) => b.left + b.width)) - l, height: Math.max(...list.map((b) => b.top + b.height)) - t });
    };
    // blocks of the same copy line join (a headline split in two by the model)
    const merged = [];
    (Array.isArray(p.blocks) ? p.blocks : []).forEach((b) => {
      const boxes = (Array.isArray(b.boxes) ? b.boxes : []).map((n) => cands[Number(n) - 1]).filter(Boolean);
      if (!boxes.length) return;
      const line = Number(b.line) || 0;
      const same = line > 0 && merged.find((m) => m.line === line);
      if (same) { same.boxes.push(...boxes); same.text = `${same.text} ${String(b.text || '').trim()}`; return; }
      merged.push({ line, boxes, text: String(b.text || '').trim(), style: b.style, runs: b.runs });
    });
    // a line the model left out right above / below a block, aligned with it
    // and of its size, is part of it (one word set apart in another colour)
    const used = new Set(merged.flatMap((m) => m.boxes));
    const lettery = new Map();
    await Promise.all(cands.filter((c) => !used.has(c) && c.width >= 4).map(async (c) => {
      lettery.set(c, await looksLikeLetters(buffer, c).catch(() => false));
    }));
    let grew = true;
    while (grew) {
      grew = false;
      cands.filter((c) => !used.has(c) && lettery.get(c)).forEach((c) => {
        const host = merged.find((m) => {
          const hs = m.boxes.map((x) => x.height).sort((a, b) => a - b);
          const lh = hs[Math.floor(hs.length / 2)];
          if (c.height < lh * 0.6 || c.height > lh * 1.6) return false;
          const u = union(m.boxes);
          const gap = c.top >= u.top + u.height ? c.top - (u.top + u.height) : u.top - (c.top + c.height);
          if (gap < 0 || gap > lh * 0.6) return false;
          const aligned = Math.abs(c.left - u.left) < 3 || Math.abs((c.left + c.width) - (u.left + u.width)) < 3
            || Math.abs((c.left + c.width / 2) - (u.left + u.width / 2)) < 3;
          return aligned && c.left >= u.left - 3 && c.left + c.width <= u.left + u.width + 3;
        });
        if (host) { host.boxes.push(c); used.add(c); grew = true; }
      });
    }
    const texts = (await Promise.all(merged
      .map(async (b, n) => {
        const line = lines[b.line - 1];
        // the colour, rules and weight are read off the pixels (the model's
        // hex is a guess, and it misses rules) — and the box is the letters'
        // (not the tape or doodles around them)
        const feat = await typeFeatures(buffer, b.boxes, String(line?.text || b.text)).catch(() => null);
        const box = feat?.letters || union(b.boxes);
        const color = feat?.colour || '';
        const st = cleanStyle(b.style);
        if (feat) {
          if (feat.upright) st.italic = false;
          st.strike = st.strike || feat.strike;
          st.underline = st.underline || feat.underline;
          if (feat.weight > 0) st.bold = feat.weight >= BOLD_WEIGHT;
          st.weight = Math.round(feat.weight * 1000) / 1000;
        }
        return {
          id: `t${n + 1}`,
          role: line?.role || 'text',
          // the copy's exact spelling when the block is that line — unless the
          // picture says other words (the copy predates a region edit)
          text: (line && sameWords(line.text, b.text) ? String(line.text) : String(b.text || line?.text || '')).trim(),
          box: round1(padBox(box, 0.8)),
          style: { ...st, color },
          runs: cleanRuns(b.runs),
        };
      })))
      .filter((t) => t.text);
    const i = Number(done.usage?.input_tokens || done.usage?.prompt_tokens) || 0;
    const o = Number(done.usage?.output_tokens || done.usage?.completion_tokens) || 0;
    return {
      key,
      v: REGIONS_V,
      texts,
      images,
      logo,
      model,
      usage: { inputTokens: i, outputTokens: o, totalTokens: i + o, estimatedCostUsd: (i * PRICE.in + o * PRICE.out) / 1e6, elapsedMs: Date.now() - started },
      // for the AI debug panel: exactly what the model saw and said
      debug: {
        prompt: `SYSTEM:\n${REGION_SYSTEM}\n\nUSER (image 1: the slide; image 2: the slide with ${cands.length} numbered candidate line boxes):\n${userText}`,
        output: JSON.stringify({ modelAnswer: p, regions: { texts, images, logo } }, null, 2),
        inputImage: marked,
      },
    };
  } catch (err) {
    console.warn(`[themeRegions] could not map regions: ${err.message}`);
    return null;
  }
}

// pixel rect of a percent box on a W×H picture
function pxBox(box, W, H) {
  const left = Math.max(0, Math.round((box.left / 100) * W));
  const top = Math.max(0, Math.round((box.top / 100) * H));
  return {
    left,
    top,
    width: Math.max(1, Math.min(W - left, Math.round((box.width / 100) * W))),
    height: Math.max(1, Math.min(H - top, Math.round((box.height / 100) * H))),
  };
}

// Put `patch` (same size as `base`) back into `base` inside `r` only, with a
// soft edge so no seam shows.
async function compositeRegion(base, patch, r) {
  const { width: W, height: H } = await sharp(base).metadata();
  const feather = Math.max(4, Math.round(Math.min(r.width, r.height) * 0.06));
  const cut = await sharp(patch).resize(W, H, { fit: 'fill' }).extract(r).removeAlpha().toBuffer();
  const inset = Math.min(feather, Math.floor(Math.min(r.width, r.height) / 4));
  const alphaSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}"><rect width="${r.width}" height="${r.height}" fill="#000"/><rect x="${inset}" y="${inset}" width="${Math.max(1, r.width - 2 * inset)}" height="${Math.max(1, r.height - 2 * inset)}" fill="#fff"/></svg>`;
  const alpha = await sharp(Buffer.from(alphaSvg)).blur(Math.max(0.3, inset / 2)).toColourspace('b-w').raw().toBuffer();
  const rgba = await sharp(cut).joinChannel(alpha, { raw: { width: r.width, height: r.height, channels: 1 } }).png().toBuffer();
  return sharp(base).composite([{ input: rgba, left: r.left, top: r.top }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
}

const where = (b) => `the area at left ${Math.round(b.left)}%, top ${Math.round(b.top)}%, ${Math.round(b.width)}% wide, ${Math.round(b.height)}% tall`;

// One change on its own — the same areas `repaintAreas` paints several of.
// marks: [{ id, words ('' = all of it), what (plain words, e.g. "bold") }];
// remove: take the text off and fill the background in.
function editText({ buffer, region, text, marks = [], remove = false }) {
  return repaintAreas(buffer, [textArea({ region, text, marks, remove })]);
}
// reference: a photo the studio gave (Editor › Generate from a reference) —
// the new picture follows its subject and look
function regenImage({ buffer, region, instruction, reference = null }) {
  const refs = reference?.length ? [reference] : [];
  return repaintAreas(buffer, [imageArea({ region, instruction, refImage: refs.length ? 2 : 0 })], refs);
}
// take the picture off: the area becomes the slide's background again
function eraseImage({ buffer, region }) {
  return repaintAreas(buffer, [eraseArea({ region })]);
}

async function placePhoto({ buffer, region, photo }) {
  const src = await sharp(buffer).rotate().jpeg({ quality: 94 }).toBuffer();
  const { width: W, height: H } = await sharp(src).metadata();
  const r = pxBox(region.box, W, H);
  const fitted = await sharp(photo).rotate().resize({ width: r.width, height: r.height, fit: 'cover', position: 'attention' }).toBuffer();
  const out = await sharp(src).composite([{ input: fitted, left: r.left, top: r.top }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { buffer: out, usage: null, model: '', debug: { prompt: '(no model call — the photo is fitted into the picture area and pasted in)', region: r } };
}

// The Editor's chat on a text region ("Make it shorter", a typed ask): new
// words for that block, written before the picture is re-lettered.
const REWRITE_TOOL = {
  name: 'rewrite_text',
  description: 'Return the rewritten words for the text block.',
  input_schema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The new words, exactly as they should appear on the slide.' } },
    required: ['text'],
  },
};
async function rewriteText({ text, role, instructions = [], context = '' }) {
  const asks = instructions.map((s) => String(s || '').trim()).filter(Boolean);
  if (!asks.length) return { text };
  const done = await completeToolCall({
    model: REGION_MODEL(),
    system: 'You rewrite one block of text on an Instagram carousel slide for a design studio. Follow every instruction. Keep the meaning and the studio\'s voice, keep it about as long unless told otherwise, and never add hashtags, emoji or quotation marks the original does not have. Call rewrite_text with the new words only.',
    userParts: [{
      type: 'text',
      text: [
        `Block (${role || 'text'}): ${JSON.stringify(text)}`,
        context ? `The rest of the slide says: ${JSON.stringify(context.slice(0, 600))}` : '',
        `Instructions:\n${asks.map((a) => `- ${a.slice(0, 300)}`).join('\n')}`,
      ].filter(Boolean).join('\n\n'),
    }],
    tool: REWRITE_TOOL,
    maxTokens: 400,
    reasoningEffort: 'low',
    retryHint: 'Call rewrite_text with valid JSON.',
  });
  const next = String(done.parsed?.text || '').trim().slice(0, 400);
  return { text: next || text };
}

/* ── Several areas in ONE image-model call ──────────────────────────────────
 * The Editor holds changes to several parts of a slide and sends them
 * together. Each change becomes an AREA — its box, how much padding the mask
 * gets, and what should happen inside it — and all of them are painted by a
 * single masked call (one transparent rect per area); each padded area is
 * then pasted back from that one output, so everything else stays
 * pixel-identical. One call instead of one per change: ~20 s and ~2¢ total. */
function textArea({ region, text, marks = [], remove = false }) {
  if (remove) {
    return {
      box: region.box,
      pad: 1.5,
      lines: [
        `It currently reads: ${JSON.stringify(region.text)}.`,
        'Remove those words completely. Repaint it as the background around it continues — the same texture, colour, light and any graphic that passes behind the words — so nothing shows that text was ever there.',
      ],
    };
  }
  const next = String(text || '').trim() || region.text;
  const changed = next !== region.text;
  const styled = (Array.isArray(marks) ? marks : [])
    .filter((m) => m && m.what)
    .map((m) => (m.words
      ? `- The words ${JSON.stringify(String(m.words).slice(0, 200))}: ${String(m.what).slice(0, 120)}.`
      : `- All of the text: ${String(m.what).slice(0, 120)}.`));
  return {
    box: region.box,
    pad: 1.5,
    lines: [
      `It currently reads: ${JSON.stringify(region.text)}.`,
      changed ? `Replace those words with exactly: ${JSON.stringify(next)}` : `Keep exactly those words: ${JSON.stringify(next)}`,
      ...(styled.length ? ['Set the lettering with these changes (everything not named keeps its current look):', ...styled] : []),
      `Otherwise match the original lettering exactly: the same typeface, ${styled.length ? '' : 'weight, '}size, letter spacing, case, colour and alignment. Repaint the background behind the words seamlessly (same texture and colour as around it).`,
      'If the new words are longer, wrap them onto more lines or make them slightly smaller so they stay inside the area. Spell every word exactly as given, with the same punctuation.',
    ],
  };
}
// refImage: the number of the reference photo among the inputs (0 = none)
function imageArea({ region, instruction = '', refImage = 0 }) {
  const brief = String(instruction || '').trim();
  return {
    box: region.box,
    pad: 0.5,
    lines: [
      'It holds the slide\'s picture.',
      refImage
        ? `Replace that picture with a new one based on the reference photo (Image ${refImage}): the same subject, mood, colours and kind of shot as the reference, framed to fill the area.${brief ? ` Also: ${brief}` : ''}`
        : brief
          ? `Replace that picture with: ${brief}`
          : 'Replace that picture with a fresh variation of the same subject — same framing, crop, lighting and style.',
      'Keep the picture\'s frame, border and position exactly; the picture fills the area edge to edge. No text, numbers or logos in the picture.',
    ],
  };
}
function eraseArea({ region }) {
  return {
    box: region.box,
    pad: 1.5,
    lines: [
      'It holds a photograph (with any frame, border, tape or shadow it sits in).',
      'Remove the photograph and everything that frames it. Paint the area as the slide\'s background continues around it — the same paper, texture, colour, light and any graphic that passes behind — so nothing shows a picture was ever there. Do not add any new object, text or picture.',
    ],
  };
}
// The brand logo, put on (or taken off) a Theme Apply picture by the image
// model — `box` is where the slide's logo sits (from the map) or the corner the
// Brand Kit places it in; `refImage` the input number of the logo file.
const LOGO_CORNERS = {
  'top-left': { left: 5, top: 4, width: 22, height: 9 },
  'top-right': { left: 73, top: 4, width: 22, height: 9 },
  'bottom-left': { left: 5, top: 87, width: 22, height: 9 },
  'bottom-right': { left: 73, top: 87, width: 22, height: 9 },
};
function logoBox(regions, position) {
  return (regions?.logo && regions.logo.width) ? regions.logo : (LOGO_CORNERS[position] || LOGO_CORNERS['top-left']);
}
function logoArea({ box, refImage = 0, remove = false, had = false }) {
  return {
    box,
    pad: 1,
    lines: remove
      ? [
        'It holds the brand logo (with any tag, sticker or paper it sits on).',
        'Remove the logo and what it sits on. Paint the area as the slide\'s background continues around it — the same paper, texture, colour and light — so nothing shows a logo was ever there. Do not add anything.',
      ]
      : [
        had ? 'It holds the slide\'s current brand logo.' : 'It is a corner of the slide where the brand logo goes.',
        `${had ? 'Replace that logo with' : 'Place'} the brand logo shown in Image ${refImage}, reproduced EXACTLY — the same mark, letterforms, spelling, colours and proportions; do not redraw, restyle or invent any part of it, and ignore the plain background around it in Image ${refImage}.`,
        'Set it the way this slide\'s design would carry a small logo (on a paper tag, sticker or straight on the ground — whatever suits the style), small and legible, inside the area. Nothing else changes.',
      ],
  };
}

// The whole slide in a Brand Kit colour set (Editor › Theme colour on a Theme
// Apply picture). `keep`: picture boxes (percent) the recolour must not touch —
// they are protected in the mask and pasted back from the original.
function recolourArea({ palette = {}, name = '', keep = [] }) {
  const hex = (v) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : '');
  return {
    whole: true,
    box: { left: 0, top: 0, width: 100, height: 100 },
    pad: 0,
    keep,
    lines: [
      `Recolour the slide into the colour set${name ? ` "${name}"` : ''}:`,
      ...(hex(palette.ground) ? [`- the background / paper / ground → ${hex(palette.ground)} (keep its texture, grain and light, only its colour changes)`] : []),
      ...(hex(palette.fg) ? [`- the main lettering and dark ink → ${hex(palette.fg)}`] : []),
      ...(hex(palette.accent) ? [`- accents — emphasised words, highlights, shapes, tape, doodles, rules and badges → ${hex(palette.accent)}`] : []),
      'Keep everything else exactly as it is: the layout and every position, every word and its spelling, the typefaces, sizes and weights, all textures and shadows. Photographs keep their own colours and stay exactly where they are.',
    ],
  };
}

async function repaintAreas(buffer, areas, references = []) {
  const src = await sharp(buffer).rotate().jpeg({ quality: 94 }).toBuffer();
  const { width: W, height: H } = await sharp(src).metadata();
  const rects = areas.map((a) => pxBox(padBox(a.box, a.pad), W, H));
  // A whole-slide area (recolour) goes WITHOUT a mask: the model hides what
  // sits under a transparent mask (measured — a full-slide mask came back
  // black with only the protected photo recoloured), so it has to see the
  // whole slide; the pictures it keeps are pasted back from the original.
  const whole = areas.find((a) => a.whole);
  const holes = rects.map((r) => `<rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="#000" fill-opacity="0"/>`).join('');
  const mask = whole ? null : await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/>${holes}</svg>`)).png().toBuffer();
  const refs = await Promise.all(references.map(async (b, i) => ({
    // (a transparent logo would turn black in a jpeg — set it on white)
    buffer: await sharp(b, { density: 300 }).rotate().flatten({ background: '#ffffff' }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer(),
    mediaType: 'image/jpeg',
    name: `reference-${i + 1}`,
  })));
  const one = areas.length === 1;
  const prompt = [
    one
      ? (areas[0].whole
        ? 'Edit this Instagram slide (Image 1) as described. Return the whole slide.'
        : `Edit ONLY the transparent (masked) area of this Instagram slide (Image 1) — ${where(areas[0].box)}.`)
      : `Edit ONLY the ${areas.length} transparent (masked) areas of this Instagram slide (Image 1). Change each exactly as described under its number, and nothing else:`,
    ...(one ? areas[0].lines : areas.flatMap((a, i) => ['', `AREA ${i + 1} — ${a.whole ? 'the whole slide (apply this first; the numbered areas after it are changed on top of it)' : where(a.box)}:`, ...a.lines])),
    '',
    one ? 'Change nothing outside the area.' : 'Each area keeps its own content — never move words or pictures between areas. Change nothing outside the areas.',
  ].join('\n');
  const size = W / H > 0.95 ? '1024x1024' : '1024x1280';
  const r = await composeImage({
    images: [{ buffer: src, mediaType: 'image/jpeg', name: 'slide' }, ...refs],
    mask: mask ? { buffer: mask, mediaType: 'image/png' } : null,
    prompt,
    size,
    model: EDIT_MODEL(),
    quality: process.env.OPENAI_THEME_IMAGE_QUALITY || 'medium',
  });
  let out = src;
  if (whole) {
    // the model's whole picture, then the kept photographs back from the original
    out = await sharp(r.buffer).resize(W, H, { fit: 'fill' }).jpeg({ quality: 94 }).toBuffer();
    // only the picture's own pixels go back (a loose box would bring the old
    // ground and words around it back too), with a soft edge
    const pieces = await Promise.all((whole.keep || []).map(async (b) => {
      const blob = await pictureBlob(src, b).catch(() => null);
      if (!blob) return null;
      const r = blob.rect;
      const alpha = await sharp(blob.alpha, { raw: { width: r.width, height: r.height, channels: 1 } }).blur(1.2).raw().toBuffer();
      const rgb = await sharp(src).extract(r).removeAlpha().raw().toBuffer();
      const input = await sharp(rgb, { raw: { width: r.width, height: r.height, channels: 3 } }).joinChannel(alpha, { raw: { width: r.width, height: r.height, channels: 1 } }).png().toBuffer();
      return { input, left: r.left, top: r.top };
    })).then((list) => list.filter(Boolean));
    if (pieces.length) out = await sharp(out).composite(pieces).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  } else {
    for (const rect of rects) out = await compositeRegion(out, r.buffer, rect); // eslint-disable-line no-await-in-loop
  }
  return {
    buffer: out,
    usage: { ...(r.usage || {}), estimatedCostUsd: r.estimatedCostUsd, elapsedMs: r.elapsedMs },
    model: `${r.model} · ${r.quality}`,
    debug: { prompt, raw: r.buffer, regions: rects, size },
  };
}

module.exports = { mapRegions, sameWords, logoArea, logoBox, editText, regenImage, eraseImage, placePhoto, rewriteText, REGIONS_V, typeFeatures, textArea, imageArea, eraseArea, recolourArea, repaintAreas };
