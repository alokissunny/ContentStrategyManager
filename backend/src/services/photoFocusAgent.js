/*
 * Photo Focus agent — where the photo on a slide must be cropped to.
 *
 * Carousel slides crop their photos to fill a space (`object-fit: cover`), and
 * the slide's copy panel often lies over part of the picture. Centring the crop
 * can hide exactly what the slide is talking about (a slide about "a fixed
 * floor" showing only wall). This agent looks at the photo with the slide's
 * words and returns the box the reader must see; it is written onto the
 * <img> as `data-focus="x y w h"` (percent of the photo) and the renderer
 * (frontend pages/weekview/photoFocus.js) positions the crop so that box sits
 * in the part of the slide the copy leaves visible.
 *
 * Results are cached on the post (`photoFocus`: [{ slide, key, sig, box }]) so
 * a slide whose html was saved without the attribute is re-annotated for free.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { completeToolCall } = require('./llmComplete');
const { getObjectBytes } = require('./s3Client');
const { toVisionImage } = require('./visionImage');

const FOCUS_MODEL = () => process.env.PHOTO_FOCUS_MODEL || 'gpt-5.6-terra';
const CONCURRENCY = () => Math.max(1, Number(process.env.PHOTO_FOCUS_CONCURRENCY) || 4);

let promptCache = null;
function systemPrompt() {
  if (promptCache == null) {
    promptCache = fs.readFileSync(path.join(__dirname, '../../prompts/photo-focus.md'), 'utf8').trim();
  }
  return promptCache;
}

const FOCUS_TOOL = {
  name: 'record_focus',
  description: 'Record the part of the photo the slide needs the reader to see.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'What the box holds, in a few words (e.g. "the terracotta floor tiles").' },
      box: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
        },
        required: ['x', 'y', 'w', 'h'],
      },
      reason: { type: 'string', description: 'One short sentence: why this part carries the slide.' },
    },
    required: ['subject', 'box', 'reason'],
  },
};

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) * 10) / 10));
function cleanBox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let { x, y, w, h } = raw;
  if ([x, y, w, h].some((v) => !Number.isFinite(Number(v)))) return null;
  // a model that answered in 0–1
  if ([x, y, w, h].every((v) => Number(v) >= 0 && Number(v) <= 1)) { x *= 100; y *= 100; w *= 100; h *= 100; }
  x = clampPct(x); y = clampPct(y);
  w = Math.min(clampPct(w), 100 - x); h = Math.min(clampPct(h), 100 - y);
  if (w < 3 || h < 3) return null;
  return { x, y, w, h };
}

const plain = (html) => String(html || '')
  .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#39;|&rsquo;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const sigOf = (words, key) => crypto.createHash('sha1').update(`${key}\n${words.toLowerCase()}`).digest('hex').slice(0, 12);

/** One photo + the slide's words → { box, subject, reason, usage } */
async function focusForPhoto({ key, words, context = '' }) {
  const { buffer, contentType } = await getObjectBytes(key);
  const vision = await toVisionImage(buffer, contentType, key);
  const jpeg = await sharp(vision.buffer).rotate()
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 85 })
    .toBuffer();
  const done = await completeToolCall({
    model: FOCUS_MODEL(),
    system: systemPrompt(),
    userParts: [
      { type: 'text', text: 'The photo:' },
      { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
      {
        type: 'text',
        text: [
          `The slide's words: ${JSON.stringify(words.slice(0, 700))}`,
          context ? `What the post is about: ${JSON.stringify(context.slice(0, 300))}` : '',
        ].filter(Boolean).join('\n'),
      },
    ],
    tool: FOCUS_TOOL,
    maxTokens: 400,
    reasoningEffort: 'low',
    retryHint: 'Call record_focus with valid JSON.',
  });
  const p = done.parsed || {};
  return {
    box: cleanBox(p.box),
    subject: String(p.subject || '').slice(0, 120),
    reason: String(p.reason || '').slice(0, 240),
    usage: done.usage || null,
    model: done.model,
  };
}

// ── finding the photos in a post's html ────────────────────────────────────
const IMG_TAG = /<img\b[^>]*>/gi;
const keyOf = (tag) => (tag.match(/\sdata-asset-key\s*=\s*"([^"]+)"/i) || [])[1] || '';
const hasFocus = (tag) => /\sdata-focus\s*=/i.test(tag);
const withFocus = (tag, box) => tag.replace(/^<img\b/i, `<img data-focus="${box ? `${box.x} ${box.y} ${box.w} ${box.h}` : 'none'}"`);

// the carousel document's slides, in order: [{ start, end, html }]
function articlesOf(doc) {
  const out = [];
  const re = /<article\b[\s\S]*?<\/article>/gi;
  let m;
  while ((m = re.exec(doc))) out.push({ start: m.index, end: m.index + m[0].length, html: m[0] });
  return out;
}

/**
 * Annotate every photo in the post that has no `data-focus` yet.
 * Mutates `post` (content.carouselHtml, slides[].layoutHtml, photoFocus).
 * @returns {Promise<{ changed: boolean, added: number, calls: number, rows: object[] }>}
 */
async function annotatePostPhotos(post, { owns = () => true } = {}) {
  const content = post.content || {};
  const trace = post.agentTrace && typeof post.agentTrace === 'object' ? post.agentTrace : {};
  const slides = Array.isArray(content.slides) ? content.slides : [];
  const docSource = content.carouselHtml || trace.layout?.html || trace.carousel?.html || '';
  const doc = /<article\b/i.test(docSource) ? docSource : '';
  const arts = doc ? articlesOf(doc) : [];
  const context = [content.title, trace.strategyBrief?.angle, trace.strategyBrief?.centralFact]
    .filter((v) => typeof v === 'string' && v.trim()).join(' — ');

  // every (slide, photo) without a focus
  const wanted = new Map(); // `${slide}|${key}` → { slide, key, words, sig }
  const want = (slideNo, tag, html) => {
    const key = keyOf(tag);
    if (!key || hasFocus(tag) || !owns(key)) return;
    const s = slides[slideNo - 1] || {};
    const words = plain(html) || [s.title, s.subtitle, s.body].filter(Boolean).join(' ');
    wanted.set(`${slideNo}|${key}`, { slide: slideNo, key, words, sig: sigOf(words, key) });
  };
  arts.forEach((a, i) => (a.html.match(IMG_TAG) || []).forEach((tag) => want(i + 1, tag, a.html)));
  slides.forEach((s, i) => (String(s?.layoutHtml || '').match(IMG_TAG) || []).forEach((tag) => want(i + 1, tag, s.layoutHtml)));
  if (!wanted.size) return { changed: false, added: 0, calls: 0, rows: [] };

  // cached answers first, then the agent (a few at a time)
  const cache = Array.isArray(post.photoFocus) ? post.photoFocus : [];
  const found = new Map();
  const todo = [];
  wanted.forEach((w, id) => {
    const hit = cache.find((c) => c && c.slide === w.slide && c.key === w.key && c.sig === w.sig);
    if (hit) found.set(id, hit.box || null); else todo.push([id, w]);
  });
  const rows = [];
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const [id, w] = todo[next];
      next += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        const t0 = Date.now();
        const r = await focusForPhoto({ key: w.key, words: w.words, context });
        found.set(id, r.box);
        rows.push({ ...w, ...r, elapsedMs: Date.now() - t0 });
      } catch (err) {
        // an outage / billing error is not an answer: leave the photo unmarked
        // so a later open asks again
        rows.push({ ...w, box: null, model: FOCUS_MODEL(), error: err.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY(), todo.length) }, worker));

  // write the attribute — "none" when the agent answered without a usable box,
  // so that photo is not asked again
  const mark = (slideNo, html) => html.replace(IMG_TAG, (tag) => {
    const key = keyOf(tag);
    const id = `${slideNo}|${key}`;
    if (!key || hasFocus(tag) || !found.has(id)) return tag;
    return withFocus(tag, found.get(id));
  });
  let changed = false;
  if (arts.length) {
    let out = '';
    let at = 0;
    arts.forEach((a, i) => { out += doc.slice(at, a.start) + mark(i + 1, a.html); at = a.end; });
    out += doc.slice(at);
    if (out !== doc) { content.carouselHtml = out; changed = true; }
  }
  slides.forEach((s, i) => {
    if (!s?.layoutHtml) return;
    const out = mark(i + 1, s.layoutHtml);
    if (out !== s.layoutHtml) { s.layoutHtml = out; changed = true; }
  });

  // cache: keep the newest answer per slide + photo (failures are not cached)
  const fresh = rows.filter((r) => r.box).map((r) => ({ slide: r.slide, key: r.key, sig: r.sig, box: r.box, subject: r.subject }));
  if (fresh.length) {
    const keep = cache.filter((c) => !fresh.some((f) => f.slide === c.slide && f.key === c.key));
    post.photoFocus = [...keep, ...fresh].slice(-200);
  }
  return { changed, added: found.size, calls: todo.length, rows };
}

module.exports = { annotatePostPhotos, focusForPhoto, FOCUS_TOOL };
