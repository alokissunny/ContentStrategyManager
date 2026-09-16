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
const { completeText, splitPromptTemplate } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { extractJson } = require('./weeklyPlan');

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

function debugEntry({ source, model, system, user, output, startedAt, note, usage }) {
  return {
    source,
    model: model || '',
    systemPrompt: system || '',
    finalPrompt: user || '',
    output: typeof output === 'string' ? output : json(output),
    elapsedMs: Date.now() - startedAt,
    note: note || '',
    usage: usage || {},
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
  return cues.slice(0, 120);
}

// Fallback captions from the creator's guidance when there's no speech to time.
function guidanceCues(guidance, durationSec) {
  const text = str(guidance, 400);
  if (!text) return [];
  const phrases = text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (!phrases.length) return [];
  const span = Math.max(1, durationSec) / phrases.length;
  return phrases.map((p, i) => ({
    start: round2(i * span),
    end: round2(Math.min(durationSec, (i + 1) * span - 0.1)),
    text: str(p, 48),
  }));
}

// ── Step 2: Director agent ──────────────────────────────────────────────────
const EMOTIONS = ['curiosity', 'surprise', 'aspiration', 'relatability', 'urgency', 'humor'];
const CAPTION_STYLES = ['karaoke', 'pop', 'word', 'block'];
const CAPTION_POS = ['bottom', 'center', 'top'];

function heuristicDirection(guidance, transcriptText, durationSec) {
  const source = str(transcriptText || guidance, 300);
  const firstWords = source.split(' ').slice(0, 7).join(' ');
  return {
    hookRewrite: firstWords || 'Watch till the end',
    hookRationale: 'Opens on the core promise so the scroll stops.',
    targetEmotion: 'curiosity',
    pacing: durationSec <= 30 ? 'fast' : 'medium',
    captionStyle: 'karaoke',
    captionAccent: 'punchy lime',
    retentionTactics: ['Hook in the first 2s', 'Keep captions moving', 'Payoff at the end'],
    momentHighlights: [{ atSec: round2(durationSec / 2), note: 'Emphasize the key point' }],
    endCta: str(guidance ? 'Follow for more' : 'Save this', 40) || 'Follow for more',
    _heuristic: true,
  };
}

function normalizeDirection(raw, { guidance, transcriptText, durationSec }) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const highlights = (Array.isArray(d.momentHighlights) ? d.momentHighlights : [])
    .map((h) => ({ atSec: num(h.atSec, 0, 0, durationSec), note: str(h.note, 160) }))
    .filter((h) => h.note)
    .sort((a, b) => a.atSec - b.atSec)
    .slice(0, 5);
  const fallback = heuristicDirection(guidance, transcriptText, durationSec);
  return {
    hookRewrite: str(d.hookRewrite, 60) || fallback.hookRewrite,
    hookRationale: str(d.hookRationale, 200) || fallback.hookRationale,
    targetEmotion: EMOTIONS.includes(d.targetEmotion) ? d.targetEmotion : fallback.targetEmotion,
    pacing: d.pacing === 'medium' ? 'medium' : 'fast',
    captionStyle: CAPTION_STYLES.includes(d.captionStyle) ? d.captionStyle : fallback.captionStyle,
    captionAccent: str(d.captionAccent, 40) || fallback.captionAccent,
    retentionTactics: (Array.isArray(d.retentionTactics) ? d.retentionTactics : [])
      .map((t) => str(t, 80)).filter(Boolean).slice(0, 4),
    momentHighlights: highlights.length ? highlights : fallback.momentHighlights,
    endCta: str(d.endCta, 40) || fallback.endCta,
  };
}

async function runDirectorAgent({ guidance, transcript, brand, durationSec }, debug) {
  const startedAt = Date.now();
  const llm = resolvePlanAgentLlm('reelDirector');
  const { system, userTemplate } = splitPromptTemplate(loadPrompt('reelDirector'));
  const user = fillTemplate(userTemplate, {
    GUIDANCE: str(guidance, 1200),
    TRANSCRIPT: str(transcript.text, 4000),
    SEGMENTS_JSON: json((transcript.segments || []).slice(0, 40)),
    BRAND_JSON: json(brand || {}),
    DURATION_SEC: round2(durationSec),
  });
  try {
    const res = await completeText({
      model: llm.model, system, user, maxTokens: 1200,
      cacheKey: 'igsignal-reel-director', kind: 'reelDirector',
    });
    const direction = normalizeDirection(parseJson(res.text), { guidance, transcriptText: transcript.text, durationSec });
    debug.push(debugEntry({ source: 'Reel director', model: llm.model, system, user, output: res.text, startedAt, usage: res.usage }));
    return direction;
  } catch (err) {
    console.warn('[reelEditor] director agent failed —', err.message);
    debug.push(debugEntry({ source: 'Reel director', model: llm.model, system, user, output: '', startedAt, note: `Fell back to heuristic: ${err.message}` }));
    return heuristicDirection(guidance, transcript.text, durationSec);
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
      model: llm.model, system, user, maxTokens: 2000,
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
const ANIM_TYPES = ['title', 'callout', 'emoji', 'progress', 'zoom', 'lower-third', 'cta'];
const MOTIONS = ['pop', 'slide-up', 'fade', 'bounce', 'shake'];

function normalizeAnimation(a, durationSec) {
  if (!a || !ANIM_TYPES.includes(a.type)) return null;
  const start = num(a.start, 0, 0, durationSec);
  let end = num(a.end, start + 1.5, 0, durationSec);
  if (end <= start) end = Math.min(durationSec, start + 1.2);
  const pos = a.position && typeof a.position === 'object' ? a.position : {};
  const carriesText = ['title', 'callout', 'cta', 'lower-third'].includes(a.type);
  return {
    type: a.type,
    start: round2(start),
    end: round2(end),
    text: carriesText ? str(a.text, 60) : '',
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

async function runAnimationAgent({ direction, transcript, guidance, durationSec }, debug) {
  const startedAt = Date.now();
  const llm = resolvePlanAgentLlm('reelAnimations');
  const { system, userTemplate } = splitPromptTemplate(loadPrompt('reelAnimations'));
  const user = fillTemplate(userTemplate, {
    DIRECTION_JSON: json(direction),
    SEGMENTS_JSON: json((transcript.segments || []).slice(0, 40)),
    GUIDANCE: str(guidance, 600),
    DURATION_SEC: round2(durationSec),
  });
  try {
    const res = await completeText({
      model: llm.model, system, user, maxTokens: 2000,
      cacheKey: 'igsignal-reel-animations', kind: 'reelAnimations',
    });
    const parsed = parseJson(res.text);
    let animations = (Array.isArray(parsed?.animations) ? parsed.animations : [])
      .map((a) => normalizeAnimation(a, durationSec)).filter(Boolean).slice(0, 14);
    // Guarantee the two structural beats exist even if the model dropped them.
    if (!animations.some((a) => a.type === 'title')) {
      animations.unshift(normalizeAnimation({ type: 'title', start: 0, end: Math.min(2.6, durationSec), text: direction.hookRewrite, position: { x: 50, y: 20 }, motion: 'pop', emphasis: true }, durationSec));
    }
    if (!animations.some((a) => a.type === 'cta')) {
      animations.push(normalizeAnimation({ type: 'cta', start: Math.max(0, durationSec - 3), end: durationSec, text: direction.endCta, position: { x: 50, y: 78 }, motion: 'bounce', emphasis: true }, durationSec));
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
async function runReelEditor({ buffer, contentType, guidance = '', brand = null, durationSec = 0 } = {}) {
  const debug = [];
  const notes = [];
  const dur = num(durationSec, 30, 1, 120);

  const transcript = await transcribeWords(buffer, contentType);
  if (transcript.note) notes.push(transcript.note);

  const direction = await runDirectorAgent({ guidance, transcript, brand, durationSec: dur }, debug);

  // Caption timing is authoritative from Whisper; guidance is the fallback source.
  const rawCues = transcript.words.length
    ? chunkWordsToCues(transcript.words)
    : guidanceCues(guidance, dur);
  if (!transcript.words.length && rawCues.length) {
    notes.push('No speech detected — captions were built from your guidance and spread across the clip.');
  }

  const [captions, animations] = await Promise.all([
    runCaptionAgent({ cues: rawCues, direction, guidance }, debug),
    runAnimationAgent({ direction, transcript, guidance, durationSec: dur }, debug),
  ]);

  const spec = {
    meta: { durationSec: round2(dur), width: 1080, height: 1920 },
    strategy: {
      hook: direction.hookRewrite,
      hookRationale: direction.hookRationale,
      targetEmotion: direction.targetEmotion,
      pacing: direction.pacing,
      retentionTactics: direction.retentionTactics,
      endCta: direction.endCta,
      captionAccent: direction.captionAccent,
    },
    captions,
    animations,
  };

  return {
    spec,
    transcript: { text: transcript.text, wordCount: transcript.words.length },
    direction,
    debug: { source: 'Reel editor', agents: debug },
    notes,
  };
}

module.exports = {
  runReelEditor,
  transcribeWords,
  runDirectorAgent,
  runCaptionAgent,
  runAnimationAgent,
  chunkWordsToCues,
  normalizeDirection,
  normalizeAnimation,
};
