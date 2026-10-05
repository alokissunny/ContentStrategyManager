/*
 * Keep the slide's primary photo exactly as it is through Theme Apply.
 *
 * The image model redraws anything it is shown, so it is not asked to keep the
 * photo — it is asked to leave a flat magenta (#FF00FF) placeholder where the
 * photo goes, framed in the theme's manner. This file finds that placeholder in
 * the render and pastes the ORIGINAL photo into it: only scaled and cropped to
 * the placeholder's box (cover fit), never redrawn or recoloured.
 */

const sharp = require('sharp');

const PLACEHOLDER_HEX = '#FF00FF';
// A slide that is itself magenta / pink would hide a magenta placeholder in its
// own ground — a re-arrangement (themeRegions relayout) picks the key colour
// the slide uses least (see pickPlaceholder).
const PLACEHOLDERS = {
  magenta: { hex: '#FF00FF', name: 'pure magenta', lo: 285, hi: 345 },
  green: { hex: '#00FF00', name: 'pure green', lo: 95, hi: 145 },
  cyan: { hex: '#00FFFF', name: 'pure cyan', lo: 170, hi: 200 },
};

// A pixel of the placeholder. The model never paints exact #FF00FF — it came
// back as hot pink rgb(252, 49, 164) — so match by hue: a strong, bright
// magenta-to-pink (hue 285°–345°). Skin, reds and pale pinks fall outside.
function isMagenta(r, g, b, lo = 285, hi = 345) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (max < 140 || d / max < 0.55) return false; // bright and saturated
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h >= lo && h <= hi;
}

// the placeholder colour this picture uses least (share of its pixels)
async function pickPlaceholder(buffer) {
  const data = await sharp(buffer).rotate().resize({ width: 128, height: 160, fit: 'fill' }).removeAlpha().raw().toBuffer();
  let best = null;
  Object.entries(PLACEHOLDERS).forEach(([id, ph]) => {
    let n = 0;
    for (let i = 0; i < data.length; i += 3) if (isMagenta(data[i], data[i + 1], data[i + 2], ph.lo, ph.hi)) n += 1;
    if (!best || n < best.n) best = { id, n };
  });
  return best.id;
}

/**
 * Find the placeholder: the largest connected magenta region.
 * @returns {Promise<{ left, top, width, height, fill } | null>} in pixels of `buffer`
 */
async function findPlaceholder(buffer, kind = 'magenta') {
  const ph = PLACEHOLDERS[kind] || PLACEHOLDERS.magenta;
  const img = sharp(buffer).rotate();
  const { width: W, height: H } = await img.metadata();
  const w = 256;
  const h = Math.round((256 * H) / W);
  const data = await img.clone().resize({ width: w, height: h, fit: 'fill' }).removeAlpha().raw().toBuffer();
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    if (isMagenta(data[i * 3], data[i * 3 + 1], data[i * 3 + 2], ph.lo, ph.hi)) mask[i] = 1;
  }
  // connected components (4-way), keep the largest
  const seen = new Uint8Array(w * h);
  let best = null;
  const stack = [];
  for (let start = 0; start < w * h; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let n = 0;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      const y = (p - x) / w;
      n += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([nx, ny]) => {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const q = ny * w + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      });
    }
    if (!best || n > best.n) best = { n, x0, y0, x1, y1 };
  }
  if (!best) return null;
  const bw = best.x1 - best.x0 + 1;
  const bh = best.y1 - best.y0 + 1;
  // too small to be the photo's place, or not box-shaped
  if (best.n < w * h * 0.02 || best.n / (bw * bh) < 0.6) return null;
  const sx = W / w;
  const sy = H / h;
  return {
    left: Math.round(best.x0 * sx),
    top: Math.round(best.y0 * sy),
    width: Math.round(bw * sx),
    height: Math.round(bh * sy),
    fill: best.n / (bw * bh),
  };
}

/**
 * Paste the original photo into the render's placeholder.
 * @returns {Promise<{ buffer: Buffer, box: object|null, found: boolean }>}
 */
async function pastePrimaryImage(renderBuffer, photoBuffer, kind = 'magenta') {
  const box = await findPlaceholder(renderBuffer, kind);
  if (!box) return { buffer: renderBuffer, box: null, found: false };
  const { width: W, height: H } = await sharp(renderBuffer).metadata();
  // grow a hair past the edge so no magenta fringe survives
  const pad = Math.max(2, Math.round(Math.min(W, H) * 0.006));
  const left = Math.max(0, box.left - pad);
  const top = Math.max(0, box.top - pad);
  const width = Math.min(W - left, box.width + 2 * pad);
  const height = Math.min(H - top, box.height + 2 * pad);
  const photo = await sharp(photoBuffer).rotate()
    .resize({ width, height, fit: 'cover', position: 'attention' })
    .toBuffer();
  const buffer = await sharp(renderBuffer).composite([{ input: photo, left, top }]).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return { buffer, box: { left, top, width, height, fill: box.fill }, found: true };
}

module.exports = { findPlaceholder, pastePrimaryImage, pickPlaceholder, PLACEHOLDER_HEX, PLACEHOLDERS };
