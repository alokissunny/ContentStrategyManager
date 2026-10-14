/**
 * Reel Editor — experimental multi-agent short-form video edit pipeline.
 * ------------------------------------------------------------------------
 * A creator uploads a raw clip (≤ 60s) plus a note. This turns it into a
 * "reel spec": live captions + on-screen animations that the frontend overlays
 * on the <video> during playback (a time-synced DOM layer — no server render).
 *
 * Four cooperating steps, each isolated and independently testable:
 *   1. transcribeWords()   — Whisper: clip audio → word- and segment-level timings
 *   2. runDirectorAgent()  — LLM: transcript + guidance → creative direction
 *   3. runCaptionAgent()   — LLM: styles the (fixed-timing) caption cues
 *   4. runAnimationAgent() — LLM: places on-screen animations against the timeline
 *
 * Every LLM step degrades gracefully: if the model call fails (or no API key is
 * configured), a deterministic heuristic builder fills in, so the pipeline
 * always returns a usable spec. Timings for captions come from Whisper words, so
 * captions stay in sync even when the styling agent is skipped.
 */

const fs = require('fs');
const path = require('path');
const { toFile } = require('openai');
const getOpenAIClient = require('./openaiClient');
const { completeText, completeToolCall, splitPromptTemplate } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { extractJson, estimatePlanCostUsd } = require('./weeklyPlan');

const PROMPTS_DIR = path.join(__dirname, '..', '..', 'prompts');
const PROMPT_FILES = {
  reelDirector: 'reel-director.md',
  reelCaptions: 'reel-captions.md',
  reelAnimations: 'reel-animations.md',
};

const promptCache = {};
function loadPrompt(kind) {
  if (!promptCache[kind]) {
    promptCache[kind] = fs.readFileSync(path.join(PROMPTS_DIR, PROMPT_FILES[kind]), 'utf8');
  }
  return promptCache[kind];
}

// ── small helpers ────────────────────────────────────────────────────────────
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
function num(v, fallback, min, max) {
  let n = Number(v);
  if (!Number.isFinite(n)) n = fallback;
  if (min != null) n = Math.max(min, n);
  if (max != null) n = Math.min(max, n);
  return n;
}
function str(v, max = 200) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Assembly times are already measured on the final stitched video, including
// transition overlaps. Source times are reference metadata, never overlay times.
function assemblyContext(assembly, durationSec) {
  const clips = (Array.isArray(assembly?.clips) ? assembly.clips : [])
    .filter((clip) => clip && ['image', 'photo', 'video'].includes(clip.kind)
      && Number.isFinite(clip.start) && Number.isFinite(clip.end)
      && clip.start >= 0 && clip.end > clip.start && clip.start < durationSec)
    .map((clip) => ({
      index: clip.index,
      kind: clip.kind === 'photo' ? 'image' : clip.kind,
      start: round2(clip.start),
      end: round2(Math.min(clip.end, durationSec)),
      sourceStart: clip.sourceStart,
      sourceEnd: clip.sourceEnd,
    }));
  const overlays = (Array.isArray(assembly?.mixPlan?.overlays) ? assembly.mixPlan.overlays : [])
    .filter((item) => item && ['pip', 'cutaway'].includes(item.mode) && Number.isFinite(item.atSec) && Number.isFinite(item.durationSec))
    .slice(0, 12)
    .map((item) => ({ assetIndex: item.assetIndex, mode: item.mode, position: item.position,
      start: round2(Math.max(0, item.atSec)), end: round2(Math.min(durationSec, item.atSec + item.durationSec)), reason: str(item.reason, 200) }));
  return clips.length ? { transition: str(assembly.transition, 40), clips, ...(overlays.length ? { overlays } : {}) } : null;
}

function assemblyInstructions(assembly) {
  if (!assembly) return '';
  return `\n\nAssembled source timeline (JSON):\n${json(assembly)}\n`
    + 'This is ONE finished reel in the supplied source order. All start/end times are on the assembled timeline; sourceStart/sourceEnd refer to original media only. '
    + 'Picture-in-picture and cutaway overlays, when listed, are already burned into the reel. The base narration continues under them; do not invent separate overlay speech. Avoid placing graphics over the inset or pointing at a base subject hidden by a full-frame cutaway. '
    + 'Transitions are already rendered. Never reorder sources, request extra footage, or claim additional cuts or transitions were executed. '
    + 'Build a coherent opening, scene-aligned beats, and ending using only the transcript, observed frames, and creator guidance. '
    + 'Photo segments have no speech of their own. Do not invent narration or describe unseen content. '
    + 'Keep scene-specific callouts and pointers within their source interval and away from transition overlaps; broad hook and progress overlays may span scenes.';
}

// Words a complete on-screen phrase should never END on — a hook/headline that
// stops here is a truncated sentence fragment ("…which I'd", "…to", "…all"), not
// a finished statement, so we reject it rather than show something that reads cut.
const DANGLING_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'to', 'of', 'for', 'with', 'which', 'that', 'than',
  'i', 'id', 'im', 'is', 'are', 'was', 'were', 'be', 'been', 'in', 'on', 'at', 'by', 'my',
  'your', 'our', 'their', 'his', 'her', 'its', 'so', 'if', 'as', 'it', 'this', 'these', 'those',
  'we', 'you', 'they', 'he', 'she', 'from', 'into', 'about', 'all', 'some', 'any', 'who', 'what',
  'when', 'where', 'how', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'do', 'does',
]);
function endsIncomplete(text) {
  const words = String(text || '').trim().toLowerCase().replace(/[^a-z0-9'\s]/g, '').split(/\s+/).filter(Boolean);
  const last = words[words.length - 1];
  return !last || DANGLING_WORDS.has(last.replace(/'/g, ''));
}
// Trim to a length on a WORD boundary (never mid-word). Used for tiny eyebrows.
function clampWords(text, maxChars) {
  let t = str(text, maxChars + 24);
  if (t.length > maxChars) t = t.slice(0, maxChars).replace(/\s+\S*$/, '');
  return t.trim();
}
// A finished, on-screen-ready short phrase — or '' when it's a fragment or a
// run-on. We do NOT truncate: an over-long line is an echoed sentence, not a
// crafted title/headline, so it's dropped rather than shown cut off.
function completePhrase(text, maxChars) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length > maxChars) return '';
  if (raw.split(/\s+/).filter(Boolean).length < 2) return '';
  return endsIncomplete(raw) ? '' : raw;
}

// Best-effort JSON recovery for the small ways an LLM breaks strict JSON.
function parseJson(text) {
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
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n\r]*/g, '$1')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(repaired);
    } catch {
      throw firstErr;
    }
  }
}

// Normalise a provider usage object ({input_tokens,output_tokens,cached_tokens})
// into the camelCase shape the debug panel reads, with an estimated USD cost.
function normalizeUsage(model, usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = Number(u.input_tokens ?? u.inputTokens) || 0;
  const outputTokens = Number(u.output_tokens ?? u.outputTokens) || 0;
  const cachedTokens = Number(u.cached_tokens ?? u.cachedTokens) || 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens, cachedTokens),
  };
}

function debugEntry({ source, model, system, user, output, startedAt, note, usage }) {
  return {
    source,
    model: model || '',
    systemPrompt: system || '',
    finalPrompt: user || '',
    output: typeof output === 'string' ? output : json(output),
    elapsedMs: Date.now() - startedAt,
    note: note || '',
    usage: normalizeUsage(model, usage),
  };
}

// ── Step 1: Whisper word/segment timestamps ────────────────────────────────────
function transcribeFilename(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('webm')) return 'clip.webm';
  if (ct.includes('quicktime') || ct.includes('mov')) return 'clip.mov';
  return 'clip.mp4';
}

/**
 * Whisper `verbose_json` with word + segment granularity. Whisper accepts mp4 /
 * mov / webm directly, so no ffmpeg audio-extraction step is needed.
 * Returns { words:[{text,start,end}], segments:[{text,start,end}], text, note }.
 */
async function transcribeWords(buffer, contentType) {
  if (!process.env.OPENAI_API_KEY) {
    return { words: [], segments: [], text: '', note: 'No OPENAI_API_KEY — captions timed heuristically.' };
  }
  if (!buffer || !buffer.length) {
    return { words: [], segments: [], text: '', note: 'Empty clip — nothing to transcribe.' };
  }
  const client = getOpenAIClient();
  const model = process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1';
  try {
    const file = await toFile(buffer, transcribeFilename(contentType), { type: contentType || 'video/mp4' });
    const res = await client.audio.transcriptions.create({
      file,
      model,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    });
    const words = (Array.isArray(res.words) ? res.words : [])
      .map((w) => ({ text: str(w.word, 40), start: round2(w.start), end: round2(w.end) }))
      .filter((w) => w.text && w.end >= w.start);
    const segments = (Array.isArray(res.segments) ? res.segments : [])
      .map((s) => ({ text: str(s.text, 240), start: round2(s.start), end: round2(s.end) }))
      .filter((s) => s.text);
    return { words, segments, text: str(res.text, 6000), note: '' };
  } catch (err) {
    console.warn('[reelEditor] transcription failed —', err.message);
    return { words: [], segments: [], text: '', note: `Transcription failed: ${err.message}` };
  }
}

// ── Step 1b: Scene vision agent — SEES the video so pointers can be anchored ────
// Frames are sampled on the client (canvas) and sent as base64 JPEG. For each
// frame the model returns a short scene description + the concrete subjects a
// viewer's eye should be drawn to, with their centre as x/y percentages. The
// animation agent then anchors pointers/spotlights/labels to those positions.
function reelVisionModel() {
  return process.env.PLAN_REEL_VISION_MODEL
    || process.env.ANTHROPIC_VISION_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-5';
}

const REEL_VISION_TOOL = {
  name: 'record_reel_frames',
  description: 'Describe what is visible in each sampled video frame and where the key subjects are.',
  input_schema: {
    type: 'object',
    properties: {
      brand: {
        type: 'object',
        description: 'Brand/creator identity you can LITERALLY read on screen — never guessed.',
        properties: {
          name: { type: 'string', description: 'A logo, watermark, @handle or brand name visible in the frames, verbatim. Empty string if none is clearly visible.' },
          tag: { type: 'string', description: 'A short label/tagline shown on screen near the brand (e.g. a category tag). Empty string if none.' },
        },
      },
      frames: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            t: { type: 'number', description: 'timestamp in seconds of this frame (copy from its label)' },
            scene: { type: 'string', description: 'one short phrase: what is happening / shown' },
            subjects: {
              type: 'array',
              description: 'up to 3 concrete on-screen things worth pointing at, most important first',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: '1-3 words naming a concrete visible thing (object, hand, product, face, on-screen text)' },
                  x: { type: 'number', description: 'horizontal centre 0-100 (left→right)' },
                  y: { type: 'number', description: 'vertical centre 0-100 (top→bottom)' },
                },
                required: ['label', 'x', 'y'],
              },
            },
          },
          required: ['t', 'scene', 'subjects'],
        },
      },
    },
    required: ['frames'],
  },
};

const VISION_SYSTEM = [
  'You are a scene analyst for short-form vertical video. You are given frames sampled in order from ONE finished reel (possibly assembled from videos and photos), each labelled with its timestamp.',
  'For each frame: describe the scene in a short phrase, and list up to 3 concrete subjects a viewer should look at (objects, hands, products, faces, on-screen text) with their CENTRE as x/y percentages of the frame (x left→right, y top→bottom).',
  'Also report `brand`: any logo, watermark, @handle or brand name you can LITERALLY read on screen, plus a short on-screen tag/label if one is shown. If nothing brand-like is visible, return empty strings — NEVER guess or invent a brand.',
  'Only list things clearly visible. The x/y must match where the thing actually is in that frame. Do not invent subjects. Call record_reel_frames with one entry per frame.',
].join(' ');

async function analyzeReelFrames({ frames, guidance }, debug) {
  const list = (Array.isArray(frames) ? frames : []).filter((f) => f && typeof f.data === 'string' && f.data.length);
  if (!list.length) return { context: [], brand: { name: '', tag: '' }, note: '' };
  const startedAt = Date.now();
  const model = reelVisionModel();
  const parts = [{
    type: 'text',
    text: `${guidance ? `The creator's note: ${str(guidance, 400)}. ` : ''}${list.length} frames follow, in playback order.`,
  }];
  list.slice(0, 10).forEach((f) => {
    parts.push({ type: 'text', text: `Frame at ${round2(f.t)}s:` });
    parts.push({ type: 'image', mediaType: f.mediaType || 'image/jpeg', data: f.data });
  });
  try {
    const done = await completeToolCall({
      model,
      system: VISION_SYSTEM,
      userParts: parts,
      tool: REEL_VISION_TOOL,
      maxTokens: 1800,
      kind: 'reelVision',
      retryHint: 'Call record_reel_frames with valid JSON — one entry per frame, x/y between 0 and 100.',
    });
    const parsed = done.parsed && typeof done.parsed === 'object'
      ? done.parsed
      : parseJson(done.output || done.text || '');
    const context = (Array.isArray(parsed?.frames) ? parsed.frames : [])
      .map((fr) => ({
        t: num(fr.t, 0, 0, 600),
        scene: str(fr.scene, 120),
        subjects: (Array.isArray(fr.subjects) ? fr.subjects : [])
          .map((s) => ({ label: str(s.label, 40), x: num(s.x, 50, 0, 100), y: num(s.y, 50, 0, 100) }))
          .filter((s) => s.label)
          .slice(0, 3),
      }))
      .filter((fr) => fr.scene || fr.subjects.length)
      .sort((a, b) => a.t - b.t);
    const brand = {
      name: str(parsed?.brand?.name, 40),
      tag: str(parsed?.brand?.tag, 40).toUpperCase(),
    };
    debug.push(debugEntry({ source: 'Reel vision', model, system: VISION_SYSTEM, user: `[${list.length} frames] ${str(guidance, 200)}`, output: parsed, startedAt, usage: done.usage }));
    return { context, brand, note: '' };
  } catch (err) {
    console.warn('[reelEditor] vision agent failed —', err.message);
    debug.push(debugEntry({ source: 'Reel vision', model, system: VISION_SYSTEM, user: `[${list.length} frames]`, output: '', startedAt, note: `Skipped pointers: ${err.message}` }));
    return { context: [], brand: { name: '', tag: '' }, note: 'Could not analyse the video frames — context-anchored pointers were skipped.' };
  }
}

// ── Caption cues: cut from word timings (timing is authoritative, not the LLM) ──
function chunkWordsToCues(words, { maxWords = 4, maxDur = 1.8, maxChars = 28 } = {}) {
  const cues = [];
  let cur = null;
  const flush = () => { if (cur) { cues.push({ start: round2(cur.start), end: round2(cur.end), text: cur.words.join(' ') }); cur = null; } };
  for (const w of words) {
    if (!cur) { cur = { start: w.start, end: w.end, words: [w.text] }; continue; }
    const dur = w.end - cur.start;
    const chars = cur.words.join(' ').length + 1 + w.text.length;
    const endsSentence = /[.!?…]$/.test(cur.words[cur.words.length - 1]);
    if (cur.words.length >= maxWords || dur >= maxDur || chars > maxChars || endsSentence) {
      flush();
      cur = { start: w.start, end: w.end, words: [w.text] };
    } else {
      cur.words.push(w.text);
      cur.end = w.end;
    }
  }
  flush();
  return cues.slice(0, 260); // enough for a full 3-minute clip
}

// Fallback captions from the creator's guidance when there's no speech to time.
function guidanceCues(guidance, durationSec) {
  const text = str(guidance, 400);
  if (!text) return [];
  const phrases = text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, Math.max(1, Math.min(6, Math.floor(durationSec / 0.4))));
  if (!phrases.length) return [];
  const span = durationSec / phrases.length;
  return phrases.map((p, i) => ({
    start: round2(i * span),
    end: round2(Math.min(durationSec, (i + 1) * span - 0.1)),
    text: str(p, 48),
  }));
}

// ── Step 2: Director agent ──────────────────────────────────────────────────
const EMOTIONS = ['curiosity', 'surprise', 'aspiration', 'relatability', 'urgency', 'humor'];
// 'boxed' is the editorial look: UPPERCASE on a dark pill with a single accent
// word. It's a rendering style — no invented text/brand.
const CAPTION_STYLES = ['boxed', 'karaoke', 'pop', 'word', 'block'];
const CAPTION_POS = ['bottom', 'center', 'top'];

// Without a real director we CANNOT craft short, complete, non-redundant title
// or section text — echoing raw transcript just duplicates the live captions and
// reads truncated. So the fallback is captions-only: no title, no section cards.
function heuristicDirection(durationSec) {
  return {
    hookRewrite: '',
    hookEyebrow: '',
    hookRationale: '',
    targetEmotion: 'curiosity',
    pacing: durationSec <= 30 ? 'fast' : 'medium',
    captionStyle: 'boxed',
    retentionTactics: [],
    momentHighlights: [],
    sections: [],
    endCta: '',
    _heuristic: true,
  };
}

function normalizeDirection(raw, { durationSec }) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const highlights = (Array.isArray(d.momentHighlights) ? d.momentHighlights : [])
    .map((h) => ({ atSec: num(h.atSec, 0, 0, durationSec), note: str(h.note, 160) }))
    .filter((h) => h.note)
    .sort((a, b) => a.atSec - b.atSec)
    .slice(0, 5);
  // Section headlines/CTAs/hooks must be COMPLETE statements — drop fragments so
  // nothing renders cut off ("…which I'd") or as a dupe of the live caption.
  const sections = (Array.isArray(d.sections) ? d.sections : [])
    .map((s) => ({
      atSec: num(s.atSec, 0, 0, durationSec),
      eyebrow: clampWords(str(s.eyebrow, 40).toUpperCase(), 28),
      headline: completePhrase(s.headline, 58),
      chips: (Array.isArray(s.chips) ? s.chips : []).map((c) => str(c, 24)).filter(Boolean).slice(0, 6),
    }))
    .filter((s) => s.headline || s.chips.length)
    .sort((a, b) => a.atSec - b.atSec)
    .slice(0, 6);
  const fallback = heuristicDirection(durationSec);
  return {
    hookRewrite: completePhrase(d.hookRewrite, 48),
    hookEyebrow: clampWords(str(d.hookEyebrow, 40).toUpperCase(), 28),
    hookRationale: str(d.hookRationale, 200),
    targetEmotion: EMOTIONS.includes(d.targetEmotion) ? d.targetEmotion : fallback.targetEmotion,
    pacing: d.pacing === 'medium' ? 'medium' : 'fast',
    captionStyle: CAPTION_STYLES.includes(d.captionStyle) ? d.captionStyle : fallback.captionStyle,
    retentionTactics: (Array.isArray(d.retentionTactics) ? d.retentionTactics : [])
      .map((t) => str(t, 80)).filter(Boolean).slice(0, 4),
    momentHighlights: highlights,
    sections,
    endCta: completePhrase(d.endCta, 34),
  };
}

async function runDirectorAgent({ guidance, transcript, brand, durationSec, assembly }, debug) {
  const startedAt = Date.now();
  const llm = resolvePlanAgentLlm('reelDirector');
  const { system, userTemplate } = splitPromptTemplate(loadPrompt('reelDirector'));
  const user = fillTemplate(userTemplate, {
    GUIDANCE: str(guidance, 1200),
    TRANSCRIPT: str(transcript.text, 4000),
    SEGMENTS_JSON: json((transcript.segments || []).slice(0, 40)),
    BRAND_JSON: json(brand || {}),
    DURATION_SEC: round2(durationSec),
  }) + assemblyInstructions(assembly);
  try {
    const res = await completeText({
      model: llm.model, system, user, maxTokens: 1200,
      cacheKey: 'igsignal-reel-director', kind: 'reelDirector',
    });
    const direction = normalizeDirection(parseJson(res.text), { durationSec });
    debug.push(debugEntry({ source: 'Reel director', model: llm.model, system, user, output: res.text, startedAt, usage: res.usage }));
    return direction;
  } catch (err) {
    console.warn('[reelEditor] director agent failed —', err.message);
    debug.push(debugEntry({ source: 'Reel director', model: llm.model, system, user, output: '', startedAt, note: `Fell back to heuristic (captions only): ${err.message}` }));
    return heuristicDirection(durationSec);
  }
}

// ── Step 3: Caption stylist agent (styles fixed-timing cues) ──────────────────
function applyCaptionStyling(cues, styling, direction) {
  const s = styling && typeof styling === 'object' ? styling : {};
  const byIndex = new Map();
  (Array.isArray(s.cues) ? s.cues : []).forEach((c) => {
    const i = Number(c.i);
    if (Number.isInteger(i)) byIndex.set(i, c);
  });
  const style = CAPTION_STYLES.includes(s.style) ? s.style : direction.captionStyle;
  const position = CAPTION_POS.includes(s.position) ? s.position : 'bottom';
  const styled = cues.map((cue, i) => {
    const meta = byIndex.get(i) || {};
    const lower = cue.text.toLowerCase();
    const emphasis = (Array.isArray(meta.emphasis) ? meta.emphasis : [])
      .map((w) => str(w, 32))
      .filter((w) => w && lower.includes(w.toLowerCase()))
      .slice(0, 2);
    return { ...cue, emphasis, punch: Boolean(meta.punch) };
  });
  return { style, position, cues: styled };
}

async function runCaptionAgent({ cues, direction, guidance }, debug) {
  if (!cues.length) {
    return { style: direction.captionStyle, position: 'bottom', cues: [] };
  }
  const startedAt = Date.now();
  const llm = resolvePlanAgentLlm('reelCaptions');
  const { system, userTemplate } = splitPromptTemplate(loadPrompt('reelCaptions'));
  const user = fillTemplate(userTemplate, {
    DIRECTION_JSON: json({
      captionStyle: direction.captionStyle,
      captionAccent: direction.captionAccent,
      targetEmotion: direction.targetEmotion,
      pacing: direction.pacing,
    }),
    CUES_JSON: json(cues.map((c, i) => ({ i, text: c.text }))),
    GUIDANCE: str(guidance, 600),
  });
  try {
    const res = await completeText({
      // Scale with cue count (long clips have many cues); each styled entry is small.
      model: llm.model, system, user, maxTokens: Math.min(8000, 1500 + cues.length * 18),
      cacheKey: 'igsignal-reel-captions', kind: 'reelCaptions',
    });
    const styled = applyCaptionStyling(cues, parseJson(res.text), direction);
    debug.push(debugEntry({ source: 'Reel captions', model: llm.model, system, user, output: res.text, startedAt, usage: res.usage }));
    return styled;
  } catch (err) {
    console.warn('[reelEditor] caption agent failed —', err.message);
    debug.push(debugEntry({ source: 'Reel captions', model: llm.model, system, user, output: '', startedAt, note: `Fell back to plain captions: ${err.message}` }));
    return applyCaptionStyling(cues, null, direction);
  }
}

// ── Step 4: Animation agent ───────────────────────────────────────────────────
// title/callout/emoji/progress/zoom/lower-third/cta are the base beats; pointer/
// spotlight/label are context-anchored — their position is a real on-screen point
// from the vision agent.
const ANIM_TYPES = ['title', 'callout', 'emoji', 'progress', 'zoom', 'lower-third', 'cta', 'pointer', 'spotlight', 'label'];
const POINTER_TYPES = new Set(['pointer', 'spotlight', 'label']);
const MOTIONS = ['pop', 'slide-up', 'fade', 'bounce', 'shake'];

function normalizeAnimation(a, durationSec) {
  if (!a || !ANIM_TYPES.includes(a.type)) return null;
  // Automatic edits should emphasize the story, not annotate people's faces.
  if (POINTER_TYPES.has(a.type)) return null;
  const start = num(a.start, 0, 0, durationSec);
  let end = num(a.end, start + 1.5, 0, durationSec);
  if (end <= start) end = Math.min(durationSec, start + 1.2);
  const pos = a.position && typeof a.position === 'object' ? a.position : {};
  const carriesText = ['title', 'callout', 'cta', 'lower-third', 'label'].includes(a.type);
  const text = carriesText ? str(a.text, 60) : '';
  // A text card with no text is a blank pill — drop it rather than render nothing.
  if (carriesText && !text) return null;
  return {
    type: a.type,
    start: round2(start),
    end: round2(end),
    text,
    emoji: a.type === 'emoji' ? str(a.emoji, 8) : '',
    position: { x: num(pos.x, 50, 0, 100), y: num(pos.y, a.type === 'title' ? 22 : 50, 0, 100) },
    motion: MOTIONS.includes(a.motion) ? a.motion : 'pop',
    emphasis: Boolean(a.emphasis),
  };
}

function heuristicAnimations(direction, durationSec) {
  const out = [
    { type: 'progress', start: 0, end: durationSec, position: { x: 50, y: 2 }, motion: 'fade' },
    { type: 'title', start: 0, end: Math.min(2.6, durationSec), text: direction.hookRewrite, position: { x: 50, y: 20 }, motion: 'pop', emphasis: true },
  ];
  (direction.momentHighlights || []).forEach((h, i) => {
    out.push({
      type: i % 2 === 0 ? 'callout' : 'emoji',
      start: h.atSec, end: Math.min(durationSec, h.atSec + 1.8),
      text: str(h.note, 32), emoji: '🔥',
      position: { x: i % 2 === 0 ? 28 : 74, y: 40 }, motion: 'slide-up',
    });
  });
  out.push({ type: 'cta', start: Math.max(0, durationSec - 3), end: durationSec, text: direction.endCta, position: { x: 50, y: 78 }, motion: 'bounce', emphasis: true });
  return out.map((a) => normalizeAnimation(a, durationSec)).filter(Boolean);
}

async function runAnimationAgent({ direction, transcript, visual, guidance, durationSec, assembly }, debug) {
  const startedAt = Date.now();
  const llm = resolvePlanAgentLlm('reelAnimations');
  const { system, userTemplate } = splitPromptTemplate(loadPrompt('reelAnimations'));
  const user = fillTemplate(userTemplate, {
    DIRECTION_JSON: json(direction),
    SEGMENTS_JSON: json((transcript.segments || []).slice(0, 40)),
    VISUAL_CONTEXT_JSON: json((visual || []).slice(0, 10)),
    GUIDANCE: str(guidance, 600),
    DURATION_SEC: round2(durationSec),
  }) + assemblyInstructions(assembly);
  try {
    const res = await completeText({
      model: llm.model, system, user, maxTokens: 2000,
      cacheKey: 'igsignal-reel-animations', kind: 'reelAnimations',
    });
    const parsed = parseJson(res.text);
    let animations = (Array.isArray(parsed?.animations) ? parsed.animations : [])
      .map((a) => normalizeAnimation(a, durationSec)).filter(Boolean).slice(0, 14);
    // Guarantee the structural beats — but ONLY when we actually have their text
    // (derived from the clip). No text → no card (never a blank pill).
    if (direction.hookRewrite && !animations.some((a) => a.type === 'title')) {
      const t = normalizeAnimation({ type: 'title', start: 0, end: Math.min(2.6, durationSec), text: direction.hookRewrite, position: { x: 50, y: 20 }, motion: 'pop', emphasis: true }, durationSec);
      if (t) animations.unshift(t);
    }
    if (direction.endCta && !animations.some((a) => a.type === 'cta')) {
      const c = normalizeAnimation({ type: 'cta', start: Math.max(0, durationSec - 3), end: durationSec, text: direction.endCta, position: { x: 50, y: 78 }, motion: 'bounce', emphasis: true }, durationSec);
      if (c) animations.push(c);
    }
    animations = animations.sort((a, b) => a.start - b.start);
    debug.push(debugEntry({ source: 'Reel animations', model: llm.model, system, user, output: res.text, startedAt, usage: res.usage }));
    return animations;
  } catch (err) {
    console.warn('[reelEditor] animation agent failed —', err.message);
    debug.push(debugEntry({ source: 'Reel animations', model: llm.model, system, user, output: '', startedAt, note: `Fell back to heuristic: ${err.message}` }));
    return heuristicAnimations(direction, durationSec);
  }
}

/**
 * Orchestrate the full edit. Returns { spec, transcript, direction, debug, notes }.
 * `spec` is what the frontend overlays on the <video>:
 *   { meta, strategy, captions:{style,position,cues[]}, animations[] }
 */
async function runReelEditor({ buffer, contentType, guidance = '', brand = null, durationSec = 0, frames = [], accentColor = '', assembly = null } = {}) {
  const debug = [];
  const notes = [];
  const editStart = Date.now();
  const dur = num(durationSec, 30, 0.5, 190);
  const assembled = assemblyContext(assembly, dur);
  const photosOnly = Boolean(assembled && assembled.clips.every((clip) => clip.kind === 'image'));
  // Accent is SAMPLED from the video (client-side dominant colour) — never a
  // hardcoded brand colour. Empty when the clip has no strong colour.
  const accent = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(accentColor || '').trim())
    ? String(accentColor).trim() : '';

  // Transcription (needs the audio) and vision (needs the sampled frames) are
  // independent — run them together up front.
  const [transcript, vision] = await Promise.all([
    photosOnly
      ? Promise.resolve({ words: [], segments: [], text: '', note: 'Photo montage: there is no source speech. On-screen text uses your creator guidance; it is not a spoken transcript.' })
      : transcribeWords(buffer, contentType),
    analyzeReelFrames({ frames, guidance }, debug),
  ]);
  if (transcript.note) notes.push(transcript.note);
  if (vision.note) notes.push(vision.note);

  const direction = await runDirectorAgent({ guidance, transcript, brand, durationSec: dur, assembly: assembled }, debug);
  if (direction._heuristic) {
    notes.push('The director step was unavailable, so the opening title and section cards were skipped — live captions and animations still applied. See the debug panel for details.');
  }

  // Caption timing is authoritative from Whisper; guidance is the fallback source.
  const rawCues = transcript.words.length
    ? chunkWordsToCues(transcript.words)
    : guidanceCues(guidance, dur);
  if (!photosOnly && !transcript.words.length && rawCues.length) {
    notes.push('No speech detected — captions were built from your guidance and spread across the clip.');
  }

  const [captions, animations] = await Promise.all([
    runCaptionAgent({ cues: rawCues, direction, guidance }, debug),
    runAnimationAgent({ direction, transcript, visual: vision.context, guidance, durationSec: dur, assembly: assembled }, debug),
  ]);

  // Bottom "section card" timeline — each section shows from its atSec until the
  // next one (last runs to the end). The first starts after the opening title so
  // the two never stack on top of each other.
  const sectionsIn = direction.sections || [];
  const introEnd = direction.hookRewrite ? 3 : 0;
  const sections = sectionsIn.map((s, i) => ({
    start: round2(i === 0 ? Math.max(s.atSec, introEnd) : s.atSec),
    end: round2(i + 1 < sectionsIn.length ? sectionsIn[i + 1].atSec : dur),
    eyebrow: s.eyebrow,
    headline: s.headline,
    chips: s.chips || [],
  })).filter((s) => s.end > s.start + 0.4);

  // Brand bar ONLY when a brand was actually read off the video frames — never
  // invented. No on-screen brand → no brand bar.
  const detected = vision.brand || { name: '', tag: '' };
  const spec = {
    meta: { durationSec: round2(dur), width: 1080, height: 1920 },
    template: 'founder-pov',
    ...(detected.name ? { brand: { name: detected.name, tag: detected.tag || '', accent } } : {}),
    strategy: {
      hook: direction.hookRewrite,
      hookEyebrow: direction.hookEyebrow,
      hookRationale: direction.hookRationale,
      targetEmotion: direction.targetEmotion,
      pacing: direction.pacing,
      retentionTactics: direction.retentionTactics,
      endCta: direction.endCta,
      accent,
    },
    captions,
    sections,
    animations,
  };

  // Sum every agent's tokens/cost → the estimated cost of THIS edit.
  const cost = debug.reduce((acc, d) => {
    acc.inputTokens += d.usage?.inputTokens || 0;
    acc.outputTokens += d.usage?.outputTokens || 0;
    acc.totalTokens += d.usage?.totalTokens || 0;
    acc.estimatedCostUsd += d.usage?.estimatedCostUsd || 0;
    return acc;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 });
  cost.estimatedCostUsd = Math.round(cost.estimatedCostUsd * 1e6) / 1e6;

  // Summary line for the debug panel — carries the WHOLE edit's tokens + cost so
  // the panel's cost pill (which reads the latest run) shows the edit's total.
  const agentCount = debug.length;
  const costText = cost.estimatedCostUsd > 0 ? `~$${cost.estimatedCostUsd.toFixed(4)}` : '$0';
  debug.push({
    source: 'Reel edit — estimated cost',
    model: '',
    systemPrompt: '',
    finalPrompt: '',
    output: '',
    elapsedMs: Date.now() - editStart,
    note: `Estimated cost ${costText} · ${cost.totalTokens} tokens across ${agentCount} agent${agentCount === 1 ? '' : 's'} (${cost.inputTokens} in / ${cost.outputTokens} out).`,
    usage: cost,
  });

  return {
    spec,
    transcript: { text: transcript.text, wordCount: transcript.words.length },
    direction,
    visualContext: vision.context,
    cost,
    debug: { source: 'Reel editor', agents: debug },
    notes,
  };
}

module.exports = {
  runReelEditor,
  assemblyContext,
  assemblyInstructions,
  transcribeWords,
  analyzeReelFrames,
  runDirectorAgent,
  runCaptionAgent,
  runAnimationAgent,
  chunkWordsToCues,
  normalizeDirection,
  normalizeAnimation,
};
