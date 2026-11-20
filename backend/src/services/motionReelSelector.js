/*
 * Motion graphic reel — the SELECTOR (studio's guidance, 2026-11-19).
 *
 * Builds what the planner reads (prompts/motion-reel-planner.md) and decides,
 * in code, which motion formats the material can honestly carry:
 *
 *   ProjectContext  project.metrics / facts / rooms / materials / style /
 *                   products — only what the studio stated (verified facts,
 *                   their notes) or a photo's own vision analysis shows
 *   CaptureContext  one row per usable picture (photos + clip stills):
 *                   stage (before / finished / drawing), sharpness, focal box,
 *                   swatches (+ spread / neutral), subjects, and the aligned
 *                   before → after pairs with their similarity
 *   BrandKit        handle, accent / ground / fg, fonts, voice, language,
 *                   complete or not
 *   options         MotionOption[]: every formatId with status
 *                   recommended | valid | invalid and its reasons
 *
 * The planner never decides validity — it picks among these options.
 */

const sharp = require('sharp');
const { getObjectBytes } = require('./s3Client');
const { toVisionImage } = require('./visionImage');

const FORMAT_IDS = [
  'kinetic_hook', 'before_after_wipe', 'ken_burns', 'stat_counter', 'listicle_tips',
  'hotspot_callouts', 'palette_extract', 'grid_build', 'motion_story', 'cta_end_card',
];
const MAX_PICTURES = 16;

const str = (v, n = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const r2 = (n) => Math.round(n * 100) / 100;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const BEFORE_RE = /\b(before|existing|demoli\w*|construction|under construction|site|raw|unfinished|bare|empty|stripped|gutted|old|original state|work in progress|wip|antes|obra)\b/i;
const DRAWING_RE = /\b(floor ?plan|plan view|layout plan|drawing|sketch|elevation|section|blueprint|render(ing)?|3d (view|model)|cad|moodboard|mood board)\b/i;
const ROOMS = ['living room', 'kitchen', 'bedroom', 'bathroom', 'dining', 'study', 'office', 'balcony', 'terrace', 'entrance', 'foyer', 'hallway', 'kids room', 'nursery', 'wardrobe', 'closet', 'pooja room', 'lounge', 'patio', 'garden', 'staircase', 'laundry', 'powder room'];
const STYLES = ['japandi', 'scandinavian', 'minimal', 'minimalist', 'industrial', 'boho', 'bohemian', 'mid-century', 'contemporary', 'modern', 'traditional', 'art deco', 'mediterranean', 'rustic', 'coastal', 'wabi-sabi', 'farmhouse', 'maximalist', 'transitional', 'colonial', 'tropical', 'indian contemporary'];
const MATERIALS = ['oak', 'walnut', 'teak', 'ash', 'pine', 'plywood', 'veneer', 'marble', 'travertine', 'terrazzo', 'granite', 'quartz', 'concrete', 'microcement', 'lime plaster', 'plaster', 'brass', 'copper', 'steel', 'chrome', 'glass', 'fluted glass', 'linen', 'velvet', 'boucle', 'leather', 'rattan', 'cane', 'jute', 'wool', 'tile', 'zellige', 'porcelain', 'ceramic', 'stone', 'brick', 'laminate', 'lacquer', 'cement tile', 'kota stone', 'athangudi'];
// a number with a unit or currency — only these become metrics
const METRIC_RE = /(?:(?:₹|rs\.?|inr|\$|€|£)\s?\d[\d,]*(?:\.\d+)?\s?(?:l|lakh|lakhs|cr|crore|k|m)?\b|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|days?|weeks?|months?|years?|hours?|sq\.?\s?ft|sqft|square feet|m²|m2|sqm|square met(?:er|re)s?|cm|mm|metres?|meters?|feet|ft|rooms?|bhk|lakh|lakhs|crore|cr|l)\b)/gi;
const ROOM_WORDS = ROOMS.map((r) => [r, new RegExp(`\\b${r.replace(/ /g, '\\s?')}s?\\b`, 'i')]);

// ── picture metrics (sharp) ──────────────────────────────────────────────────

async function pixelsOf(buffer) {
  const img = sharp(buffer).rotate();
  const [small, grey, lap] = await Promise.all([
    img.clone().resize(40, 40, { fit: 'cover' }).removeAlpha().raw().toBuffer(),
    img.clone().greyscale().resize(24, 24, { fit: 'fill' }).blur(0.6).raw().toBuffer(),
    img.clone().greyscale().resize(320, 320, { fit: 'inside' })
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats(),
  ]);
  return { small, grey, sharpness: r2(lap.channels[0].stdev) };
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
function hsl([r, g, b]) {
  const R = r / 255; const G = g / 255; const B = b / 255;
  const max = Math.max(R, G, B); const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// k-means on 1 600 pixels → up to 5 swatches, most common first
function swatchesOf(raw) {
  const px = [];
  for (let i = 0; i < raw.length; i += 3) px.push([raw[i], raw[i + 1], raw[i + 2]]);
  const k = 5;
  let cents = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * (px.length / k))]);
  let groups = [];
  for (let it = 0; it < 8; it += 1) {
    groups = cents.map(() => []);
    px.forEach((p) => {
      let best = 0; let bd = Infinity;
      cents.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      groups[best].push(p);
    });
    cents = groups.map((g, j) => (g.length ? [0, 1, 2].map((c) => g.reduce((t, p) => t + p[c], 0) / g.length) : cents[j]));
  }
  const rows = cents.map((c, j) => ({ rgb: c, share: groups[j].length / px.length }))
    .filter((x) => x.share > 0.03)
    .sort((a, b) => b.share - a.share);
  // merge near-duplicates
  const out = [];
  rows.forEach((x) => { if (!out.some((o) => Math.hypot(...o.rgb.map((v, i) => v - x.rgb[i])) < 28)) out.push(x); });
  const swatches = out.map((x) => ({ hex: hex(x.rgb), share: r2(x.share), ...hsl(x.rgb) }));
  const sat = swatches.reduce((t, s) => t + s.s * s.share, 0) / Math.max(0.01, swatches.reduce((t, s) => t + s.share, 0));
  let spread = 0; let n = 0;
  for (let i = 0; i < swatches.length; i += 1) {
    for (let j = i + 1; j < swatches.length; j += 1) {
      const a = swatches[i]; const b = swatches[j];
      const dh = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 180;
      spread += dh * Math.min(a.s, b.s) + Math.abs(a.l - b.l) * 0.6; n += 1;
    }
  }
  return {
    swatches: swatches.map((s) => ({ hex: s.hex, share: s.share })),
    swatchSpread: r2(n ? spread / n : 0),
    neutral: sat < 0.16,
  };
}

// structure similarity of two pictures: correlation of their edge maps (24×24),
// so an empty room and the same room furnished still line up on walls/windows
function edgesOf(grey) {
  const W = 24; const e = new Float64Array(W * W);
  for (let y = 1; y < W - 1; y += 1) {
    for (let x = 1; x < W - 1; x += 1) {
      const gx = grey[y * W + x + 1] - grey[y * W + x - 1];
      const gy = grey[(y + 1) * W + x] - grey[(y - 1) * W + x];
      e[y * W + x] = Math.hypot(gx, gy);
    }
  }
  return e;
}
function corr(a, b) {
  const n = a.length;
  let ma = 0; let mb = 0;
  for (let i = 0; i < n; i += 1) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < n; i += 1) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// ── material → contexts ──────────────────────────────────────────────────────

function pictureRows(material) {
  const rows = [];
  for (const a of material.assets || []) {
    if (rows.length >= MAX_PICTURES) break;
    if (a.kind === 'image') {
      rows.push({ assetId: a.id, key: a.key, source: 'photo', summary: a.summary, description: a.description, subjects: a.subjects || [], subjectBoxes: a.subjectBoxes || [], text: a.text || '' });
    } else if (a.kind === 'video') {
      (a.stills || []).slice(0, 2).forEach((s, i) => {
        // the clip itself rides along: the renderer plays it (muted) from this moment
        if (rows.length < MAX_PICTURES) rows.push({ assetId: `${a.id}s${i + 1}`, key: s.key, source: 'clip still', summary: s.summary || a.summary, description: a.description, subjects: [], subjectBoxes: [], text: '', clip: { key: a.key, t: num(s.t), durationSec: num(a.durationSec) } });
      });
    }
  }
  return rows;
}

function roomsIn(text) {
  return ROOM_WORDS.filter(([, re]) => re.test(text)).map(([r]) => r);
}

function factsOf(material) {
  const facts = [];
  (material.capture?.notes || []).forEach((n) => {
    (n.understanding?.verifiedFacts || []).forEach((f) => {
      const t = typeof f === 'string' ? f : f?.fact;
      if (str(t)) facts.push(str(t, 240));
    });
  });
  return [...new Set(facts)].slice(0, 20);
}

function studioText(material) {
  const notes = (material.capture?.notes || []).map((n) => [n.note, n.summary, n.understanding?.happened, n.understanding?.actionTaken, n.understanding?.outcome].filter(Boolean).join(' ')).join(' ');
  const said = (material.capture?.conversation || []).filter((t) => t.role === 'user').map((t) => t.text).join(' ');
  return `${notes} ${said} ${factsOf(material).join(' ')}`;
}

function metricsOf(text) {
  const out = {};
  const seen = new Set();
  let i = 0;
  for (const m of String(text).matchAll(METRIC_RE)) {
    const t = m[0].trim().replace(/\s+/g, ' ');
    const k = t.toLowerCase();
    if (!/\d/.test(t) || seen.has(k)) continue;
    seen.add(k);
    // the sentence it sits in, as the label's source
    const at = m.index || 0;
    const from = Math.max(0, String(text).lastIndexOf('.', at) + 1);
    const to = String(text).indexOf('.', at + t.length);
    i += 1;
    out[`m${i}`] = { text: t, context: str(String(text).slice(from, to < 0 ? undefined : to), 200) };
    if (i >= 10) break;
  }
  return out;
}

async function buildContexts({ material, brand, dna, handle, idea, storyPlan, language }) {
  const text = studioText(material);
  const lower = text.toLowerCase();
  const facts = factsOf(material);
  const metrics = metricsOf(text);
  const pictures = pictureRows(material);

  // measure every picture (bytes once, in parallel)
  await Promise.all(pictures.map(async (p) => {
    try {
      const { buffer, contentType } = await getObjectBytes(p.key);
      const vis = await toVisionImage(buffer, contentType, p.key);
      const meta = await sharp(vis.buffer).rotate().metadata();
      const px = await pixelsOf(vis.buffer);
      Object.assign(p, { width: meta.width, height: meta.height, sharpness: px.sharpness, _edges: edgesOf(px.grey), ...swatchesOf(px.small) });
    } catch (err) {
      p.error = err.message;
    }
  }));
  const usable = pictures.filter((p) => !p.error);

  usable.forEach((p) => {
    const words = `${p.summary} ${p.description} ${(p.subjects || []).join(' ')} ${p.text}`;
    p.stage = DRAWING_RE.test(words) ? 'drawing' : BEFORE_RE.test(words) ? 'before' : 'finished';
    p.rooms = roomsIn(words);
    const main = p.subjectBoxes[0];
    p.focal = main ? { x: r2(main.box.x), y: r2(main.box.y), w: r2(main.box.w), h: r2(main.box.h) } : { x: 30, y: 30, w: 40, h: 40 };
    p.wide = p.subjectBoxes.length >= 4 || /\b(wide|overall|whole|full view|overview)\b/i.test(words);
    if (/\b(blurry|blurred|out of focus|low[- ]light|grainy)\b/i.test(words)) p.needsConfirmation = 'the analysis calls this picture blurry or dark';
  });

  // before → after pairs: same room, structure lines up
  const pairs = [];
  const befores = usable.filter((p) => p.stage === 'before');
  const afters = usable.filter((p) => p.stage === 'finished');
  befores.forEach((b) => afters.forEach((a) => {
    const similarity = r2(Math.max(0, corr(b._edges, a._edges)));
    const sameRoom = !b.rooms.length || !a.rooms.length || b.rooms.some((r) => a.rooms.includes(r));
    const ratioOk = Math.abs((b.width / b.height) - (a.width / a.height)) < 0.25;
    pairs.push({ beforeAssetId: b.assetId, afterAssetId: a.assetId, similarity, aligned: sameRoom && ratioOk && similarity >= 0.45 });
  }));
  pairs.sort((x, y) => y.similarity - x.similarity);

  // "products": elements the studio named that a finished photo shows (price only if stated)
  const products = [];
  usable.filter((p) => p.stage === 'finished').forEach((p) => {
    p.subjectBoxes.forEach((s) => {
      const tokens = s.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
      if (!tokens.some((w) => lower.includes(w))) return;
      const priceM = new RegExp(`${tokens[0]}[^.]{0,40}?((?:₹|rs\\.?|\\$|€|£)\\s?\\d[\\d,.]*\\s?(?:l|lakh|k)?)`, 'i').exec(text);
      products.push({ productId: `p${products.length + 1}`, name: str(s.name, 40), assetId: p.assetId, point: s.point, price: priceM ? priceM[1].trim() : null });
    });
  });
  const productsByAsset = {};
  products.forEach((p) => { productsByAsset[p.assetId] = (productsByAsset[p.assetId] || 0) + 1; });

  const project = {
    title: str(idea?.title || storyPlan?.title || material.capture?.project, 120),
    // the studio's own words — what graphics-only lines are written from
    notes: str(text, 900),
    name: material.capture?.project && material.capture.project !== 'No project' ? material.capture.project : '',
    metrics,
    facts: facts.map((f, i) => ({ id: `f${i + 1}`, text: f })),
    rooms: [...new Set([...roomsIn(text), ...usable.flatMap((p) => p.rooms)])],
    materials: MATERIALS.filter((m) => new RegExp(`\\b${m}\\b`, 'i').test(text)),
    style: STYLES.filter((s) => new RegExp(`\\b${s}\\b`, 'i').test(text)).slice(0, 2).join(', '),
    products,
  };

  const assets = usable.map((p) => ({
    assetId: p.assetId,
    source: p.source,
    stage: p.stage,
    summary: str(p.summary, 160),
    rooms: p.rooms,
    subjects: p.subjectBoxes.map((s) => s.name).slice(0, 8),
    focal: p.focal,
    sharpness: p.sharpness,
    wide: p.wide,
    swatches: p.swatches,
    swatchSpread: p.swatchSpread,
    neutral: p.neutral,
    ...(p.needsConfirmation ? { needsConfirmation: p.needsConfirmation } : {}),
  }));
  const capture = { assets, pairs: pairs.slice(0, 6) };

  const brandKit = {
    handle: handle ? `@${handle}` : '',
    accent: brand?.accent || '',
    ground: brand?.ground || '',
    fg: brand?.fg || '',
    headlineFont: brand?.headlineFont || '',
    bodyFont: brand?.bodyFont || '',
    voice: str(dna?.howYouSound, 300),
    language: language || 'English',
    cta: '',
  };
  brandKit.complete = Boolean(brandKit.handle && brandKit.accent);

  const options = selectOptions({ project, capture, brandKit, idea, storyPlan });
  // what the renderer needs that the planner never sees
  const internal = new Map(usable.map((p) => [p.assetId, p]));
  return { project, capture, brandKit, options, internal };
}

// ── which formats the material can carry ────────────────────────────────────

function selectOptions({ project, capture, brandKit, idea, storyPlan }) {
  const A = capture.assets;
  const finished = A.filter((a) => a.stage === 'finished');
  const shown = A.filter((a) => a.stage !== 'before');
  const aligned = capture.pairs.filter((p) => p.aligned);
  const metrics = Object.keys(project.metrics);
  const productsOn = {};
  project.products.forEach((p) => { productsOn[p.assetId] = (productsOn[p.assetId] || 0) + 1; });
  const bestProducts = Math.max(0, ...Object.values(productsOn));
  const colourful = finished.filter((a) => !a.neutral && a.swatchSpread >= 0.12 && a.swatches.length >= 3);
  const ask = `${idea?.title || ''} ${storyPlan?.title || ''} ${(storyPlan?.sequences || []).map((s) => s.onScreenText).join(' ')}`.toLowerCase();

  const opt = (formatId, ok, reasons) => ({ formatId, status: ok ? 'valid' : 'invalid', reasons: ok ? [] : reasons });
  const options = [
    opt('kinetic_hook', true, []),
    opt('before_after_wipe', aligned.length > 0, [capture.pairs.length ? `no aligned before/after pair (best similarity ${capture.pairs[0].similarity})` : 'no before photo of a room that also has a finished photo']),
    opt('ken_burns', shown.length >= 3, [`only ${shown.length} finished photo(s) — needs 3`]),
    opt('stat_counter', metrics.length >= 1, ['no number the studio stated (budget, days, area, result)']),
    opt('listicle_tips', project.facts.length >= 3, [`only ${project.facts.length} verified fact(s) — tips need 3 grounded points`]),
    opt('hotspot_callouts', bestProducts >= 2, [bestProducts ? 'only 1 named element matched on a finished photo' : 'no named element matched on a finished photo']),
    opt('palette_extract', colourful.length >= 1, [finished.length ? 'the finished rooms are mostly neutral' : 'no finished photo']),
    opt('grid_build', shown.length >= 4, [`only ${shown.length} qualifying photo(s) — needs 4`]),
    // a story told beat by beat in animated type — needs something to say, not pictures
    opt('motion_story', project.facts.length >= 2 || project.notes.length >= 60, ['too little written down to tell a story in beats']),
    opt('cta_end_card', brandKit.complete, ['the Brand Kit has no handle or accent colour']),
  ];
  const valid = (id) => options.find((o) => o.formatId === id)?.status === 'valid';

  // the one recommendation (never the outro)
  const order = [];
  if (valid('before_after_wipe')) order.push('before_after_wipe');
  if (valid('stat_counter') && /\d/.test(ask) && metrics.some((k) => ask.includes(project.metrics[k].text.toLowerCase().replace(/\s+/g, ' ').split(' ')[0]))) order.push('stat_counter');
  if (valid('hotspot_callouts') && /\b(material|finish|detail|product|piece|fixture|furniture|light|lamp|tap|handle)\w*/.test(ask)) order.push('hotspot_callouts');
  if (valid('palette_extract') && /\b(colou?r|palette|tone|hue)\w*/.test(ask)) order.push('palette_extract');
  // a story to tell over the photos: beat by beat, each line acting out its meaning
  if (valid('motion_story') && shown.length && project.facts.length >= 3) order.push('motion_story');
  if (valid('ken_burns')) order.push('ken_burns');
  if (valid('grid_build')) order.push('grid_build');
  if (valid('hotspot_callouts')) order.push('hotspot_callouts');
  if (valid('palette_extract')) order.push('palette_extract');
  if (valid('stat_counter') && shown.length) order.push('stat_counter');
  // graphics only: practical tips stay a list; anything else (a stance, a
  // process, a story, an opinion) is told beat by beat
  const tipsAsked = /\b(tips?|ways|steps|how to|mistakes?|rules|checklist|guide)\b/.test(`${ask} ${project.title.toLowerCase()}`);
  if (valid('listicle_tips') && tipsAsked) order.push('listicle_tips');
  if (valid('motion_story')) order.push('motion_story');
  if (valid('listicle_tips')) order.push('listicle_tips');
  if (valid('stat_counter')) order.push('stat_counter');
  order.push('kinetic_hook');
  const rec = order[0];
  options.forEach((o) => { if (o.formatId === rec) o.status = 'recommended'; });
  return options;
}

module.exports = { buildContexts, selectOptions, FORMAT_IDS, metricsOf, swatchesOf };
