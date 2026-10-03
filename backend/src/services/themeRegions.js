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
          },
          required: ['boxes', 'line', 'text'],
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
const REGION_SYSTEM = 'You read an Instagram slide. Numbered blue boxes mark candidate lines of ink found on it. Group the boxes that are TEXT into text blocks — each block is one headline, one paragraph, one label or one CTA (a block usually spans several consecutive lines in the same style). Leave out boxes that are not text (doodles, underline swooshes, tape, leaves, photo edges). Match each block to the expected copy line it shows. Also give the bounding boxes of any photographs (percent of the slide). Call record_regions.';

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
      merged.push({ line, boxes, text: String(b.text || '').trim() });
    });
    const texts = merged
      .map((b, n) => {
        const line = lines[b.line - 1];
        return {
          id: `t${n + 1}`,
          role: line?.role || 'text',
          // the copy's exact spelling when the block is that line
          text: String(line?.text || b.text).trim(),
          box: round1(padBox(union(b.boxes), 0.8)),
        };
      })
      .filter((t) => t.text);
    const i = Number(done.usage?.input_tokens || done.usage?.prompt_tokens) || 0;
    const o = Number(done.usage?.output_tokens || done.usage?.completion_tokens) || 0;
    return {
      key,
      texts,
      images,
      model,
      usage: { inputTokens: i, outputTokens: o, totalTokens: i + o, estimatedCostUsd: (i * PRICE.in + o * PRICE.out) / 1e6, elapsedMs: Date.now() - started },
      // for the AI debug panel: exactly what the model saw and said
      debug: {
        prompt: `SYSTEM:\n${REGION_SYSTEM}\n\nUSER (image: the slide with ${cands.length} numbered candidate line boxes):\n${userText}`,
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

module.exports = { mapRegions, editText, regenImage, placePhoto };
