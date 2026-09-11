/**
 * Animated Carousel Cover Agent
 * ------------------------------------------------------------------
 * Input : strategist brief + content-structure output (+ brand)
 * Output: a validated "cover spec" (Remotion inputProps) and, optionally,
 *         a rendered MP4 hook video.
 *
 * Two independent steps so each can be tested in isolation:
 *   1. generateCoverSpec()  — LLM: brief + structure → cover spec JSON
 *   2. renderCoverVideo()   — Remotion: cover spec → MP4 (shells out to the
 *                             self-contained workspace in backend/remotion)
 *
 * This module is deliberately standalone: it does not touch planOrchestrator's
 * per-day loop yet. Wire it into the pipeline in a later pass.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { completeText, splitPromptTemplate, resolvePlanAgentLlm } = require('./llmComplete');
const { extractJson } = require('./weeklyPlan');

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');
const REMOTION_DIR = path.join(__dirname, '..', '..', 'remotion');
const PROMPT_FILE = 'plan-carousel-cover.md';

let promptCache = null;
function loadPrompt() {
  if (!promptCache) {
    promptCache = fs.readFileSync(path.join(PROMPTS_DIR, PROMPT_FILE), 'utf8');
  }
  return promptCache;
}

function json(v) {
  return JSON.stringify(v ?? null, null, 2);
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return out;
}

// Only the fields the cover agent needs from a full strategist brief.
function coverBriefPayload(brief = {}) {
  return {
    pillar: brief.pillar || brief.lens || '',
    format: brief.format || '',
    angle: brief.angle || '',
    hookTerritory: brief.hookTerritory || '',
    audienceTension: brief.audienceTension || '',
    centralFact: brief.centralFact || '',
    uniqueJob: brief.uniqueJob || '',
    ownedTerritory: brief.ownedTerritory || '',
    verifiedTruth: brief.verifiedTruth || [],
    observableDetails: brief.observableDetails || [],
  };
}

// The opening surface (first slide/scene) is what the cover animates.
function coverStructurePayload(structure = {}) {
  const slides = Array.isArray(structure.slidesOrScenes) ? structure.slidesOrScenes : [];
  const first = slides[0] || {};
  return {
    format: structure.format || '',
    role: first.role || '',
    purpose: first.purpose || '',
    informationShape: first.informationShape || '',
    primaryStructure: first.primaryStructure || '',
    contentGuidance: first.contentGuidance || '',
    truthBoundary: first.visual?.truthBoundary || first.visualNeed?.truthBoundary || '',
    totalSlides: Number(structure.totalSlidesOrScenes) || slides.length || 0,
  };
}

// The visual system the cover must honour: the studio's Library palette + fonts
// (authoritative — the app overrides these onto the spec after generation) plus
// brand voice/mood as guidance for composition and tone.
function coverBrandPayload(brand, visual, image) {
  const v = visual && typeof visual === 'object' ? visual : {};
  const p = v.palette || {};
  const f = v.fonts || {};
  return {
    voice: brand?.voice || '',
    offer: brand?.offer || '',
    visualStyle: brand?.visualStyle || '',
    mood: v.mood || '',
    // A real hook photo the app can place. The agent decides IF it adds value —
    // it never receives the URL. Set composition "photo" (or illustration.mode
    // "image") only when the photo strengthens the hook.
    availableImage: image && image.url ? {
      present: true,
      description: str(image.description, 240),
    } : null,
    // These are LOCKED — use exactly, do not invent other colours/fonts.
    libraryPalette: (p.bg || p.ink || p.accent) ? {
      bg: p.bg || '', ink: p.ink || '', accent: p.accent || '',
      muted: p.muted || '', hairline: p.hairline || '',
    } : null,
    libraryFonts: (f.headline || f.body) ? {
      headline: f.headline || '', body: f.body || '',
    } : null,
  };
}

function buildCoverPrompt({ brief, structure, brand, visual, image }) {
  const raw = loadPrompt();
  const { system, userTemplate } = splitPromptTemplate(raw);
  const user = fillTemplate(userTemplate || raw, {
    STRATEGIST_BRIEF_JSON: json(coverBriefPayload(brief)),
    STRUCTURE_JSON: json(coverStructurePayload(structure)),
    BRAND_JSON: json(coverBrandPayload(brand, visual, image)),
  });
  return { system, user };
}

// ── spec normalisation (mirrors backend/remotion/src/schema.ts defaults) ──────
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function hex(v, fallback) {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback;
}
function num(v, fallback, min, max) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = fallback;
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}
function str(v, max = 200) {
  return String(v ?? '').slice(0, max);
}

const STROKE_TOKENS = new Set(['ink', 'accent', 'muted', 'hairline']);
const FILL_TOKENS = new Set(['none', 'ink', 'accent', 'muted', 'bg', 'hairline']);
const EL_TYPES = new Set(['rect', 'line', 'polyline', 'dot', 'label', 'leader']);

function normalizeElement(el) {
  if (!el || !EL_TYPES.has(el.type)) return null;
  const base = {
    type: el.type,
    appearAt: num(el.appearAt, 0, 0, 600),
    drawFrames: num(el.drawFrames, 18, 0, 300),
    stroke: STROKE_TOKENS.has(el.stroke) ? el.stroke : 'ink',
    fill: FILL_TOKENS.has(el.fill) ? el.fill : 'none',
    strokeWidth: num(el.strokeWidth, 1.4, 0.2, 6),
  };
  const p = (v) => num(v, 0, -20, 120);
  switch (el.type) {
    case 'rect':
      return { ...base, x: p(el.x), y: p(el.y), w: p(el.w), h: p(el.h), radius: num(el.radius, 0, 0, 50) };
    case 'line':
      return { ...base, x1: p(el.x1), y1: p(el.y1), x2: p(el.x2), y2: p(el.y2) };
    case 'polyline': {
      const points = (Array.isArray(el.points) ? el.points : [])
        .filter((pt) => Array.isArray(pt) && pt.length === 2)
        .slice(0, 24)
        .map((pt) => [p(pt[0]), p(pt[1])]);
      if (points.length < 2) return null;
      return { ...base, points, closed: Boolean(el.closed) };
    }
    case 'dot':
      return { ...base, x: p(el.x), y: p(el.y), r: num(el.r, 1.2, 0.2, 20) };
    case 'label':
      return {
        ...base, x: p(el.x), y: p(el.y), text: str(el.text, 48),
        size: num(el.size, 1.6, 0.6, 6),
        align: ['start', 'middle', 'end'].includes(el.align) ? el.align : 'start',
        weight: el.weight === 'bold' ? 'bold' : 'normal',
      };
    case 'leader':
      return {
        ...base, x1: p(el.x1), y1: p(el.y1), x2: p(el.x2), y2: p(el.y2),
        text: str(el.text, 32), size: num(el.size, 1.2, 0.6, 4),
      };
    default:
      return null;
  }
}

function normalizeCoverSpec(input) {
  const s = input && input.spec ? input.spec : input;
  if (!s || typeof s !== 'object') throw new Error('missing spec');
  const lines = Array.isArray(s.headline?.lines) ? s.headline.lines : [];
  const cleanLines = lines
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .slice(0, 5)
    .map((l) => ({ text: str(l.text, 120), italic: Boolean(l.italic), accent: Boolean(l.accent) }));
  if (!cleanLines.length) throw new Error('headline.lines is empty');

  const fmt = s.format || {};
  const brand = s.brand || {};
  const illo = s.illustration || {};
  const tl = s.timeline || {};
  const st = s.stat || {};
  const COMPOSITIONS = ['editorial-stack', 'centered', 'statement-left', 'question', 'stat', 'quote', 'photo'];
  const HEAD_MOTION = ['rise', 'wipe', 'fade-scale', 'typewriter', 'stagger-words'];
  const BG_MOTION = ['none', 'drift', 'breathe', 'grain'];

  return {
    composition: COMPOSITIONS.includes(s.composition) ? s.composition : 'editorial-stack',
    format: {
      width: num(fmt.width, 1080, 240, 2160),
      height: num(fmt.height, 1350, 240, 2160),
      fps: num(fmt.fps, 30, 12, 60),
      durationInFrames: num(fmt.durationInFrames, 240, 24, 1800),
    },
    brand: {
      bg: hex(brand.bg, '#EDE6D9'),
      ink: hex(brand.ink, '#20201C'),
      accent: hex(brand.accent, '#B0472C'),
      muted: hex(brand.muted, '#8C8578'),
      hairline: hex(brand.hairline, '#CFC5B4'),
      headlineFont: str(brand.headlineFont, 60),
      bodyFont: str(brand.bodyFont, 60),
      serif: str(brand.serif, 60) || 'Playfair Display',
      sans: str(brand.sans, 60) || 'Inter',
    },
    header: { eyebrow: str(s.header?.eyebrow, 64), counter: str(s.header?.counter, 16) },
    headline: {
      reveal: ['line', 'word', 'mask'].includes(s.headline?.reveal) ? s.headline.reveal : 'line',
      lines: cleanLines,
    },
    subtext: { text: str(s.subtext?.text, 160) },
    stat: { value: str(st.value, 24), label: str(st.label, 80) },
    footer: {
      label: str(s.footer?.label, 80),
      cta: str(s.footer?.cta, 48) || 'Swipe',
      arrow: s.footer?.arrow !== false,
    },
    illustration: {
      mode: ['primitives', 'image', 'none'].includes(illo.mode) ? illo.mode : 'none',
      caption: str(illo.caption, 64),
      imageAssetKey: str(illo.imageAssetKey, 200),
      imageUrl: str(illo.imageUrl, 2000),
      elements: (Array.isArray(illo.elements) ? illo.elements : [])
        .map(normalizeElement).filter(Boolean).slice(0, 48),
    },
    timeline: {
      header: num(tl.header, 0, 0, 1800),
      headline: num(tl.headline, 8, 0, 1800),
      illustration: num(tl.illustration, 30, 0, 1800),
      subtext: num(tl.subtext, 70, 0, 1800),
      footer: num(tl.footer, 55, 0, 1800),
    },
    motion: {
      headline: HEAD_MOTION.includes(s.motion?.headline) ? s.motion.headline : 'rise',
      ease: ['outCubic', 'inOutCubic', 'outExpo', 'spring'].includes(s.motion?.ease) ? s.motion.ease : 'outCubic',
      stagger: num(s.motion?.stagger, 6, 0, 30),
      background: BG_MOTION.includes(s.motion?.background) ? s.motion.background : 'none',
    },
  };
}

// Inject the hook slide's real photo when the agent chose to use it (composition
// 'photo' or illustration.mode 'image'). The agent never sees the URL — it only
// decides whether a photo adds value; the app supplies the pixels (like Layout).
function applyHookImage(spec, image) {
  const wants = spec.composition === 'photo' || spec.illustration?.mode === 'image';
  if (image && image.url && wants) {
    spec.illustration = { ...spec.illustration, mode: 'image', imageUrl: image.url, imageAssetKey: '' };
    return spec;
  }
  // Agent asked for a photo but none is available → fall back to a type-led cover.
  if (!image?.url && wants) {
    if (spec.composition === 'photo') spec.composition = 'statement-left';
    spec.illustration = { ...spec.illustration, mode: 'none', imageUrl: '' };
  }
  return spec;
}

// Force the studio's Visual Library palette + fonts onto a spec, so the cover
// always renders in the brand's actual colours/type regardless of what the LLM
// guessed. `visual` is the resolved payload the frontend sends.
function applyVisualSettings(spec, visual) {
  if (!visual || typeof visual !== 'object') return spec;
  const p = visual.palette || {};
  const f = visual.fonts || {};
  spec.brand = {
    ...spec.brand,
    bg: hex(p.bg, spec.brand.bg),
    ink: hex(p.ink, spec.brand.ink),
    accent: hex(p.accent, spec.brand.accent),
    ...(p.muted ? { muted: hex(p.muted, spec.brand.muted) } : {}),
    ...(p.hairline ? { hairline: hex(p.hairline, spec.brand.hairline) } : {}),
    headlineFont: str(f.headline, 60) || spec.brand.headlineFont,
    bodyFont: str(f.body, 60) || spec.brand.bodyFont,
  };
  return spec;
}

// Best-effort repair for the small ways an LLM breaks strict JSON: code fences,
// trailing commas, // and /* */ comments, and smart quotes. Returns a parsed
// object or throws.
function parseCoverJson(text) {
  try {
    return extractJson(text);
  } catch (firstErr) {
    let body = String(text || '');
    const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) body = fenced[1];
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start !== -1 && end > start) body = body.slice(start, end + 1);
    const repaired = body
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
      .replace(/(^|[^:])\/\/[^\n\r]*/g, '$1') // line comments (keep http://)
      .replace(/[“”]/g, '"')        // smart double quotes
      .replace(/[‘’]/g, "'")        // smart single quotes
      .replace(/,\s*([}\]])/g, '$1');         // trailing commas
    try {
      return JSON.parse(repaired);
    } catch {
      throw firstErr;
    }
  }
}

/**
 * Step 1 — LLM: strategist brief + content structure → validated cover spec.
 * Retries on malformed JSON / validation failure (the model is nondeterministic,
 * so a re-call usually returns clean JSON). Returns { spec, raw, usage, model }.
 */
async function generateCoverSpec({ brief, structure, brand, visual, image, maxTokens, attempts = 3 } = {}) {
  const llm = resolvePlanAgentLlm('cover');
  const { system, user } = buildCoverPrompt({ brief, structure, brand, visual, image });
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await completeText({
      model: llm.model,
      system,
      user,
      maxTokens: Number(maxTokens) > 0 ? Number(maxTokens) : 4096,
      cacheKey: 'igsignal-plan-cover',
      kind: 'cover',
    });
    const text = response.text || '';
    try {
      const parsed = parseCoverJson(text);
      if (parsed?.status === 'failed') {
        throw new Error(`cover agent declined: ${parsed.failureReason || 'no reason given'}`);
      }
      const spec = applyHookImage(applyVisualSettings(normalizeCoverSpec(parsed), visual), image);
      return {
        spec,
        raw: parsed,
        model: llm.model,
        provider: llm.provider,
        usage: response.usage || {},
      };
    } catch (err) {
      lastErr = err;
      // A declined cover won't fix itself on retry — surface it immediately.
      if (/cover agent declined/.test(err.message)) throw err;
      console.warn(`[carouselCover] attempt ${attempt}/${maxAttempts} failed — ${err.message}`);
    }
  }
  throw new Error(`cover agent could not produce a valid spec: ${lastErr?.message || 'unknown error'}`);
}

/**
 * Step 2 — Remotion: cover spec → MP4. Shells out to backend/remotion/render.mjs
 * so backend never imports Remotion's React/Chromium deps.
 * Returns the absolute path to the written MP4.
 */
function renderCoverVideo({ spec, outPath, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    if (!spec) return reject(new Error('renderCoverVideo: spec required'));
    const out = outPath
      || path.join(os.tmpdir(), `cover-${Date.now()}.mp4`);
    const specPath = path.join(os.tmpdir(), `cover-spec-${Date.now()}.json`);
    fs.writeFileSync(specPath, JSON.stringify({ spec }));

    const child = spawn('node', ['render.mjs', specPath, out], {
      cwd: REMOTION_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    const timer = Number(timeoutMs) > 0
      ? setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`render timed out after ${timeoutMs}ms`)); }, Number(timeoutMs))
      : null;
    child.on('error', (err) => { if (timer) clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      try { fs.unlinkSync(specPath); } catch { /* ignore */ }
      if (code !== 0) {
        return reject(new Error(`render.mjs exited ${code}: ${stderr.slice(-500)}`));
      }
      const artifact = stdout.trim().split('\n').filter(Boolean).pop() || out;
      resolve(artifact);
    });
  });
}

/**
 * Convenience: brief + structure → spec → MP4 in one call.
 */
async function runCarouselCoverAgent({ brief, structure, brand, visual, image, outPath, render = true, timeoutMs } = {}) {
  const result = await generateCoverSpec({ brief, structure, brand, visual, image });
  if (!render) return { ...result, videoPath: null };
  const videoPath = await renderCoverVideo({ spec: result.spec, outPath, timeoutMs });
  return { ...result, videoPath };
}

module.exports = {
  generateCoverSpec,
  renderCoverVideo,
  runCarouselCoverAgent,
  normalizeCoverSpec,
  applyVisualSettings,
  applyHookImage,
  buildCoverPrompt,
  coverBriefPayload,
  coverStructurePayload,
};
