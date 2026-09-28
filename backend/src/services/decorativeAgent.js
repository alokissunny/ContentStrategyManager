/**
 * Decorative element generator — runs when the studio applies a theme from an
 * uploaded reference photo (Change theme › Upload a reference).
 *
 * It reads that photo and the post narrative, then renders a small set of
 * isolated motifs (a mountain range, a sign shape, a brush stroke — the drawn
 * marks in the reference, not the photo or the words). The carousel agent
 * places the same set across the slides. Catalog themes do not come through
 * here; their framing devices stay in CSS.
 *
 * Model: PLAN_DECORATIVE_MODEL / PLAN_DECORATIVE_PROVIDER (planAgentLlm
 * `decorative`). Renders: gpt-image-1, square PNG, transparent background.
 */
const fs = require('fs');
const path = require('path');
const { completeText, resolvePlanAgentLlm, splitPromptTemplate } = require('./llmComplete');
const { extractJson, estimatePlanCostUsd } = require('./weeklyPlan');
const { generateImage, isImageGenConfigured } = require('./openaiImage');
const { persistGeneratedImage } = require('./generatedImage');
const { getMediaUrl, isS3Configured } = require('./s3Client');

const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'plan-decorative.md');
let template = null;
function promptParts() {
  if (!template) template = splitPromptTemplate(fs.readFileSync(PROMPT_FILE, 'utf8'));
  return template;
}

function envFlagOff(name, fallback) {
  const v = String(process.env[name] ?? fallback).trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'off' || v === 'no';
}

function decorativeAgentEnabled() {
  if (envFlagOff('PLAN_DECORATIVE_AGENT', '1')) return false;
  return isImageGenConfigured() && isS3Configured();
}

function fill(templateText, vars) {
  let out = String(templateText || '');
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return out;
}

function slugId(raw, index) {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || `motif-${index + 1}`;
}

function clip(value, max) {
  const t = String(value || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function validatePlan(parsed) {
  const style = clip(parsed?.style, 400);
  const raw = Array.isArray(parsed?.elements) ? parsed.elements : [];
  const seen = new Set();
  const elements = [];
  raw.forEach((item, i) => {
    const prompt = clip(item?.prompt, 700);
    const usage = clip(item?.usage, 280);
    const name = clip(item?.name, 80);
    if (!prompt || !usage) return;
    let id = slugId(item?.id || name, i);
    if (seen.has(id)) id = slugId(`${id}-${i + 1}`, i);
    seen.add(id);
    elements.push({ id, name: name || id, prompt, usage });
  });
  if (elements.length < 2) throw new Error('decorative plan has fewer than 2 motifs');
  return { style, elements: elements.slice(0, 5) };
}

const RENDER_TAIL = [
  'One isolated decorative motif, centered, with generous padding around it.',
  'Transparent background. No scene, no floor, no sky filling the frame, no border, no frame, no drop shadow on a rectangle.',
  'No text, letters, words, numbers, logos, watermarks, or signatures.',
].join(' ');

function renderPromptOf(style, prompt) {
  return [style, prompt, RENDER_TAIL].filter(Boolean).join('\n\n');
}

async function mapPool(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const cap = Math.max(1, Math.min(Number(limit) || list.length, list.length || 1));
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= list.length) return;
      out[i] = await mapper(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(cap, list.length) }, () => worker()));
  return out;
}

/**
 * Plan motifs from the reference photo + narrative, render each as a
 * transparent PNG, store on S3.
 * @returns {Promise<{ style, elements, debugEntry, usage, source, imageModel, imageCostUsd, imageElapsedMs }>}
 */
async function generateDecorativeSet({
  source = 'Decorative',
  referenceImage,
  referenceNotes = '',
  narrative,
  userId,
  handle,
}) {
  if (!decorativeAgentEnabled()) {
    throw new Error('decorative agent is off or image storage is not configured');
  }
  if (!referenceImage?.data) throw new Error('no theme reference image');
  if (!userId) throw new Error('userId is required to store decorative elements');

  const llm = resolvePlanAgentLlm('decorative');
  const parts = promptParts();
  const narrativeJson = JSON.stringify(narrative && typeof narrative === 'object' ? narrative : {}, null, 2);
  const user = fill(parts.userTemplate || '', {
    REFERENCE_NOTES: String(referenceNotes || '').trim() || 'None — read the attached image.',
    NARRATIVE_JSON: narrativeJson,
  });
  const system = parts.system || '';
  const started = Date.now();
  const inputImage = {
    label: referenceImage.debug?.label || 'Theme reference',
    ...(referenceImage.debug?.key ? { key: referenceImage.debug.key } : {}),
    ...(referenceImage.debug?.path ? { path: referenceImage.debug.path } : {}),
    mediaType: referenceImage.mediaType || '',
    kb: Math.round((String(referenceImage.data).length * 3) / 4 / 1024),
  };

  let plan;
  let plannerUsage;
  let plannerText = '';
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await completeText({
      model: llm.model,
      system,
      user: attempt === 1
        ? user
        : `${user}\n\n---\nPrevious attempt failed: ${lastErr?.message || 'invalid JSON'}. Return only the JSON object with style and 3 to 5 elements.`,
      image: referenceImage,
      maxTokens: Number(process.env.PLAN_DECORATIVE_MAX_TOKENS) || 2048,
      cacheKey: 'igsignal-plan-decorative',
      kind: 'decorative',
    });
    plannerText = response.text || '';
    plannerUsage = {
      inputTokens: Number(response.usage?.input_tokens) || 0,
      outputTokens: Number(response.usage?.output_tokens) || 0,
      cachedTokens: Number(response.usage?.cached_tokens) || 0,
      totalTokens: (Number(response.usage?.input_tokens) || 0) + (Number(response.usage?.output_tokens) || 0),
      estimatedCostUsd: estimatePlanCostUsd(
        llm.model,
        Number(response.usage?.input_tokens) || 0,
        Number(response.usage?.output_tokens) || 0,
        Number(response.usage?.cached_tokens) || 0,
      ),
      model: llm.model,
    };
    try {
      plan = validatePlan(extractJson(plannerText));
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`[decorativeAgent] ${source} attempt ${attempt}: ${err.message}`);
    }
  }
  if (!plan) throw new Error(`${source} failed: ${lastErr?.message || 'no plan'}`);

  const quality = String(process.env.PLAN_DECORATIVE_QUALITY || 'medium').trim() || 'medium';
  const rendered = await mapPool(plan.elements, 3, async (el) => {
    const finalPrompt = renderPromptOf(plan.style, el.prompt);
    try {
      const image = await generateImage(finalPrompt, {
        size: '1024x1024',
        quality,
        background: 'transparent',
      });
      const stored = await persistGeneratedImage({
        userId,
        handle,
        buffer: image.buffer,
        mimeType: image.mimeType,
        prompt: finalPrompt,
        model: image.model,
      });
      let src = '';
      try { src = await getMediaUrl(stored.key); } catch { /* key still resolves client-side when a CDN is on */ }
      return {
        ...el,
        alt: el.name,
        key: stored.key,
        src,
        model: image.model,
        elapsedMs: image.elapsedMs || 0,
        estimatedCostUsd: image.estimatedCostUsd || 0,
      };
    } catch (err) {
      console.warn(`[decorativeAgent] ${source} render ${el.id} skipped — ${err.message}`);
      return null;
    }
  });

  const elements = rendered.filter(Boolean);
  if (elements.length < 2) throw new Error('fewer than 2 decorative elements rendered');

  const imageModel = elements.find((e) => e.model)?.model || '';
  const imageCostUsd = elements.reduce((n, e) => n + (Number(e.estimatedCostUsd) || 0), 0);
  const imageElapsedMs = elements.reduce((n, e) => n + (Number(e.elapsedMs) || 0), 0);
  const usage = {
    ...plannerUsage,
    estimatedCostUsd: Math.round(((plannerUsage?.estimatedCostUsd || 0) + imageCostUsd) * 1e6) / 1e6,
  };
  console.log(
    `[decorativeAgent] ${source} · ${elements.length} motifs` +
      ` · ${Math.round((Date.now() - started) / 100) / 10}s`,
  );
  return {
    source,
    style: plan.style,
    elements: elements.map(({ id, name, usage: place, prompt, alt, key, src }) => ({
      id, name, usage: place, prompt, alt, key, src,
    })),
    debugEntry: {
      source,
      model: llm.model,
      provider: llm.provider,
      kind: 'decorative',
      prompt: [system, user].filter(Boolean).join('\n\n'),
      output: plannerText,
      elapsedMs: Date.now() - started,
      usage: plannerUsage,
      inputImage,
    },
    usage,
    imageModel,
    imageCostUsd,
    imageElapsedMs,
  };
}

/** What the carousel prompt lists — ids and placement, never the long URLs. */
function decorativePromptOf(set) {
  const elements = set?.elements || [];
  if (!elements.length) {
    return 'None supplied — do not add generated decorative graphics. Draw this theme’s framing devices in CSS, as THEME_REFERENCE describes.';
  }
  const lines = [
    'Already rendered as transparent PNGs. Place this set across the carousel so the slides share one graphic system.',
    set.style ? `Shared style: ${set.style}` : '',
    'The first motif is the signature: put it on the hook and repeat it on at least one later slide. Every motif appears at least once. Every slide that has margin for a mark uses at least one motif from this list.',
    'Markup for each placement (do not set src — the app fills the URL):',
    '<img data-slot="decor" data-decor-id="THE_ID" alt="">',
    'Copy data-decor-id exactly. object-fit: contain. No background colour on the img (a fill shows through the transparency as a box). Position each one in a margin, corner, or header — never full-bleed, never the slide’s main photograph, never covering the headline. Width about 16–32% of the slide.',
    '',
    ...elements.map((el, i) => (
      `- id: ${el.id}${i === 0 ? ' (signature — repeat)' : ''}\n  name: ${el.name}\n  shows: ${el.alt || el.name}\n  place: ${el.usage}`
    )),
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Fill src + data-asset-key on every <img data-decor-id="…"> the carousel wrote.
 * The model is not trusted with a long media URL.
 */
function injectDecorativeSrc(html, elements) {
  const byId = new Map((elements || []).filter((e) => e?.id && e?.src).map((e) => [e.id, e]));
  if (!byId.size) return String(html || '');
  return String(html || '').replace(/<img\b([^>]*?)\/?>/gi, (full, attrs) => {
    const m = String(attrs).match(/\bdata-decor-id\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const id = (m?.[2] || m?.[3] || m?.[4] || '').trim();
    const el = byId.get(id);
    if (!el) return full;
    const clean = String(attrs)
      .replace(/\s+src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
      .replace(/\s+data-asset-key\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
      .trim();
    const key = String(el.key || '').replace(/"/g, '&quot;');
    const src = String(el.src || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const keyAttr = key ? ` data-asset-key="${key}"` : '';
    return `<img ${clean}${keyAttr} src="${src}">`;
  });
}

function storedDecorativeElements(set) {
  return (set?.elements || []).map((e) => ({
    id: e.id,
    name: e.name || '',
    usage: e.usage || '',
    alt: e.alt || '',
    key: e.key || '',
    src: e.src || '',
  }));
}

/** Debug-panel entries: the planner, then the image renders. */
function decorativeDebugAgents(set) {
  if (!set?.debugEntry) return [];
  const planner = set.debugEntry;
  const renders = {
    source: `${set.source || 'Decorative'}:render`,
    model: set.imageModel || '',
    provider: 'openai',
    kind: 'decorative',
    prompt: (set.elements || []).map((e) => `## ${e.id}\n${e.prompt}`).join('\n\n'),
    output: (set.elements || []).map((e) => `${e.id}: ${e.key}`).join('\n'),
    elapsedMs: Number(set.imageElapsedMs) || 0,
  };
  return [
    { debugEntry: planner, usage: planner.usage || set.usage || null },
    {
      debugEntry: renders,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: Number(set.imageCostUsd) || 0,
      },
    },
  ];
}

module.exports = {
  decorativeAgentEnabled,
  generateDecorativeSet,
  decorativePromptOf,
  injectDecorativeSrc,
  storedDecorativeElements,
  decorativeDebugAgents,
};
