// Design in Canva › Reimagine (experimental): the carousel agent's slides are
// reimagined by Canva as high-quality Instagram posts — Canva's layouts, the
// slide's exact words and the post's real photos.
//
// Canva's AI alone (generate-design) rewrites words, drops lines and uses stock
// photos instead of the asset it is given (Oct 2026 probes), so per slide:
//   1. the carousel agent's slide (its words by data-slot, photos, palette,
//      fonts, composition) → a generate-design brief, the slide's photos
//      uploaded to the studio's Canva as assets
//   2. a candidate is saved (create-design-from-candidate) and read back as
//      elements + a picture (read-design, editing transaction)
//   3. the Canva planner agent (OpenAI, prompts/canva-reimagine-planner.md)
//      writes edit operations: exact words into its text boxes, the real
//      photos into its frames, stock imagery out, palette on
//   4. edit-design applies them; a deterministic check (every line present,
//      no invented text, a real photo used) → one corrective pass → commit
//   5. a candidate that still fails is followed by the next one (CANVA_REIMAGINE_TRIES)
// The chosen slides are exported back as the post's slides and merged into one
// Canva carousel design (merge-designs), so Open in Canva / Refresh work.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { jsonrepair } = require('jsonrepair');
const { withCanva } = require('./canvaMcp');
const { completeText } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { getObjectBytes } = require('./s3Client');
const {
  canvaFetchableUrl, exportDesignPages, pool, photoKeysOf, attrOf, clean, textOf, listOf, CONCURRENCY, GENERIC_FONTS,
} = require('./canvaCarouselAgent');

const TRIES = Math.max(1, Math.min(4, Number(process.env.CANVA_REIMAGINE_TRIES) || 2));
// slides reimagined at once — each spends most of its time waiting on Canva's
// generation and the planner, so the whole carousel takes about one slide's time
const SLIDE_CONCURRENCY = Math.max(1, Number(process.env.CANVA_REIMAGINE_CONCURRENCY) || 5);
const PLANNER_TIMEOUT_MS = Math.max(30000, Number(process.env.CANVA_PLANNER_TIMEOUT_MS) || 90000);
const FIX_EFFORT = ['minimal', 'low', 'medium', 'high'].includes(process.env.CANVA_PLANNER_FIX_EFFORT) ? process.env.CANVA_PLANNER_FIX_EFFORT : 'medium';
const PLANNER_MAX_TOKENS = Math.max(2000, Number(process.env.CANVA_PLANNER_MAX_TOKENS) || 16000);
const PHOTOS_PER_SLIDE = 3;
const INTENT = 'Reimagine one carousel slide as a high-quality Instagram post with the studio\'s words and photos';

let promptCache = '';
function plannerPrompt() {
  if (!promptCache) promptCache = fs.readFileSync(path.join(__dirname, '..', '..', 'prompts', 'canva-reimagine-planner.md'), 'utf8');
  return promptCache;
}

// ── the carousel agent's slide, read ─────────────────────────────────────────
const decode = (s) => String(s)
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&ldquo;/g, '“').replace(/&rdquo;/g, '”')
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/\s+/g, ' ')
  .trim();
const ARTICLE_RE = /<article\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi;
const firstFamily = (v) => String(v || '').split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).find((f) => f && !GENERIC_FONTS.has(f.toLowerCase())) || '';

/**
 * Each slide of the carousel document as the reimagining needs it.
 * → [{ index, role, texts: [{ slot, text, emphasis }], photos: [{ key, alt }], layout, palette, fonts }]
 */
function carouselSlideSpecs(doc, slides, { own, brand = {} }) {
  const html = String(doc || '');
  const rootVar = (name) => (html.match(new RegExp(`--brand-${name}\\s*:\\s*([^;}]+)`, 'i')) || [])[1]?.trim() || '';
  const kit = brand.palette || {};
  const palette = {
    text: kit.primary || rootVar('primary') || '#1F1F1F',
    background: kit.background || rootVar('background') || '#F5F1EA',
    accent: kit.accent || rootVar('accent') || '#B4552D',
  };
  const fonts = {
    heading: brand.fonts?.heading?.family || firstFamily(rootVar('font-heading')),
    body: brand.fonts?.body?.family || firstFamily(rootVar('font-body')),
  };
  const total = slides.length;
  const specs = [];
  for (const m of html.matchAll(ARTICLE_RE)) {
    const block = m[0];
    const open = block.match(/^<article\b[^>]*>/i)[0];
    const index = Number(attrOf(open, 'data-index')) || specs.length + 1;
    const stored = slides[index - 1] || {};
    // words, in the order the slide reads them
    const texts = [];
    const seen = new Set();
    for (const t of block.matchAll(/<(h[1-6]|p|span|li|blockquote|figcaption|div|a|strong)\b([^>]*\bdata-slot\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const slot = t[3];
      if (/^(image|illustration)$/i.test(slot)) continue;
      const text = decode(t[4]);
      if (!text || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      const emphasis = [...t[4].matchAll(/<(em|strong)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((e) => decode(e[2])).filter(Boolean);
      texts.push({ slot, text, ...(emphasis.length ? { emphasis } : {}) });
    }
    // a slide that is a picture (a Theme Apply / Canva render) has no live
    // words in its html — its stored copy stands in
    if (!texts.length) {
      [['title', textOf(stored.title)], ['supporting-text', textOf(stored.subtitle)],
        ['body', textOf(stored.body)], ...listOf(stored.items).map((x) => ['item', x]), ['action', textOf(stored.action)]]
        .forEach(([slot, text]) => { if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); texts.push({ slot, text }); } });
    }
    // photos: frames bound by key, then the slide's own photos (never a render)
    const photos = [];
    const add = (key, alt = '') => {
      if (key && key.startsWith(own) && !/\/themed-/.test(key) && !photos.some((p) => p.key === key)) photos.push({ key, alt: decode(alt) });
    };
    for (const img of block.matchAll(/<img\b[^>]*>/gi)) add(attrOf(img[0], 'data-asset-key'), attrOf(img[0], 'alt'));
    photoKeysOf(stored, own).forEach((k) => add(k));
    const fullBleed = /<img\b[^>]*(?:width:\s*100%[^>]*height:\s*100%|class\s*=\s*["'][^"']*(?:bleed|full|cover)[^"']*["'])/i.test(block)
      && /left:\s*0(px)?;[^"]*top:\s*0(px)?;[^"]*width:\s*1080px/i.test(block);
    const layout = !photos.length ? 'type-led slide, no photo'
      : fullBleed ? 'full-bleed photo with the words on a panel over it'
        : 'photo and words side by side';
    specs.push({
      index,
      role: index === 1 ? 'cover / hook' : index === total ? 'closing slide' : 'content slide',
      texts,
      photos: photos.slice(0, PHOTOS_PER_SLIDE),
      layout,
      palette,
      fonts,
    });
  }
  return specs;
}

// the generate-design brief for one slide (Canva sees no earlier call)
function reimagineQuery({ spec, total, brief = {}, brand = {} }) {
  const line = (t) => {
    const label = { eyebrow: 'Eyebrow', title: 'Headline', 'supporting-text': 'Supporting text', body: 'Body', action: 'Call to action', item: 'List item' }[t.slot] || t.slot;
    return `${label}: "${t.text}"${t.emphasis?.length ? ` (accent colour on "${t.emphasis.join('", "')}")` : ''}`;
  };
  return [
    `Reimagine slide ${spec.index} of ${total} (${spec.role}) of an Instagram carousel as a high-quality, premium editorial Instagram post: magazine-grade composition, clear hierarchy, generous margins, crisp alignment.`,
    brand.offer && `Brand: ${clean(brand.offer).slice(0, 200)}`,
    brief.angle && `Post angle: ${textOf(brief.angle).slice(0, 240)}`,
    'Exact text — every line, word for word, nothing added (no tags, labels, logos or handles):',
    ...spec.texts.map(line),
    spec.photos.length
      ? `Photo-led: the main image must be my uploaded photo${spec.photos.length > 1 ? 's' : ''} of the real project${spec.photos[0].alt ? ` (${spec.photos[0].alt})` : ''} — large and recognisable; no stock photos.`
      : 'Type-led: no photos of people or rooms; colour, shapes and type carry it.',
    `Our carousel's version: ${spec.layout}.`,
    `Palette: text ${spec.palette.text}, background ${spec.palette.background}, accent ${spec.palette.accent}.${spec.fonts.heading ? ` Headline font like ${spec.fonts.heading}` : ''}${spec.fonts.body ? `, body like ${spec.fonts.body}.` : ''}`,
    'Same palette and type on every slide so the carousel reads as one set.',
  ].filter(Boolean).join('\n');
}

// ── the candidate, as the planner reads it ───────────────────────────────────
const round = (n) => Math.round(Number(n) || 0);
function mediaOf(fill) {
  const m = fill?.media;
  return m?.type === 'image' && m.mediaId ? m.mediaId : '';
}
function compactPage(page) {
  return {
    page_id: page.id,
    page_locator_id: page.locator_id,
    size: page.dimensions,
    background: mediaOf(page.background) ? { image: mediaOf(page.background), replaceable: page.background.isMediaReplaceable !== false }
      : (page.background?.color || page.background || null),
    elements: (page.elements || []).map((e) => ({
      locator_id: e.locator_id,
      type: e.type,
      box: [round(e.left), round(e.top), round(e.width), round(e.height)],
      ...(e.type === 'text' ? {
        text: (e.textRegions || []).map((r) => r.characters).join(''),
        style: (() => {
          const f = e.textRegions?.[0]?.formatting || {};
          return { size: round(f.fontSize), weight: f.fontWeight, color: f.color, align: f.textAlign };
        })(),
      } : {}),
      ...(mediaOf(e.fill) ? { image: mediaOf(e.fill) } : {}),
      ...(e.fill?.color ? { fill: e.fill.color } : {}),
      ...(e.isLocked ? { locked: true } : {}),
    })),
  };
}

// What still does not carry the slide: missing / invented words, no real photo.
const norm = (s) => String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
function pageProblems(page, spec, assetIds, { optionalLabels = false } = {}) {
  const texts = (page.elements || []).filter((e) => e.type === 'text')
    .map((e) => ({ id: e.locator_id, text: (e.textRegions || []).map((r) => r.characters).join('') }))
    .filter((t) => norm(t.text));
  const want = spec.texts.map((t) => norm(t.text));
  const absent = spec.texts.filter((t) => !texts.some((x) => norm(x.text) === norm(t.text)));
  // without add_text a label line with no box left is a soft miss
  const missing = absent.filter((t) => !(optionalLabels && OPTIONAL_SLOTS.test(t.slot)));
  const softMissing = absent.length - missing.length;
  const extras = texts.filter((x) => !want.includes(norm(x.text)));
  const media = [
    ...(mediaOf(page.background) ? [{ id: mediaOf(page.background), area: 1, locator: page.locator_id }] : []),
    ...(page.elements || []).filter((e) => mediaOf(e.fill)).map((e) => ({
      id: mediaOf(e.fill),
      area: (Number(e.width) * Number(e.height)) / ((page.dimensions?.width || 1080) * (page.dimensions?.height || 1350)),
      locator: e.locator_id,
    })),
  ];
  const photoUsed = !assetIds.length || media.some((m) => assetIds.includes(m.id));
  const strangers = media.filter((m) => !assetIds.includes(m.id) && m.area > 0.12);
  // text boxes that collide (with each other, or with a thin rule / small shape)
  const boxOf = (e) => ({ id: e.locator_id, l: Number(e.left) || 0, t: Number(e.top) || 0, r: (Number(e.left) || 0) + (Number(e.width) || 0), b: (Number(e.top) || 0) + (Number(e.height) || 0) });
  const hit = (a, b) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 4 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 4;
  const textBoxes = (page.elements || []).filter((e) => e.type === 'text' && norm((e.textRegions || []).map((r) => r.characters).join(''))).map(boxOf);
  const rules = (page.elements || []).filter((e) => e.type !== 'text' && Number(e.height) < 60 && Number(e.width) < 900).map(boxOf);
  const overlaps = [];
  textBoxes.forEach((a, i) => {
    textBoxes.slice(i + 1).forEach((b) => { if (hit(a, b)) overlaps.push(`text ${a.id} overlaps text ${b.id} — move or resize one`); });
    rules.forEach((b) => { if (hit(a, b)) overlaps.push(`text ${a.id} runs over the rule/shape ${b.id} — move the text or the rule`); });
  });
  const W = page.dimensions?.width || 1080;
  const H = page.dimensions?.height || 1350;
  const offPage = textBoxes.filter((a) => a.l < 0 || a.t < 0 || a.r > W || a.b > H).map((a) => `text ${a.id} runs off the page — move it inside the 64 px margin`);
  // words straight on a studio photo with nothing solid behind them read badly
  // (a real photo is busy): a text box over a photo needs another filled
  // element (a panel / plain frame) under it, or it has to move
  const pageBox = { l: 0, t: 0, r: W, b: H };
  const photoBoxes = [
    ...(assetIds.includes(mediaOf(page.background)) ? [{ ...pageBox, id: page.locator_id }] : []),
    ...(page.elements || []).filter((e) => assetIds.includes(mediaOf(e.fill))).map(boxOf),
  ];
  const panels = (page.elements || []).filter((e) => e.type !== 'text' && !assetIds.includes(mediaOf(e.fill)) && Number(e.width) * Number(e.height) > 0
    && (mediaOf(e.fill) || e.fill?.color)).map(boxOf);
  const inside = (a, b) => a.l >= b.l - 4 && a.t >= b.t - 4 && a.r <= b.r + 4 && a.b <= b.b + 4;
  const onPhoto = textBoxes.filter((a) => photoBoxes.some((ph) => hit(a, ph)) && !panels.some((pn) => inside(a, pn)))
    .map((a) => `text ${a.id} sits directly on a studio photo — move the photo into a frame clear of the text (not the page background), or move the text onto a plain area`);
  const problems = [
    ...absent.map((t) => `missing line (${t.slot}): "${t.text}"${missing.includes(t) ? '' : ' (no text box left — only if one can be freed)'}`),
    ...overlaps,
    ...offPage,
    ...onPhoto,
    ...extras.map((x) => `text not on the slide — replace or delete ${x.id}: "${x.text.slice(0, 80)}"`),
    ...(photoUsed ? [] : ['none of the studio\'s photos is on the page — update_fill the main frame (or the page background) with photo 1']),
    ...strangers.map((m) => `image ${m.id} at ${m.locator} (${Math.round(m.area * 100)}% of the page) is not a studio photo — if it shows people, rooms, furniture or objects, replace it with a studio photo or delete it`),
  ];
  return {
    problems,
    hard: missing.length + extras.length + (photoUsed ? 0 : 1) + overlaps.length + offPage.length + onPhoto.length,
    // worth another candidate (a whole extra minute): a line or the real photo is missing
    severe: missing.length + (photoUsed ? 0 : 1),
    score: missing.length * 3 + softMissing + extras.length * 2 + (photoUsed ? 0 : 3) + (overlaps.length + offPage.length + onPhoto.length) * 1.5 + strangers.length * 0.5,
  };
}

// ── the planner (OpenAI) ─────────────────────────────────────────────────────
const OP_TYPES = new Set(['replace_text', 'delete_element', 'update_fill', 'insert_fill', 'add_text', 'format_text', 'position_element',
  'resize_element', 'recolor_element', 'update_opacity', 'layer_element']);
// a label line that may go when the layout has no box left for it and the
// editor cannot add one (the legacy tool set)
const OPTIONAL_SLOTS = /^(eyebrow|label|kicker|tag)$/i;

// ── the two Canva editing tool sets ──────────────────────────────────────────
// Which tools a Canva MCP session offers depends on the OAuth client: Claude's
// own connector gets read-design / edit-design (locator ids, add_text, recolor…);
// an app registered through dynamic client registration got the older set —
// start-editing-transaction / perform-editing-operations / get-design-thumbnail
// / commit- / cancel-editing-transaction (element ids, no add_text, no recolor,
// no formatting in the read). Both are read into the same page model.
function legacyPage(res) {
  const info = (res?.pages || [])[0] || {};
  const pageId = info.page_id || '';
  const box = (c) => ({ left: Number(c?.position?.left) || 0, top: Number(c?.position?.top) || 0, width: Number(c?.dimension?.width) || 0, height: Number(c?.dimension?.height) || 0 });
  const onPage = (x) => (Number(x?.page_index) || 1) === 1;
  const bg = (res?.fills || []).find((f) => onPage(f) && f.element_id === pageId);
  return {
    type: info.is_responsive ? 'responsive' : 'fixed',
    id: pageId,
    locator_id: pageId,
    isEditable: info.is_editable !== false,
    dimensions: info.dimension || { width: 1080, height: 1350 },
    background: bg ? { media: { type: 'image', mediaId: bg.asset_id } } : null,
    elements: [
      ...(res?.richtexts || []).filter(onPage).map((t) => ({
        locator_id: t.element_id,
        type: 'text',
        ...box(t.containerElement),
        textRegions: [{ characters: (t.regions || []).map((r) => r.text || '').join('') }],
      })),
      ...(res?.fills || []).filter((f) => onPage(f) && f.element_id !== pageId).map((f) => ({
        locator_id: f.element_id,
        type: String(f.containerElement?.type || 'rect').toLowerCase(),
        ...box(f.containerElement),
        fill: { media: { type: f.type === 'video' ? 'video' : 'image', mediaId: f.asset_id } },
        ...(f.editable === false ? { isLocked: true } : {}),
      })),
    ],
  };
}

const okStatus = (r) => !r?.status || /applied|success/i.test(r.status);
const opErrors = (res) => (res?.edit_operation_results || []).filter((r) => !okStatus(r))
  .map((r) => `${r.operation_info?.type || 'edit'}: ${r.status}${r.message ? ` — ${r.message}` : ''}`);

function editorFor(call, tools) {
  const has = (n) => !tools.size || tools.has(n);
  if (tools.has('read-design') && tools.has('edit-design')) {
    return {
      kind: 'edit-design',
      ops: [...OP_TYPES],
      async open(designId) {
        const read = await call('read-design', { design_id: designId, open_transaction: true, filter: { fields: ['design_content', 'thumbnails'] }, user_intent: INTENT });
        const txId = read?.transaction?.transaction_id;
        const page = read?.design_content?.pages?.[0];
        const picture = read._images?.[0] || (read.thumbnails?.[0]?.url ? await fetchPicture(read.thumbnails[0].url) : null);
        return { txId, page, picture };
      },
      apply: (txId, ops, page) => applyOps(call, txId, ops, page),
      commit: (txId) => call('edit-design', { transaction_id: txId, finalize: 'commit', user_intent: INTENT }),
      cancel: (txId) => call('edit-design', { transaction_id: txId, finalize: 'cancel', user_intent: INTENT }),
    };
  }
  if (has('start-editing-transaction') && has('perform-editing-operations') && has('commit-editing-transaction')) {
    const LEGACY = new Set(['replace_text', 'delete_element', 'update_fill', 'insert_fill', 'format_text', 'position_element', 'resize_element']);
    return {
      kind: 'editing-transaction',
      ops: [...LEGACY],
      async open(designId) {
        const st = await call('start-editing-transaction', { design_id: designId, user_intent: INTENT });
        const txId = st?.transaction?.transaction_id || st?.transaction_id;
        const page = legacyPage(st);
        let picture = st._images?.[0] || null;
        if (!picture && txId && tools.has('get-design-thumbnail')) {
          const th = await call('get-design-thumbnail', { transaction_id: txId, page_index: 1, user_intent: INTENT }).catch(() => null);
          picture = th?._images?.[0] || (th?.thumbnails?.[0]?.url ? await fetchPicture(th.thumbnails[0].url) : null);
        }
        if (!picture && st?.thumbnails?.[0]?.url) picture = await fetchPicture(st.thumbnails[0].url);
        return { txId, page, picture };
      },
      async apply(txId, ops, page) {
        const list = ops.filter((o) => LEGACY.has(o.type)).map(({ ref, locator_id: id, ...o }) => (o.type === 'insert_fill' ? o : { ...o, element_id: id }));
        if (!list.length) return { page, picture: null, errors: [] };
        try {
          const res = await call('perform-editing-operations', { transaction_id: txId, page_index: 1, operations: list, user_intent: INTENT });
          return {
            page: res?.richtexts || res?.fills ? legacyPage(res) : page,
            picture: res?._images?.[0] || (res?.thumbnails?.[0]?.url ? await fetchPicture(res.thumbnails[0].url) : null),
            errors: opErrors(res),
          };
        } catch (err) {
          return { page, picture: null, errors: [err.message] };
        }
      },
      commit: (txId) => call('commit-editing-transaction', { transaction_id: txId, user_intent: INTENT }),
      cancel: (txId) => call('cancel-editing-transaction', { transaction_id: txId, user_intent: INTENT }),
    };
  }
  return null;
}

async function planCanvaEdits({ spec, page, picture, photoImages, assets, series, problems = [], allowed = [...OP_TYPES], reasoningEffort }) {
  const llm = resolvePlanAgentLlm('canvaPlanner');
  const slide = {
    index: spec.index,
    role: spec.role,
    texts: spec.texts,
    photos: assets.map((a, i) => ({ n: i + 2, asset_id: a.assetId, alt: a.alt || '' })),
    original_layout: spec.layout,
  };
  const user = [
    `SLIDE:\n${JSON.stringify(slide, null, 1)}`,
    `PALETTE:\n${JSON.stringify(spec.palette)}${spec.fonts.heading ? `\nFonts in our carousel: headline ${spec.fonts.heading}, body ${spec.fonts.body || spec.fonts.heading} (Canva keeps its own fonts — match the feel, not the name)` : ''}`,
    `SERIES:\n${series}`,
    `ALLOWED_OPS: ${allowed.join(', ')}${allowed.includes('add_text') ? '' : '\nThis Canva editor cannot add text, recolour shapes or change layers: every line must go into one of the CANDIDATE\'s text elements (text sizes are not shown — judge them from the picture and set them with format_text). Use every text element you can; delete the rest.'}`,
    `CANDIDATE:\n${JSON.stringify(compactPage(page))}`,
    problems.length ? `PROBLEMS (second pass — fix these):\n${problems.map((p) => `- ${p}`).join('\n')}` : '',
    'Image 1 is the CANDIDATE as it looks now.',
  ].filter(Boolean).join('\n\n');
  const response = await completeText({
    model: llm.model,
    system: plannerPrompt(),
    user,
    images: [picture, ...photoImages].filter((x) => x?.data),
    maxTokens: PLANNER_MAX_TOKENS,
    kind: 'canvaPlanner',
    ...(reasoningEffort ? { reasoningEffort } : {}),
    cacheKey: 'igsignal-canva-planner',
    timeoutMs: PLANNER_TIMEOUT_MS,
  });
  const text = String(response.text || '');
  let parsed = {};
  try {
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    parsed = JSON.parse(jsonrepair(json));
  } catch {
    throw new Error('the Canva planner did not answer JSON');
  }
  const u = response.usage || {};
  const usage = {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    estimatedCostUsd: estimatePlanCostUsd(llm.model, u.input_tokens || 0, u.output_tokens || 0, u.cached_tokens || 0),
  };
  return { ops: Array.isArray(parsed.ops) ? parsed.ops : [], notes: clean(parsed.notes), usage, model: llm.model, prompt: user };
}

// keep only operations Canva will take on this page
function validOps(ops, page, assetIds, allowed = OP_TYPES) {
  const locators = new Set([page.locator_id, ...(page.elements || []).map((e) => e.locator_id)]);
  const refs = new Set(ops.filter((o) => o?.type === 'add_text' && o.ref).map((o) => String(o.ref)));
  const dropped = [];
  const kept = ops.filter((o) => {
    const ok = o && OP_TYPES.has(o.type) && allowed.has(o.type)
      && (o.type === 'add_text' ? o.page_id === page.id && clean(o.text)
        : o.type === 'insert_fill' ? o.page_id === page.id
          : (locators.has(o.locator_id) || refs.has(String(o.locator_id))))
      && (o.type !== 'update_fill' || assetIds.includes(o.asset_id));
    if (!ok) dropped.push(o?.type || '?');
    return ok;
  }).map((o) => (o.type === 'update_fill' || o.type === 'insert_fill' ? { ...o, asset_type: 'image', alt_text: clean(o.alt_text).slice(0, 240) || 'Project photo' } : o));
  return { kept, dropped };
}

// Apply on page 1 of the open transaction. add_text items carry a `ref`; the
// operations that point at a ref go in a second call, once Canva has given the
// new text its locator id. → { page, picture, errors }
async function applyOps(call, txId, ops, page) {
  const refs = new Set(ops.filter((o) => o.type === 'add_text' && o.ref).map((o) => String(o.ref)));
  const isRef = (o) => o.type !== 'add_text' && refs.has(String(o.locator_id));
  const strip = ({ ref, ...o }) => o;
  const errors = [];
  let current = page;
  let picture = null;
  const run = async (list) => {
    if (!list.length) return;
    try {
      const res = await call('edit-design', { transaction_id: txId, page_index: 1, finalize: 'keep_open', operations: list.map(strip), user_intent: INTENT });
      if (res?.document?.page) current = res.document.page;
      errors.push(...opErrors(res));
      picture = res?._images?.[0] || (res?.thumbnail_urls?.[0] ? await fetchPicture(res.thumbnail_urls[0]) : picture);
    } catch (err) {
      errors.push(err.message);
    }
  };
  const before = new Set((page.elements || []).map((e) => e.locator_id));
  await run(ops.filter((o) => !isRef(o)));
  const later = ops.filter(isRef);
  if (later.length) {
    // each added line → the new text element that holds it
    const added = (current.elements || []).filter((e) => !before.has(e.locator_id) && e.type === 'text');
    const refOf = {};
    ops.filter((o) => o.type === 'add_text' && o.ref).forEach((o) => {
      const hit = added.find((e) => norm((e.textRegions || []).map((r) => r.characters).join('')) === norm(o.text));
      if (hit) refOf[String(o.ref)] = hit.locator_id;
    });
    await run(later.filter((o) => refOf[String(o.locator_id)]).map((o) => ({ ...o, locator_id: refOf[String(o.locator_id)] })));
  }
  return { page: current, picture, errors };
}

async function fetchPicture(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).resize(640, 800, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
    return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

async function photoForPlanner(key) {
  try {
    const { buffer } = await getObjectBytes(key);
    const jpeg = await sharp(buffer).rotate().resize(512, 512, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
    return { data: jpeg.toString('base64'), mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

// ── one slide ────────────────────────────────────────────────────────────────
async function reimagineSlide(call, { spec, total, brief, brand, assetOf, series, own, editor }) {
  const t0 = Date.now();
  const assets = spec.photos.map((p) => ({ ...p, assetId: assetOf[p.key] })).filter((a) => a.assetId);
  const assetIds = assets.map((a) => a.assetId);
  const photoImages = (await Promise.all(assets.map((a) => photoForPlanner(a.key)))).filter(Boolean);
  const query = reimagineQuery({ spec, total, brief, brand });
  const ask = (withAssets) => call('generate-design', {
    query,
    design_type: 'instagram_post',
    ...(withAssets && assetIds.length ? { asset_ids: assetIds } : {}),
    user_intent: INTENT,
  });
  let gen;
  try { gen = await ask(true); } catch (err) {
    if (!assetIds.length) throw err;
    gen = await ask(false);
  }
  const job = gen?.job || gen;
  const candidates = job?.result?.generated_designs || [];
  if (!job?.id || !candidates.length) throw new Error(job?.status && job.status !== 'success' ? `Canva generation ${job.status}` : 'Canva returned no designs');

  const attempts = [];
  let best = null;
  const usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
  const addUsage = (u) => { if (!u) return; usage.inputTokens += u.inputTokens; usage.outputTokens += u.outputTokens; usage.estimatedCostUsd += u.estimatedCostUsd; };
  const allowed = new Set(editor.ops);
  const canAdd = allowed.has('add_text');
  const needBoxes = spec.texts.filter((t) => canAdd || !OPTIONAL_SLOTS.test(t.slot)).length;
  let planned = 0;
  // up to TRIES candidates are planned; without add_text a layout with too few
  // text boxes for the slide's lines is passed over (up to all four looked at)
  for (const cand of candidates) {
    // the next candidate only when the best so far lost a line or the photo
    if (planned >= TRIES || (best && !best.severe)) break;
    const attempt = { candidate: cand.candidate_id, passes: [] };
    attempts.push(attempt);
    try {
      const made = await call('create-design-from-candidate', { job_id: job.id, candidate_id: cand.candidate_id, user_intent: INTENT });
      const design = made?.design_summary || made?.design || made;
      if (!design?.id) throw new Error('Canva did not save the design');
      attempt.designId = design.id;
      attempt.editUrl = design.urls?.edit_url || '';
      const opened = await editor.open(design.id);
      const { txId } = opened;
      let { page, picture } = opened;
      if (!txId || !page) throw new Error('Canva did not open the design for editing');
      if (page.type !== 'fixed' || page.isEditable === false) {
        await editor.cancel(txId).catch(() => {});
        throw new Error('the layout is not an editable fixed page');
      }
      const boxes = (page.elements || []).filter((e) => e.type === 'text').length;
      const lastChance = cand === candidates[candidates.length - 1] && !best;
      if (!canAdd && boxes < needBoxes && !lastChance) {
        await editor.cancel(txId).catch(() => {});
        throw new Error(`only ${boxes} text boxes for ${needBoxes} lines`);
      }
      planned += 1;
      const opts = { optionalLabels: !canAdd };
      let check = pageProblems(page, spec, assetIds, opts);
      // a first pass, then one corrective pass while the words or photo are wrong
      for (let pass = 1; pass <= 2; pass += 1) {
        if (pass === 2 && !check.hard) break;
        const tPlan = Date.now();
        // the first pass at the planner's default (low, fast); the fix pass, only
        // for a slide still broken, thinks harder — at low it left overlaps in place
        const plan = await planCanvaEdits({
          spec, page, picture, photoImages, assets, series, problems: pass === 1 ? [] : check.problems, allowed: [...allowed],
          ...(pass === 2 ? { reasoningEffort: FIX_EFFORT } : {}),
        });
        const planMs = Date.now() - tPlan;
        addUsage(plan.usage);
        const { kept, dropped } = validOps(plan.ops, page, assetIds, allowed);
        const applied = kept.length ? await editor.apply(txId, kept, page) : { page, picture: null, errors: [] };
        page = applied.page;
        picture = applied.picture || picture;
        check = pageProblems(page, spec, assetIds, opts);
        attempt.passes.push({
          pass, planMs, model: plan.model, notes: plan.notes, ops: kept.length, dropped, errors: applied.errors,
          problems: check.problems, prompt: pass === 1 ? plan.prompt : undefined,
        });
      }
      await editor.commit(txId);
      attempt.score = check.score;
      attempt.hard = check.hard;
      attempt.severe = check.severe;
      if (!best || check.score < best.score) best = { ...attempt };
    } catch (err) {
      attempt.error = err.message;
    }
  }
  if (!best?.designId) throw new Error(attempts.map((a) => a.error).filter(Boolean)[0] || 'no Canva candidate could be reimagined');
  // a broken page never replaces the slide: overlapping or missing words, or no
  // real photo, after both passes → the slide keeps its design (the Canva
  // design stays in the studio's Canva to fix by hand)
  if (best.hard) {
    const left = (best.passes.at(-1)?.problems || []).filter((q) => !/not a studio photo|no text box left/.test(q));
    throw Object.assign(new Error(`Canva's layout could not be fixed (${left.length ? left.slice(0, 2).join('; ') : 'layout problems'}) — the slide keeps its design. Try Reimagine this slide again.`), { attempts, designId: best.designId, editUrl: best.editUrl });
  }
  const exported = await exportDesignPages(call, best.designId, { [spec.index]: 1 }, own);
  const page = exported[spec.index];
  if (!page?.key) throw new Error(page?.error || 'export failed');
  return {
    key: page.key,
    src: page.src,
    designId: best.designId,
    editUrl: best.editUrl,
    query,
    candidates: candidates.length,
    attempts,
    problems: best.passes.at(-1)?.problems || [],
    usage,
    elapsedMs: Date.now() - t0,
  };
}

// the chosen per-slide designs as ONE Canva carousel (merge-designs takes one
// operation per call: create with the first, append the rest)
async function mergeCarousel(call, designIds, title) {
  const first = await call('merge-designs', {
    type: 'create_new_design',
    title,
    operations: [{ type: 'insert_pages', source: { type: 'design', design_id: designIds[0] } }],
    user_intent: 'Assemble the reimagined slides into one carousel design',
  });
  const made = first?.job?.result?.design || first?.design;
  if (!made?.id) throw new Error('Canva did not create the carousel design');
  let last = made;
  for (const id of designIds.slice(1)) {
    const r = await call('merge-designs', {
      type: 'modify_existing_design',
      design_id: made.id,
      operations: [{ type: 'insert_pages', source: { type: 'design', design_id: id } }],
      user_intent: 'Append the next reimagined slide to the carousel design',
    });
    last = r?.job?.result?.design || last;
  }
  return { id: made.id, editUrl: last.urls?.edit_url || made.urls?.edit_url || '', viewUrl: last.urls?.view_url || made.urls?.view_url || '', pageCount: Number(last.page_count) || designIds.length };
}

/**
 * @param {object} p
 * @param {string} p.userId
 * @param {string} p.doc        the carousel document (content.carouselHtml or its import source)
 * @param {object[]} p.slides   the post's stored slides
 * @param {number[]} p.indexes  1-based slides to reimagine
 * @param {object} [p.brief]    agentTrace.strategyBrief
 * @param {object} [p.brand]    carouselBrandOf(...)
 * @param {string} [p.title]
 * → { design, results: { [index]: {...} | { error } }, usage, elapsedMs }
 */
async function reimagineCarouselInCanva({ userId, doc, slides = [], indexes = [], brief = {}, brand = {}, title = '' }) {
  const started = Date.now();
  const own = `projects/${userId}/`;
  const wanted = new Set(indexes.map(Number));
  const specs = carouselSlideSpecs(doc, slides, { own, brand }).filter((s) => wanted.has(s.index));
  if (!specs.length) throw Object.assign(new Error('None of those slides are in the carousel document — run Fix layout first.'), { status: 400 });
  const total = slides.length;
  const series = `${total}-slide carousel. Every slide: palette ${JSON.stringify(specs[0].palette)}, the same headline/body type pairing and alignment system, premium editorial finish. Slide 1 is the hook (biggest type), the last slide closes with the call to action.`;
  const results = {};
  const out = await withCanva(userId, async ({ call, tools, timings }) => {
    for (const need of ['generate-design', 'create-design-from-candidate', 'export-design']) {
      if (tools.size && !tools.has(need)) throw Object.assign(new Error(`This Canva account's MCP server does not offer ${need}.`), { status: 502 });
    }
    const editor = editorFor(call, tools);
    if (!editor) throw Object.assign(new Error('This Canva account\'s MCP server offers no design editing (neither edit-design nor editing transactions).'), { status: 502 });
    // every photo goes to Canva once
    const assetOf = {};
    const keys = [...new Set(specs.flatMap((s) => s.photos.map((p) => p.key)))];
    await pool(keys, CONCURRENCY + 1, async (key) => {
      try {
        const up = await call('upload-asset-from-url', { url: await canvaFetchableUrl(key), name: `bauhly-${key.split('/').pop()}`, user_intent: 'Import the post photo for the reimagined carousel' });
        const id = String(up?.job?.asset?.id || up?.asset?.id || up?.media_id || '');
        if (id) assetOf[key] = id;
      } catch (err) {
        console.warn(`[canva] photo ${key} not imported: ${err.message}`);
      }
    });
    await pool(specs, SLIDE_CONCURRENCY, async (spec) => {
      try {
        results[spec.index] = { ...(await reimagineSlide(call, { spec, total, brief, brand, assetOf, series, own, editor })), editor: editor.kind };
      } catch (err) {
        console.warn(`[canva] reimagine slide ${spec.index} failed: ${err.message}`);
        // (rejectedEditUrl, not designId: a rejected page is not merged into the carousel)
        results[spec.index] = { error: err.message, ...(err.attempts ? { attempts: err.attempts, rejectedEditUrl: err.editUrl } : {}) };
      }
    });
    const done = specs.map((s) => s.index).filter((i) => results[i]?.designId);
    let design = null;
    if (done.length > 1 && tools.has('merge-designs')) {
      try {
        const merged = await mergeCarousel(call, done.map((i) => results[i].designId), clean(title).slice(0, 120) || 'Bauhly carousel');
        design = { ...merged, pages: Object.fromEntries(done.map((i, n) => [i, n + 1])) };
      } catch (err) {
        console.warn(`[canva] carousel merge skipped: ${err.message}`);
      }
    }
    if (!design && done.length) {
      design = { id: results[done[0]].designId, editUrl: results[done[0]].editUrl, viewUrl: '', pages: { [done[0]]: 1 }, pageCount: 1 };
    }
    return { design, assets: Object.keys(assetOf).length, timings };
  });
  const usage = Object.values(results).reduce((acc, r) => ({
    inputTokens: acc.inputTokens + (r.usage?.inputTokens || 0),
    outputTokens: acc.outputTokens + (r.usage?.outputTokens || 0),
    estimatedCostUsd: acc.estimatedCostUsd + (r.usage?.estimatedCostUsd || 0),
  }), { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 });
  return { design: out.design, results, usage, photosSent: out.assets, timings: out.timings, elapsedMs: Date.now() - started };
}

module.exports = { reimagineCarouselInCanva, planCanvaEdits, editorFor, legacyPage, carouselSlideSpecs, reimagineQuery, pageProblems, validOps, compactPage };
