/*
 * Theme Apply agent — Editor › Themes (Upload a reference / Choose from library).
 *
 * Re-paints one carousel slide in the look of a reference image and returns
 * the finished slide as an IMAGE, text included:
 *   1. Image 1 = the slide as the studio sees it (captured in the browser),
 *      Image 2 = the reference (an uploaded photo or a library theme's board);
 *   2. the image model (gpt-image-2.5-sunburst by default) paints the slide
 *      with prompts/theme-apply-render.md — the slide's exact words, the safe
 *      area, and a flat magenta placeholder where the primary photo goes;
 *   3. the ORIGINAL photo is pasted into that placeholder (services/primaryImage.js);
 *   4. a quality check (services/slideCheck.js) looks for clipped, crowded,
 *      misspelled or covered text — one re-render naming the problems if so.
 *
 * The caller (postController.applyThemeImage) drops the picture into the
 * carousel document as a full-bleed <img> in a section of its own.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { composeImage } = require('./openaiImage');
const { uploadBytes, getMediaUrl } = require('./s3Client');
const { copyFromLayoutHtml } = require('./layoutHtml');
const { pastePrimaryImage, PLACEHOLDER_HEX } = require('./primaryImage');
const { checkSlide } = require('./slideCheck');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'theme-apply-render.md');
let promptCache = '';
const loadPrompt = () => (promptCache || (promptCache = fs.readFileSync(PROMPT_PATH, 'utf8').trim()));
const fillTemplate = (template, vars) => Object.entries(vars)
  .reduce((out, [k, v]) => out.split(`{{${k}}}`).join(String(v ?? '')), template);

// ── the slide's words ───────────────────────────────────────────────────────
const TEXT_SLOTS = ['title', 'supporting-text', 'subtitle', 'body', 'eyebrow', 'label', 'caption', 'note', 'detail', 'action', 'quote', 'stat', 'index'];
const decode = (t) => String(t || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"');
const textOf = (html) => decode(String(html || '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(br|\/p|\/h\d|\/li|\/div)\b[^>]*>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// The slide's article, stripped to what the words need: no styles, pictures or
// decorative marks.
function slideSource(slideHtml) {
  const s = String(slideHtml || '');
  const article = (s.match(/<article\b[\s\S]*<\/article>/i) || [s])[0];
  return article
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(img|svg|picture|video)\b[\s\S]*?(<\/\1>|\/?>)/gi, '')
    .replace(/\s(style|class|id|src|srcset|data-asset-key|data-image-request|data-decor-id)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/\n\s*\n+/g, '\n')
    .slice(0, 12000);
}

// Every text element of the carousel agent's html, in order: { slot, text }.
function sourceElements(src) {
  const out = [];
  const re = /<([a-z][a-z0-9]*)\b[^>]*\bdata-slot\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(src)))) {
    const slot = m[2].toLowerCase();
    if (!TEXT_SLOTS.includes(slot)) continue;
    const text = textOf(m[3]);
    if (text) out.push({ slot, text });
  }
  return out;
}

// A slide with no slotted html (hand-built, or already a picture): its stored
// words, a line that repeats another left out.
function slideLinesOf(slide = {}) {
  const f = copyFromLayoutHtml(slide.layoutHtml || '')?.filled || {};
  const pick = (k) => (f[k] !== undefined && f[k] !== '' ? f[k] : slide[k]);
  const out = [];
  const seen = new Set();
  const add = (role, text, space = '') => {
    const t = String(Array.isArray(text) ? text.filter(Boolean).join(' · ') : (text || '')).replace(/\s*\n\s*/g, ' ').trim();
    const k = t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!t || seen.has(k)) return;
    seen.add(k);
    out.push({ role, text: t, space });
  };
  add('headline', pick('title') || pick('quote') || pick('stat'), 'title');
  add('supporting', pick('subtitle'), 'supporting-text');
  add('supporting', pick('body'), 'body');
  add('supporting', pick('items'), 'body');
  add('label', pick('action'), 'action');
  return out;
}

// The words to render: the carousel agent's text elements for this slide,
// else the slide's stored words.
function slideLines(slide = {}) {
  const fromHtml = sourceElements(slideSource(slide?.layoutHtml || ''))
    .map((e) => ({ role: e.slot === 'title' ? 'headline' : (/label|eyebrow|note|caption|index|detail/.test(e.slot) ? 'label' : 'supporting'), text: e.text, space: e.slot }));
  return fromHtml.length ? fromHtml : slideLinesOf(slide);
}

// ── the render prompt (prompts/theme-apply-render.md) ────────────────────────
// gpt-image-2.x paints a true 4:5 canvas (1024×1280) — no crop, so nothing near
// an edge is sliced off; older models paint 2:3 and are cropped to 4:5.
const THEME_IMAGE_MODEL = () => process.env.OPENAI_THEME_IMAGE_MODEL || 'gpt-image-2.5-sunburst';
const paintsFourByFive = (model) => /^gpt-image-2/i.test(String(model || ''));
const CANVAS_NOTE = {
  native: 'the canvas IS the final 4:5 slide (1024×1280) — nothing is cropped, so the edges of the canvas are the edges of the post.',
  cropped: 'the finished slide is 4:5 but is painted on a taller 2:3 canvas and cropped to its central 4:5 band. Image 1 is shown the same way — the slide in the middle band, plain bands above and below. Keep every word and important detail inside that central band, well clear of its edges.',
};

const roleName = (l) => {
  const slot = String(l.space || '').toLowerCase();
  if (/head/i.test(l.role) || slot === 'title') return 'Headline';
  if (/eyebrow/.test(slot)) return 'Eyebrow (small, above the headline)';
  if (/label|caption|note|detail|index/.test(slot) || /label/i.test(l.role)) return 'Label (small)';
  if (/action/.test(slot)) return 'Call to action';
  if (/quote/.test(slot)) return 'Quote';
  if (/stat/.test(slot)) return 'Stat (a number set large)';
  return 'Supporting text';
};

// The photo is never left to the image model: it paints a flat magenta
// placeholder of the photo's shape, and the original is pasted in afterwards.
function primaryImageSection(photo) {
  if (!photo) return '';
  const r = photo.width && photo.height ? photo.width / photo.height : 0;
  const shape = !r ? '' : (r > 1.15 ? 'landscape' : (r < 0.87 ? 'portrait' : 'square'));
  return [
    '## Primary image placeholder',
    '',
    `Do NOT paint Image 1's primary photo. In its place, paint a flat, solid ${PLACEHOLDER_HEX} (pure magenta) rectangle — one even colour, no texture, no shading, no gradient, nothing drawn inside it. The app replaces it with the original photo, unchanged.`,
    `- Shape: ${r ? `${shape}, width:height about ${r.toFixed(2)} : 1 — ` : ''}the photo's own proportions. Keep it upright (not rotated).`,
    '- Size and place it as the prominent picture of the new composition — about as large as the photo is on Image 1, or larger.',
    '- Frame it in the theme\'s manner around its edges (a border, a mat, tape on the corners, a torn-paper edge, a shadow) — but never over the magenta itself.',
    '- Use magenta ONLY for this rectangle — nowhere else on the slide.',
    '- Put NO text on or across the magenta rectangle — it is covered by the photo afterwards.',
  ].join('\n');
}

// The studio's Brand Kit colours (the slide's chosen colour set) — the palette
// the render must use; Image 2 still gives textures, type mood and decoration.
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function brandPalette(colors) {
  if (!colors || typeof colors !== 'object') return null;
  const pick = (v) => (HEX.test(String(v || '').trim()) ? String(v).trim().toUpperCase() : '');
  const p = { ground: pick(colors.ground || colors.bg), fg: pick(colors.fg || colors.ink), accent: pick(colors.accent) };
  if (!p.ground && !p.fg && !p.accent) return null;
  return { ...p, name: String(colors.name || '').slice(0, 60) };
}

function brandColorsSection(palette) {
  if (!palette) return '';
  return [
    `## Brand colours${palette.name ? ` (${palette.name})` : ''}`,
    '',
    'The studio chose these brand colours for this slide. Use them as the slide\'s palette in place of Image 2\'s colours — keep Image 2\'s textures, typography mood, framing and decoration, but recolour them into this palette:',
    palette.ground ? `- Background — the slide ground: ${palette.ground}` : '',
    palette.fg ? `- Primary — all text (headline, copy, labels) and dark surfaces: ${palette.fg}` : '',
    palette.accent ? `- Accent (highlights, shapes, tape, frames, small details): ${palette.accent}` : '',
    '- Tints, shades and paper textures of these colours are fine; do not introduce other dominant colours. Keep text-to-background contrast strong.',
    '- These colours never apply to the original photo.',
  ].filter(Boolean).join('\n');
}

function themeApplyPrompt(lines = [], photo = null, { native = paintsFourByFive(THEME_IMAGE_MODEL()), palette = null } = {}) {
  const text = lines.length
    ? lines.map((l, i) => `${i + 1}. ${roleName(l)}: "${l.text}"`).join('\n')
    : '(the slide has no text — render none)';
  return fillTemplate(loadPrompt(), {
    TEXT_LINES: text,
    PRIMARY_IMAGE: primaryImageSection(photo),
    BRAND_COLORS: brandColorsSection(palette),
    CANVAS: native ? CANVAS_NOTE.native : CANVAS_NOTE.cropped,
  }).replace(/\n{3,}/g, '\n\n');
}

// ── images in ───────────────────────────────────────────────────────────────
// Every input goes to the image model as a JPEG no larger than the render.
async function normalize(buffer, max = 1536) {
  const out = await sharp(buffer)
    .rotate()
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer: out, mediaType: 'image/jpeg' };
}

// For a 2:3 model: Image 1 padded to 2:3 — the slide in the central band, its
// edge colour above and below — so its layout lands where the 4:5 crop keeps it.
async function padToRenderShape(buffer) {
  const { width: W, height: H } = await sharp(buffer).metadata();
  const band = Math.max(0, Math.round((W * 1.5 - H) / 2));
  if (!band) return { buffer, mediaType: 'image/jpeg' };
  const edge = await sharp(buffer).extract({ left: 0, top: 0, width: W, height: Math.max(2, Math.round(H * 0.03)) }).stats();
  const out = await sharp(buffer)
    .extend({ top: band, bottom: band, background: { r: edge.dominant.r, g: edge.dominant.g, b: edge.dominant.b } })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { buffer: out, mediaType: 'image/jpeg' };
}

/**
 * @param {{ slideIndex: number, slide?: object, userId: string,
 *   reference: { buffer: Buffer }, snapshot: { buffer: Buffer }, photo?: { buffer: Buffer }|null,
 *   brandColors?: { name?, ground?, fg?, accent? }|null }} p
 * @returns {Promise<{ key, src, renderPrompt, textLines, primaryImage, check, usage, debugEntry }>}
 */
async function applyThemeToSlide({ slideIndex, slide = {}, userId, reference, snapshot, photo = null, brandColors = null }) {
  if (!reference?.buffer) throw new Error('A reference photo is required.');
  if (!snapshot?.buffer) throw new Error('Could not capture this slide to re-theme it — try again.');
  const started = Date.now();
  const model = THEME_IMAGE_MODEL();
  const native = paintsFourByFive(model);
  const current = native
    ? await normalize(snapshot.buffer)
    : await padToRenderShape((await normalize(snapshot.buffer)).buffer);
  const ref = await normalize(reference.buffer);
  const lines = slideLines(slide);
  const photoMeta = photo?.buffer ? await sharp(photo.buffer).rotate().metadata().catch(() => null) : null;
  const photoInfo = photoMeta ? { width: photoMeta.width, height: photoMeta.height } : null;
  const palette = brandPalette(brandColors);
  const prompt = themeApplyPrompt(lines, photoInfo, { native, palette });

  // one render, cropped to 4:5 when the model painted 2:3
  const renderOnce = async (extra = '') => {
    const r = await composeImage({
      images: [{ ...current, name: 'current-slide' }, { ...ref, name: 'reference' }],
      prompt: extra ? `${prompt}\n\n${extra}` : prompt,
      // gpt-image-2.5-sunburst won a side-by-side on this job (exact words, the
      // strongest theme, ~$0.04/slide); OPENAI_THEME_IMAGE_MODEL overrides
      model,
      quality: process.env.OPENAI_THEME_IMAGE_QUALITY || 'medium',
      ...(native ? { size: '1024x1280' } : {}),
    });
    const meta = await sharp(r.buffer).metadata();
    const w = Number(meta.width) || 1024;
    const h = Number(meta.height) || 1536;
    const cropH = Math.min(h, Math.round((w * 5) / 4));
    const cropW = cropH < h ? w : Math.min(w, Math.round((h * 4) / 5));
    const cropped = await sharp(r.buffer)
      .extract({ left: Math.round((w - cropW) / 2), top: Math.round((h - cropH) / 2), width: cropW, height: cropH })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();
    return { rendered: r, cropped, cropW, cropH };
  };
  const renders = [];
  // one attempt: render, then the original photo into its placeholder
  const attempt = async (extra = '') => {
    const run = await renderOnce(extra);
    renders.push(run.rendered);
    const placed = photo?.buffer ? await pastePrimaryImage(run.cropped, photo.buffer) : null;
    return { run, placed, out: placed?.found ? placed.buffer : run.cropped };
  };
  let best = await attempt();
  if (best.placed && !best.placed.found) {
    best = await attempt(`IMPORTANT: the previous attempt did not leave the ${PLACEHOLDER_HEX} placeholder. Paint the photo's place as one flat, solid ${PLACEHOLDER_HEX} rectangle — do not paint the photo itself.`);
  }
  if (best.placed && !best.placed.found) console.warn(`[themeApply] slide ${slideIndex}: no photo placeholder after a retry — the render keeps the model's own picture`);

  // quality gate: clipped / edge-crowding text, wrong copy, covered text —
  // one re-render naming the problems, keep whichever has fewer
  // (THEME_APPLY_CHECK=0 turns it off)
  const checks = [];
  if (process.env.THEME_APPLY_CHECK !== '0') {
    let check = await checkSlide(best.out, lines);
    if (check) checks.push(check);
    if (check?.problems.length) {
      const again = await attempt(`FIX THESE PROBLEMS from the previous attempt: ${check.problems.join('; ')}. Keep every letter at least 8% inside every edge, and the copy exactly as given.`);
      const recheck = await checkSlide(again.out, lines);
      if (recheck) checks.push(recheck);
      if (!recheck || recheck.problems.length <= check.problems.length) { best = again; check = recheck || check; }
    }
    if (check?.problems.length) console.warn(`[themeApply] slide ${slideIndex} kept with: ${check.problems.join('; ')}`);
  }
  const { out, placed } = best;
  const { rendered, cropW, cropH } = best.run;

  const key = `projects/${userId}/themed-${crypto.randomUUID()}.jpg`;
  await uploadBytes(key, out, 'image/jpeg');
  const src = await getMediaUrl(key).catch(() => '');

  // every render plus every quality check
  const usage = [...renders.map((r) => ({ ...(r.usage || {}), estimatedCostUsd: r.estimatedCostUsd })), ...checks.map((c) => c.usage)]
    .reduce((a, u) => ({
      inputTokens: a.inputTokens + (Number(u?.inputTokens) || 0),
      outputTokens: a.outputTokens + (Number(u?.outputTokens) || 0),
      totalTokens: a.totalTokens + (Number(u?.totalTokens) || 0),
      estimatedCostUsd: a.estimatedCostUsd + (Number(u?.estimatedCostUsd) || 0),
      elapsedMs: Date.now() - started,
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, elapsedMs: 0 });
  const lastCheck = checks[checks.length - 1] || null;
  return {
    key,
    src,
    renderPrompt: prompt,
    textLines: lines,
    brandColors: palette,
    primaryImage: photo?.buffer ? { kept: Boolean(placed?.found), box: placed?.box || null, renders: renders.length } : null,
    check: checks.length ? { runs: checks.length, firstProblems: checks[0].problems, problems: lastCheck.problems } : null,
    usage,
    debugEntry: {
      source: `ThemeApply:slide ${slideIndex}`,
      model: `${rendered.model} · ${rendered.quality}`,
      prompt: `${prompt}\n\nInput images: 1. current slide · 2. theme reference`,
      output: `Rendered slide ${slideIndex} · ${cropW}×${cropH} · ${key}${photo?.buffer
        ? (placed?.found ? ` · original photo pasted into the placeholder at ${placed.box.left},${placed.box.top} ${placed.box.width}×${placed.box.height}` : ' · NO placeholder found — the photo is the model\'s redraw')
        : ' · no primary photo on this slide'}${renders.length > 1 ? ` · ${renders.length} renders` : ''}${native ? ' · painted 4:5 (no crop)' : ' · painted 2:3, cropped to 4:5'}${checks.length
        ? `\nQuality check: ${checks[0].problems.length ? `found ${checks[0].problems.join('; ')}` : 'passed'}${checks.length > 1 ? ` → after re-render: ${lastCheck.problems.length ? lastCheck.problems.join('; ') : 'passed'}` : ''}`
        : ''}`,
      elapsedMs: usage.elapsedMs,
    },
  };
}

// The slide as the carousel document carries it: one full-bleed picture in a
// section of its own (themeMerge scopes the CSS to that section).
const THEMED_DIRECTION = 'themed-image';
function themedSlideDocument({ slideIndex, key, src }) {
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
section[data-direction="${THEMED_DIRECTION}"] { display: block; margin: 0; padding: 0; }
.slide { position: relative; display: block; width: 100%; aspect-ratio: 4 / 5; overflow: hidden; margin: 0; padding: 0; background: #e9e6df; }
.slide img[data-slot="image"] { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; background: #e9e6df; }
</style>
</head><body>
<section data-direction="${THEMED_DIRECTION}">
<article class="slide" data-index="${Number(slideIndex) || 1}" data-themed-image="1"><img data-slot="image" data-asset-key="${esc(key)}"${src ? ` src="${esc(src)}"` : ''} alt=""></article>
</section>
</body></html>`;
}

module.exports = { applyThemeToSlide, themeApplyPrompt, themedSlideDocument, THEMED_DIRECTION };
