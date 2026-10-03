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
  return { mask, w, h };
}

// candidate line boxes (percent), top to bottom
function lineCandidates({ mask, w, h }) {
  const rowCount = (y) => { let c = 0; for (let x = 0; x < w; x += 1) c += mask[y * w + x]; return c; };
  const runs = [];
  let start = -1;
  for (let y = 0; y < h; y += 1) {
    const on = rowCount(y) >= 2;
    if (on && start < 0) start = y;
    if (!on && start >= 0) { runs.push([start, y - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, h - 1]);
  const gapCols = Math.round(w * 0.05);
  const out = [];
  runs.forEach(([y0, y1]) => {
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

async function drawCandidates(jpeg, cands) {
  const { width: W, height: H } = await sharp(jpeg).metadata();
  const marks = cands.map((b, n) => {
    const x = (b.left / 100) * W;
    const y = (b.top / 100) * H;
    const bw = (b.width / 100) * W;
    const bh = (b.height / 100) * H;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="none" stroke="#00b7ff" stroke-width="2"/>`
      + `<rect x="${Math.max(0, x - 26)}" y="${y}" width="24" height="18" fill="#00b7ff"/>`
      + `<text x="${Math.max(0, x - 25)}" y="${y + 14}" font-size="14" font-family="sans-serif" font-weight="700" fill="#fff">${n + 1}</text>`;
  }).join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${marks}</svg>`);
  return sharp(jpeg).composite([{ input: svg, left: 0, top: 0 }]).jpeg({ quality: 88 }).toBuffer();
}

// v2: text blocks carry `style` {bold, italic, underline, strike, color,
// highlight, align} and `runs` [{words, …the same}] — older maps are re-read
const REGIONS_V = 3;
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
async function inkColour(buffer, box) {
  const src = sharp(buffer).rotate();
  const { width: W, height: H } = await src.metadata();
  const r = pxBox(box, W, H);
  const cut = await sharp(buffer).rotate().extract(r).resize({ width: Math.min(320, r.width) }).removeAlpha().toBuffer();
  const { data, info } = await sharp(cut).raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height * 3;
  const bucketOf = (skip) => {
    const buckets = new Map();
    for (let i = 0; i < n; i += 3) {
      if (skip(i)) continue;
      const k = `${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`;
      const b = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
      b.n += 1; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2];
      buckets.set(k, b);
    }
    let top = null;
    buckets.forEach((b) => { if (!top || b.n > top.n) top = b; });
    return top;
  };
  // the paper is the commonest colour in the block's box; ink stands well off it
  const paper = bucketOf(() => false);
  if (!paper) return '';
  const pr = paper.r / paper.n; const pg = paper.g / paper.n; const pb = paper.b / paper.n;
  const top = bucketOf((i) => Math.hypot(data[i] - pr, data[i + 1] - pg, data[i + 2] - pb) <= 80);
  if (!top || top.n < 12) return '';
  const hex = (v) => Math.round(v / top.n).toString(16).padStart(2, '0');
  return `#${hex(top.r)}${hex(top.g)}${hex(top.b)}`;
}

// What the pixels say about how a block is set — the model misses rules and
// weight often enough that these are measured: a strike is a rule crossing a
// text line at mid-height, an underline one at or just under its foot (or a
// thin rule-only line under it), and weight is the stroke thickness against
// the line's height. `lineBoxes` are the block's candidate lines (percent).
async function typeFeatures(buffer, lineBoxes, text = '') {
  const { width: W, height: H } = await sharp(buffer).rotate().metadata();
  const heights = lineBoxes.map((b) => (b.height / 100) * H).sort((a, b) => a - b);
  const textH = heights[Math.floor(heights.length / 2)] || 1;
  let strike = false;
  let underline = false;
  const strokes = [];
  for (const b of lineBoxes) {
    const own = pxBox(b, W, H);
    // look a little under the line too, where an underline sits
    const r = { ...own, height: Math.max(1, Math.min(H - own.top, Math.round(own.height * 1.4))) };
    // eslint-disable-next-line no-await-in-loop
    const { data, info } = await sharp(buffer).rotate().extract(r).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width; const h = info.height;
    // paper = the commonest colour of this strip
    const counts = new Map();
    for (let i = 0; i < w * h * 3; i += 3) {
      const k = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`;
      const c = counts.get(k) || [0, 0, 0, 0];
      c[0] += 1; c[1] += data[i]; c[2] += data[i + 1]; c[3] += data[i + 2];
      counts.set(k, c);
    }
    let paper = null;
    counts.forEach((c) => { if (!paper || c[0] > paper[0]) paper = c; });
    const [pn, pr, pg, pb] = paper;
    const ink = (x, y) => {
      const i = (y * w + x) * 3;
      return Math.hypot(data[i] - pr / pn, data[i + 1] - pg / pn, data[i + 2] - pb / pn) > 80;
    };
    const thinRule = own.height < textH * 0.4;
    const ruleRows = new Set();
    for (let y = 0; y < h; y += 1) {
      let best = 0; let run = 0; let gap = 0;
      for (let x = 0; x < w; x += 1) {
        if (ink(x, y)) { run += 1 + gap; gap = 0; } else if (run && gap < 2) gap += 1; else { run = 0; gap = 0; }
        if (run > best) best = run;
      }
      if (best >= w * 0.6) ruleRows.add(y);
    }
    if (thinRule) { if (ruleRows.size) underline = true; continue; }
    ruleRows.forEach((y) => {
      const p = y / own.height;
      if (p > 0.28 && p < 0.72) strike = true;
      else if (p >= 0.72) underline = true;
    });
    // stroke widths across the middle of the letters, away from any rule
    for (let y = Math.floor(own.height * 0.38); y < Math.ceil(own.height * 0.62); y += 1) {
      if ([-2, -1, 0, 1, 2].some((d) => ruleRows.has(y + d))) continue;
      let run = 0;
      for (let x = 0; x <= w; x += 1) {
        if (x < w && ink(x, y)) run += 1;
        else { if (run > 0 && run < own.height * 0.5) strokes.push(run / own.height); run = 0; }
      }
    }
  }
  strokes.sort((a, b) => a - b);
  // an all-caps line has no ascenders/descenders, so its box is only the cap
  // height (~0.72 of a mixed-case line) and every stroke reads thicker
  const caps = /[A-Z]/.test(text) && text === text.toUpperCase();
  const weight = (strokes.length ? strokes[Math.floor(strokes.length / 2)] : 0) * (caps ? 0.72 : 1);
  return { strike, underline, weight };
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
            boxes: { type: 'array', items: { type: 'integer' }, description: 'The numbers of the blue boxes that make up this block.' },
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
      pictures: {
        type: 'array',
        description: 'Photographs / illustrations (percent of the slide; not decorations, not the background). Empty when none.',
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
const REGION_SYSTEM = 'You read an Instagram slide, given twice: as it is, and with numbered blue boxes marking candidate lines of ink found on it. Group the boxes that are TEXT into text blocks — each block is one headline, one paragraph, one label or one CTA (a block usually spans several consecutive lines in the same style). Leave out boxes that are not text (doodles, underline swooshes, tape, leaves, photo edges). Match each block to the expected copy line it shows, and describe how it is set, judged on the clean image: bold = a heavy weight (thicker strokes than regular text); italic = slanted letters; underline = a rule below the baseline; strike = a rule crossing the letters at mid-height; highlight = a painted band or box of colour directly behind the words (paper, texture or the slide background is NOT a highlight; the blue annotation boxes are NOT a highlight); alignment. List words set differently from the rest of their block as runs. Also give the bounding boxes of any photographs (percent of the slide). Call record_regions.';

/**
 * @param {{ buffer: Buffer, lines?: {role,text}[], photoBox?: {left,top,width,height}|null (pixels), key?: string }} p
 * @returns {Promise<{ key, texts: {id,role,text,box}[], images: {id,box}[], usage } | null>}
 */
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
    const marked = await drawCandidates(jpeg, cands);
    const expected = lines.length ? lines.map((l, i) => `${i + 1}. ${l.role}: ${JSON.stringify(l.text)}`).join('\n') : '(none given)';
    const userText = `There are ${cands.length} numbered boxes.\n\nEXPECTED COPY:\n${expected}`;
    const done = await completeToolCall({
      model,
      system: REGION_SYSTEM,
      userParts: [
        { type: 'text', text: 'Image 1 — the slide as it is (read the type styles and colours from THIS one):' },
        { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
        { type: 'text', text: 'Image 2 — the same slide with our numbered blue candidate boxes drawn on it (the blue boxes and numbers are OUR annotations, not part of the design):' },
        { type: 'image', mediaType: 'image/jpeg', data: marked.toString('base64') },
        { type: 'text', text: userText },
      ],
      tool: REGION_TOOL,
      maxTokens: 1200,
      reasoningEffort: 'low',
      retryHint: 'Call record_regions with valid JSON.',
    });
    const p = done.parsed && typeof done.parsed === 'object' ? done.parsed : {};
    const pictures = (known.length ? known : (Array.isArray(p.pictures) ? p.pictures : []).map(pctBox))
      .filter((b) => b.width > 3 && b.height > 3);
    const images = pictures.map((b, n) => ({ id: `i${n + 1}`, box: round1(b) }));
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
    const texts = (await Promise.all(merged
      .map(async (b, n) => {
        const line = lines[b.line - 1];
        const box = union(b.boxes);
        // the colour, rules and weight are read off the pixels (the model's
        // hex is a guess, and it misses rules)
        const color = await inkColour(buffer, box).catch(() => '');
        const feat = await typeFeatures(buffer, b.boxes, String(line?.text || b.text)).catch(() => null);
        const st = cleanStyle(b.style);
        if (feat) {
          st.strike = st.strike || feat.strike;
          st.underline = st.underline || feat.underline;
          if (feat.weight > 0) st.bold = feat.weight >= BOLD_WEIGHT;
          st.weight = Math.round(feat.weight * 1000) / 1000;
        }
        return {
          id: `t${n + 1}`,
          role: line?.role || 'text',
          // the copy's exact spelling when the block is that line
          text: String(line?.text || b.text).trim(),
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
      model,
      usage: { inputTokens: i, outputTokens: o, totalTokens: i + o, estimatedCostUsd: (i * PRICE.in + o * PRICE.out) / 1e6, elapsedMs: Date.now() - started },
      // for the AI debug panel: exactly what the model saw and said
      debug: {
        prompt: `SYSTEM:\n${REGION_SYSTEM}\n\nUSER (image 1: the slide; image 2: the slide with ${cands.length} numbered candidate line boxes):\n${userText}`,
        output: JSON.stringify({ modelAnswer: p, regions: { texts, images } }, null, 2),
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

// the edit mask the image model reads: opaque everywhere, transparent in the region
async function editMask(W, H, r) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/><rect x="${r.left}" y="${r.top}" width="${r.width}" height="${r.height}" fill="#000" fill-opacity="0"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
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

// one image-model pass over the whole render (mask when the model takes it),
// kept only inside the region
async function repaintRegion(buffer, box, prompt, padPct = 2) {
  const src = await sharp(buffer).rotate().jpeg({ quality: 94 }).toBuffer();
  const { width: W, height: H } = await sharp(src).metadata();
  const region = pxBox(padBox(box, padPct), W, H);
  const mask = await editMask(W, H, region);
  const size = W / H > 0.95 ? '1024x1024' : '1024x1280';
  const r = await composeImage({
    images: [{ buffer: src, mediaType: 'image/jpeg', name: 'slide' }],
    mask: { buffer: mask, mediaType: 'image/png' },
    prompt,
    size,
    model: EDIT_MODEL(),
    quality: process.env.OPENAI_THEME_IMAGE_QUALITY || 'medium',
  });
  const out = await compositeRegion(src, r.buffer, region);
  return {
    buffer: out,
    usage: { ...(r.usage || {}), estimatedCostUsd: r.estimatedCostUsd, elapsedMs: r.elapsedMs },
    model: `${r.model} · ${r.quality}`,
    // for the AI debug panel: the prompt, the model's own picture (before only
    // the region was kept) and the region it was kept inside (px)
    debug: { prompt, raw: r.buffer, region, size },
  };
}

const where = (b) => `the area at left ${Math.round(b.left)}%, top ${Math.round(b.top)}%, ${Math.round(b.width)}% wide, ${Math.round(b.height)}% tall`;

// marks: [{ id, words ('' = all of it), what (plain words, e.g. "bold",
// "in the colour #d2e823") }] from the Editor's text panel; remove: take the
// text off and fill the background in.
async function editText({ buffer, region, text, marks = [], remove = false }) {
  if (remove) {
    const prompt = [
      `Edit ONLY the transparent (masked) area of this Instagram slide — ${where(region.box)}.`,
      `It currently reads: ${JSON.stringify(region.text)}.`,
      'Remove those words completely. Repaint the area as the background around it continues — the same texture, colour, light and any graphic that passes behind the words — so nothing shows that text was ever there.',
      'Change nothing outside the area.',
    ].join('\n');
    return repaintRegion(buffer, region.box, prompt, 1.5);
  }
  const next = String(text || '').trim() || region.text;
  const changed = next !== region.text;
  const styled = (Array.isArray(marks) ? marks : [])
    .filter((m) => m && m.what)
    .map((m) => (m.words
      ? `- The words ${JSON.stringify(String(m.words).slice(0, 200))}: ${String(m.what).slice(0, 120)}.`
      : `- All of the text: ${String(m.what).slice(0, 120)}.`));
  const prompt = [
    `Edit ONLY the transparent (masked) area of this Instagram slide — ${where(region.box)}.`,
    `It currently reads: ${JSON.stringify(region.text)}.`,
    changed ? `Replace those words with exactly: ${JSON.stringify(next)}` : `Keep exactly those words: ${JSON.stringify(next)}`,
    ...(styled.length ? ['Set the lettering with these changes (everything not named keeps its current look):', ...styled] : []),
    `Otherwise match the original lettering exactly: the same typeface, ${styled.length ? '' : 'weight, '}size, letter spacing, case, colour and alignment. Repaint the background behind the words seamlessly (same texture and colour as around it).`,
    'If the new words are longer, wrap them onto more lines or make them slightly smaller so they stay inside the area. Spell every word exactly as given, with the same punctuation.',
    'Change nothing outside the area.',
  ].join('\n');
  return repaintRegion(buffer, region.box, prompt, 1.5);
}

async function regenImage({ buffer, region, instruction }) {
  const brief = String(instruction || '').trim();
  const prompt = [
    `Edit ONLY the transparent (masked) area of this Instagram slide — ${where(region.box)}. It holds the slide's picture.`,
    brief
      ? `Replace that picture with: ${brief}`
      : 'Replace that picture with a fresh variation of the same subject — same framing, crop, lighting and style.',
    'Keep the picture\'s frame, border and position exactly; the picture fills the area edge to edge. No text, numbers or logos in the picture.',
    'Change nothing outside the area.',
  ].join('\n');
  return repaintRegion(buffer, region.box, prompt, 0.5);
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

module.exports = { mapRegions, editText, regenImage, placePhoto, rewriteText, REGIONS_V, typeFeatures };
