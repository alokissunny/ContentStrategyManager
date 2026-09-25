/*
 * Reference Extractor agent — Change theme › Upload a reference.
 *
 * Reads the studio's uploaded reference photo with a vision model and pulls out
 * its design elements (palette with roles, type feel, textures, lighting,
 * composition, graphic motifs, image treatment, mood, avoid-list). The result
 * is handed to the Carousel agent alongside the reference theme so it can
 * adapt the post to the new look. Unlike imageAnalysis.analyzeImageAsset()
 * (content-library metadata: subjects, tags), this extracts a design system.
 *
 * It also lifts the photo's artwork (illustrations, stickers, doodles, icons…):
 * the model boxes each piece, we crop it out, key a plain background to
 * transparent, and store it as a PNG. The carousel agent places them with
 * `src="artwork:<id>"` tokens that resolveArtworkTokens() swaps for real URLs.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { completeToolCall } = require('./llmComplete');
const { getObjectBytes, uploadBytes, getMediaUrl } = require('./s3Client');
const { toVisionImage } = require('./visionImage');
const { boxOf } = require('./subjectBox');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'reference-extractor.md');

let promptCache = null;
function loadPrompt() {
  if (!promptCache) promptCache = fs.readFileSync(PROMPT_PATH, 'utf8');
  return promptCache;
}

const ARTWORK_KINDS = ['illustration', 'sticker', 'doodle', 'icon', 'ornament', 'shape', 'pattern'];
const MAX_ARTWORK = 6;
const ARTWORK_MAX_PX = 800;
// Box padding (percent of the image) so a tight box doesn't clip strokes.
const ARTWORK_PAD = 1.5;

const TYPE_STYLE = {
  type: 'object',
  properties: {
    style: { type: 'string' },
    suggestedFonts: { type: 'array', items: { type: 'string' } },
    weight: { type: 'string' },
    case: { type: 'string' },
    tracking: { type: 'string' },
  },
  required: ['style', 'suggestedFonts'],
};

const EXTRACT_TOOL = {
  name: 'record_reference_elements',
  description: 'Record the visual design elements extracted from the reference image.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One sentence naming the overall aesthetic' },
      palette: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            hex: { type: 'string', description: '#RRGGBB' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['background', 'surface', 'ink', 'accent', 'highlight', 'muted'] },
          },
          required: ['hex', 'role'],
        },
      },
      typography: {
        type: 'object',
        properties: { display: TYPE_STYLE, body: TYPE_STYLE },
        required: ['display', 'body'],
      },
      textures: { type: 'array', items: { type: 'string' } },
      lighting: { type: 'string' },
      composition: {
        type: 'object',
        properties: {
          layout: { type: 'string' },
          negativeSpace: { type: 'string' },
          alignment: { type: 'string' },
          density: { type: 'string' },
          focalStrategy: { type: 'string' },
        },
      },
      graphicElements: { type: 'array', items: { type: 'string' } },
      imageTreatment: { type: 'string' },
      mood: { type: 'array', items: { type: 'string' } },
      avoid: { type: 'array', items: { type: 'string' } },
      artwork: {
        type: 'array',
        description: 'Liftable graphic artwork (not the photo subject, people, text or logos)',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            kind: { type: 'string', enum: ARTWORK_KINDS },
            description: { type: 'string' },
            box: {
              type: 'object',
              properties: {
                x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
              },
              required: ['x', 'y', 'w', 'h'],
            },
            background: { type: 'string', enum: ['plain', 'busy'] },
            usage: { type: 'string' },
          },
          required: ['id', 'name', 'kind', 'box', 'background'],
        },
      },
    },
    required: ['summary', 'palette', 'typography', 'textures', 'lighting', 'composition', 'graphicElements', 'imageTreatment', 'mood', 'avoid', 'artwork'],
  },
};

const str = (v) => String(v ?? '').trim();
const strList = (v, max = 10) =>
  (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);
const HEX = /^#?[0-9a-f]{6}$/i;

function normalizeTypeStyle(t) {
  const o = t && typeof t === 'object' ? t : {};
  return {
    style: str(o.style),
    suggestedFonts: strList(o.suggestedFonts, 3),
    weight: str(o.weight),
    case: str(o.case),
    tracking: str(o.tracking),
  };
}

function normalizeElements(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const comp = p.composition && typeof p.composition === 'object' ? p.composition : {};
  return {
    summary: str(p.summary),
    palette: (Array.isArray(p.palette) ? p.palette : [])
      .filter((c) => c && HEX.test(str(c.hex)))
      .slice(0, 8)
      .map((c) => ({
        hex: `#${str(c.hex).replace('#', '').toUpperCase()}`,
        name: str(c.name),
        role: str(c.role) || 'accent',
      })),
    typography: {
      display: normalizeTypeStyle(p.typography?.display),
      body: normalizeTypeStyle(p.typography?.body),
    },
    textures: strList(p.textures),
    lighting: str(p.lighting),
    composition: {
      layout: str(comp.layout),
      negativeSpace: str(comp.negativeSpace),
      alignment: str(comp.alignment),
      density: str(comp.density),
      focalStrategy: str(comp.focalStrategy),
    },
    graphicElements: strList(p.graphicElements),
    imageTreatment: str(p.imageTreatment),
    mood: strList(p.mood, 6),
    avoid: strList(p.avoid, 6),
    artwork: normalizeArtwork(p.artwork),
  };
}

const slugOf = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function normalizeArtwork(list) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a !== 'object') continue;
    const box = boxOf(a.box);
    if (!box || box.w < 3 || box.h < 3) continue; // too small to crop usefully
    let id = slugOf(a.id || a.name) || `art-${out.length + 1}`;
    while (seen.has(id)) id = `${id}-${out.length + 1}`;
    seen.add(id);
    out.push({
      id,
      name: str(a.name) || id,
      kind: ARTWORK_KINDS.includes(str(a.kind)) ? str(a.kind) : 'illustration',
      description: str(a.description),
      box,
      background: str(a.background) === 'plain' ? 'plain' : 'busy',
      usage: str(a.usage),
    });
    if (out.length >= MAX_ARTWORK) break;
  }
  return out;
}

// Key a flat background to transparent: average the crop's border pixels; if
// the border is near-uniform, fade pixels close to that colour to alpha 0
// (soft edge so anti-aliased strokes don't get a halo). Returns null when the
// border is too varied to key cleanly — the crop is then used as-is.
function knockoutBackground(data, width, height) {
  const px = (x, y) => (y * width + x) * 4;
  const border = [];
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));
  for (let x = 0; x < width; x += stepX) { border.push(px(x, 0), px(x, height - 1)); }
  for (let y = 0; y < height; y += stepY) { border.push(px(0, y), px(width - 1, y)); }
  const mean = [0, 0, 0];
  border.forEach((i) => { mean[0] += data[i]; mean[1] += data[i + 1]; mean[2] += data[i + 2]; });
  mean.forEach((_, c) => { mean[c] /= border.length; });
  const dist = (i) => Math.hypot(data[i] - mean[0], data[i + 1] - mean[1], data[i + 2] - mean[2]);
  const spread = border.reduce((sum, i) => sum + dist(i), 0) / border.length;
  if (spread > 18) return null;
  const hard = Math.max(24, spread * 2.2);
  const soft = hard + 36;
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const d = dist(i);
    if (d <= hard) out[i + 3] = 0;
    else if (d < soft) out[i + 3] = Math.round(out[i + 3] * ((d - hard) / (soft - hard)));
  }
  return out;
}

async function cropArtwork(buffer, art) {
  const img = sharp(buffer).rotate(); // honour EXIF orientation, same as the model saw
  const meta = await img.metadata();
  const upright = (meta.orientation || 1) >= 5;
  const W = upright ? meta.height : meta.width;
  const H = upright ? meta.width : meta.height;
  if (!W || !H) throw new Error('unreadable image');
  const x0 = Math.max(0, art.box.x - ARTWORK_PAD);
  const y0 = Math.max(0, art.box.y - ARTWORK_PAD);
  const x1 = Math.min(100, art.box.x + art.box.w + ARTWORK_PAD);
  const y1 = Math.min(100, art.box.y + art.box.h + ARTWORK_PAD);
  const region = {
    left: Math.floor((x0 / 100) * W),
    top: Math.floor((y0 / 100) * H),
    width: Math.max(1, Math.round(((x1 - x0) / 100) * W)),
    height: Math.max(1, Math.round(((y1 - y0) / 100) * H)),
  };
  region.width = Math.min(region.width, W - region.left);
  region.height = Math.min(region.height, H - region.top);

  const { data, info } = await img
    .extract(region)
    .resize({ width: ARTWORK_MAX_PX, height: ARTWORK_MAX_PX, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const keyed = art.background === 'plain' ? knockoutBackground(data, info.width, info.height) : null;
  let png = sharp(keyed || data, { raw: { width: info.width, height: info.height, channels: 4 } });
  if (keyed) png = png.trim({ threshold: 1 }); // drop the now-empty margins
  const out = await png.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height, transparent: Boolean(keyed) };
}

// Crop + store every artwork piece. A piece that fails is dropped (logged), never
// the whole extraction.
async function liftArtwork(buffer, artwork, userId) {
  if (!artwork.length || !userId) return [];
  const results = await Promise.all(artwork.map(async (art) => {
    try {
      const crop = await cropArtwork(buffer, art);
      const key = `projects/${userId}/art-${crypto.randomUUID()}.png`;
      await uploadBytes(key, crop.buffer, 'image/png', { immutable: true });
      const src = await getMediaUrl(key);
      return {
        ...art, key, src, width: crop.width, height: crop.height, transparent: crop.transparent,
      };
    } catch (err) {
      console.warn(`[referenceExtractor] artwork "${art.id}" skipped — ${err.message}`);
      return null;
    }
  }));
  return results.filter((a) => a && a.src);
}

// Swap the carousel agent's `artwork:<id>` src tokens for the stored URLs. An
// unknown id drops that <img> rather than leaving a broken image on the slide.
function resolveArtworkTokens(html, artwork) {
  const byId = new Map((artwork || []).map((a) => [a.id, a]));
  return String(html || '').replace(/<img\b[^>]*\bsrc\s*=\s*["']artwork:([a-z0-9-]+)["'][^>]*>/gi, (tag, id) => {
    const art = byId.get(id.toLowerCase());
    if (!art) return '';
    let next = tag.replace(/\bsrc\s*=\s*["']artwork:[^"']*["']/i, `src="${art.src.replace(/"/g, '&quot;')}"`);
    if (!/\bdata-slot\s*=/i.test(next)) next = next.replace(/^<img\b/i, '<img data-slot="artwork"');
    if (!/\bdata-artwork-key\s*=/i.test(next)) next = next.replace(/^<img\b/i, `<img data-artwork-key="${art.key}"`);
    return next;
  });
}

// What the carousel agent sees for each piece: no URLs or storage keys, just
// the token to use and what the piece is.
function artworkForPrompt(artwork) {
  return (artwork || []).map((a) => ({
    src: `artwork:${a.id}`,
    name: a.name,
    kind: a.kind,
    description: a.description,
    usage: a.usage,
    aspectRatio: a.width && a.height ? Math.round((a.width / a.height) * 100) / 100 : null,
    transparentBackground: Boolean(a.transparent),
  }));
}

/**
 * Run the extractor on a stored reference image (S3 key). Returns
 * { elements, image, model, usage } — `image` is the { mediaType, data }
 * vision payload so the Carousel agent can also see the photo itself without
 * a second S3 read. `elements.artwork` holds the lifted pieces (with key/src)
 * that were stored under the user's projects/ prefix.
 */
async function extractReferenceElements(key, { userId } = {}) {
  const { buffer, contentType } = await getObjectBytes(key);
  const vision = await toVisionImage(buffer, contentType, key);
  const image = { mediaType: vision.mediaType, data: vision.buffer.toString('base64') };

  const model = process.env.ANTHROPIC_VISION_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const done = await completeToolCall({
    model,
    system: loadPrompt(),
    userParts: [
      { type: 'image', mediaType: image.mediaType, data: image.data },
      { type: 'text', text: 'Extract the design elements of this reference so a carousel can be re-skinned in its aesthetic.' },
    ],
    tool: EXTRACT_TOOL,
    maxTokens: 4096,
    retryHint: 'Call record_reference_elements with valid JSON. Hex colours as #RRGGBB.',
  });
  if (!done.parsed || typeof done.parsed !== 'object') {
    throw new Error('Reference extractor returned no elements');
  }
  const elements = normalizeElements(done.parsed);
  if (!elements.palette.length && !elements.summary) {
    throw new Error('Reference extractor found no usable design elements');
  }
  elements.artwork = await liftArtwork(vision.buffer, elements.artwork, userId);
  return { elements, image, model, usage: done.usage || null };
}

module.exports = {
  extractReferenceElements,
  normalizeElements,
  resolveArtworkTokens,
  artworkForPrompt,
  knockoutBackground,
};
