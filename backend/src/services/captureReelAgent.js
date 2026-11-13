/**
 * Capture Reel agent — Captures › Generate reel.
 * ------------------------------------------------------------------
 * One capture (its words + photos + clips) → one 9:16 Instagram reel.
 *
 *   1. loadMaterial()   — the capture's words, and every photo/clip with what
 *                         vision already read from it (clips get their timed
 *                         transcript so the director can cut on sentences)
 *   2. directReel()     — Reel Director (LLM, sees the photos + clip stills):
 *                         hook, shot list (asset, trim, motion, transition,
 *                         kicker, the line said over it), CTA, post caption
 *   3. voiceReel()      — voiceover mode: OpenAI TTS reads the lines, Whisper
 *                         times every word so cuts + karaoke captions land on
 *                         the voice. Original mode: the clips' own audio.
 *   4. buildTimeline()  — frames: scenes, captions, hook, end card
 *   5. renderReel()     — Remotion `CaptureReel` (backend/remotion) → MP4 → S3
 *
 * Like the cover agent, the LLM never writes markup: it returns a cut list the
 * code validates; the composition is fixed React. Runs in the background
 * (enqueueCaptureReel); the page polls the CaptureReel document.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { toFile } = require('openai');
const getOpenAIClient = require('./openaiClient');
const Project = require('../models/Project');
const CaptureReel = require('../models/CaptureReel');
const { completeToolCall, splitPromptTemplate } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const {
  getObjectBytes, uploadBytes, headObject, getMediaUrl, isS3Configured,
} = require('./s3Client');
const { analyzeVideoAsset } = require('./videoAnalysis');
const { brandKitColors, brandKitFonts } = require('./brandKitColors');
const { loadBrandDna } = require('./planInputs');
const { toVisionImage } = require('./visionImage');
const { recordBackgroundDebug } = require('./aiDebugLog');
const styleRun = require('./reelStyleRun');

const run = promisify(execFile);
const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'capture-reel.md');
const STYLE_RULES_FILE = path.join(__dirname, '..', '..', 'prompts', 'capture-reel-style.md');
const REMOTION_DIR = path.join(__dirname, '..', '..', 'remotion');

const FPS = 30;
const WIDTH = 1080;
const HEIGHT = 1920;
const MAX_ASSETS = 18;
const MAX_VISION_IMAGES = 12;
const MAX_SCENES = 18;
const MAX_STYLED_SCENES = 40; // fast-cut styles
const VOICE_LEAD = 0.15; // the voice starts a beat after frame 0
const CTA_SEC = 2.1;
const HOOK_MIN = 1.3;
const HOOK_MAX = 2.1;
const MOTIONS = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'none'];
const TRANSITIONS = ['cut', 'zoom', 'whip', 'slide', 'flash'];
const VOICES = ['coral', 'ash', 'sage', 'verse', 'nova', 'onyx', 'ballad', 'alloy'];
const STAGES = ['queued', 'reading', 'writing', 'voicing', 'cutting', 'saving', 'done'];

const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const frames = (sec) => Math.max(0, Math.round(sec * FPS));
const userError = (message) => Object.assign(new Error(message), { userFacing: true });

// Audio API prices (USD per minute of audio) — not token-billed, so the
// debug panel's cost needs them spelled out. Override when OpenAI reprices.
const TTS_USD_PER_MIN = Number(process.env.REEL_TTS_USD_PER_MIN) || 0.015; // gpt-4o-mini-tts
const WHISPER_USD_PER_MIN = Number(process.env.REEL_WHISPER_USD_PER_MIN) || 0.006; // whisper-1

// Every paid call of one reel run, as AI debug panel rows (see aiDebugLog).
function costLedger() {
  const rows = [];
  return {
    rows,
    add({ source, model = '', prompt = '', output = '', elapsedMs = 0, note = '', costUsd = 0, inputTokens = 0, outputTokens = 0 }) {
      rows.push({
        source, model, prompt, output, elapsedMs, note,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostUsd: Math.round(costUsd * 1e6) / 1e6 },
      });
    },
    total() { return rows.reduce((n, r) => n + (r.usage?.estimatedCostUsd || 0), 0); },
  };
}
const mins = (sec) => Math.max(0, num(sec)) / 60;

let promptCache = null;
const loadPrompt = () => (promptCache ||= fs.readFileSync(PROMPT_FILE, 'utf8'));
const fill = (tpl, vars) => Object.entries(vars).reduce((out, [k, v]) => out.split(`{{${k}}}`).join(String(v ?? '')), tpl);

// ── 1. Material ──────────────────────────────────────────────────────────────

function ffmpegPath() {
  return process.env.FFMPEG_PATH || require('ffmpeg-static');
}

// mono speech track small enough for Whisper's 25 MB limit
async function audioOf(buffer) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'capreel-a-'));
  try {
    const src = path.join(dir, 'src');
    const out = path.join(dir, 'voice.mp3');
    await fs.promises.writeFile(src, buffer);
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-t', '600', out], { timeout: 120000 });
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function whisperWords(mp3, { segments = false } = {}) {
  const client = getOpenAIClient();
  const res = await client.audio.transcriptions.create({
    file: await toFile(mp3, 'voice.mp3', { type: 'audio/mpeg' }),
    model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: segments ? ['word', 'segment'] : ['word'],
  });
  const words = (res.words || [])
    .map((w) => ({ text: str(w.word, 40), start: num(w.start), end: num(w.end) }))
    .filter((w) => w.text && w.end >= w.start);
  const segs = (res.segments || [])
    .map((s) => ({ start: Math.round(num(s.start) * 10) / 10, end: Math.round(num(s.end) * 10) / 10, text: str(s.text, 300) }))
    .filter((s) => s.text);
  return { words, segments: segs, duration: num(res.duration) };
}

// The words of a clip with their times — so the director can cut on sentences
// and original-audio captions stay in sync. Memoised per key.
const clipWordsCache = new Map();
async function clipWords(key) {
  if (clipWordsCache.has(key)) return clipWordsCache.get(key);
  const p = (async () => {
    const { buffer } = await getObjectBytes(key);
    return whisperWords(await audioOf(buffer), { segments: true });
  })();
  clipWordsCache.set(key, p);
  if (clipWordsCache.size > 40) clipWordsCache.delete(clipWordsCache.keys().next().value);
  p.catch(() => clipWordsCache.delete(key));
  return p;
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((resolve) => { t = setTimeout(() => resolve(null), ms); })])
    .finally(() => clearTimeout(t));
}

async function loadMaterial(reel, ledger) {
  const project = await Project.findOne({ _id: reel.projectId, user: reel.user });
  if (!project) throw userError('That capture no longer exists.');
  const captures = reel.captureIds.map((id) => project.captures.id(id)).filter(Boolean);
  if (!captures.length) throw userError('That capture no longer exists.');

  // clips nobody has watched yet (old captures): watch them now, keep the result
  let dirty = false;
  for (const c of captures) {
    for (const a of c.attachments || []) {
      if (a.type !== 'video' || !a.key || a.analysis?.status === 'done') continue;
      try {
        const t0 = Date.now();
        // eslint-disable-next-line no-await-in-loop
        const r = await withTimeout(analyzeVideoAsset(a.key), 150000);
        if (r) {
          a.analysis = { status: 'done', ...r, error: '', analyzedAt: new Date() };
          dirty = true;
          ledger?.add({
            source: 'Capture reel — clip analysis', model: r.model, elapsedMs: Date.now() - t0,
            output: `${r.durationSec}s clip · ${r.frames?.length || 0} still(s) · ${str(r.summary, 200)}`,
            inputTokens: num(r.inputTokens), outputTokens: num(r.outputTokens), costUsd: num(r.costUsd),
            note: 'clip had not been watched yet (stills + transcript + vision)',
          });
        }
      } catch (err) {
        console.warn('[captureReel] clip analysis failed', a.key, err.message);
      }
    }
  }
  if (dirty) await project.save().catch((err) => console.warn('[captureReel] could not keep clip analysis', err.message));

  const assets = [];
  for (const c of captures) {
    for (const a of c.attachments || []) {
      if (!a.key || assets.length >= MAX_ASSETS) continue;
      const an = a.analysis || {};
      if (a.type === 'image') {
        assets.push({
          id: `A${assets.length + 1}`, kind: 'image', key: a.key,
          summary: str(an.summary, 200), description: str(an.description, 400),
          subjects: (an.subjects || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean).slice(0, 8),
          text: str(an.text, 160),
        });
      } else if (a.type === 'video' && num(an.durationSec) > 0.5) {
        assets.push({
          id: `A${assets.length + 1}`, kind: 'video', key: a.key,
          durationSec: num(an.durationSec),
          summary: str(an.summary, 200), description: str(an.description, 500),
          transcript: str(an.transcript, 1500),
          stills: (an.frames || []).filter((f) => f?.key).map((f) => ({ key: f.key, t: num(f.t), summary: str(f.summary, 160) })),
        });
      }
    }
  }
  if (!assets.length) throw userError('This capture has no photos or clips to cut a reel from. Add some first.');

  // timed transcripts for clips that have speech (≤4)
  const talking = assets.filter((a) => a.kind === 'video' && a.transcript.split(/\s+/).length >= 6).slice(0, 4);
  await Promise.all(talking.map(async (a) => {
    try {
      const cached = clipWordsCache.has(a.key);
      const t0 = Date.now();
      const w = await clipWords(a.key);
      a.words = w.words;
      a.segments = w.segments;
      if (!cached) {
        ledger?.add({
          source: 'Capture reel — clip transcript (timed)', model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1',
          elapsedMs: Date.now() - t0, output: str(w.segments.map((x) => x.text).join(' '), 1200),
          costUsd: mins(w.duration || a.durationSec) * WHISPER_USD_PER_MIN, note: `${a.id} · ${Math.round(w.duration || a.durationSec)}s of audio`,
        });
      }
    } catch (err) {
      console.warn('[captureReel] clip transcription failed', a.key, err.message);
    }
  }));

  const turns = captures.flatMap((c) => c.conversationTurns || [])
    .filter((t) => str(t.text)).slice(-24)
    .map((t) => ({ role: t.role, text: str(t.text, 500) }));
  const capture = {
    project: project.name,
    notes: captures.map((c) => {
      const u = c.understanding || {};
      return {
        note: str(c.text, 3000) || str(c.sessionSummary, 3000),
        summary: str(c.sessionSummary, 1200),
        understanding: Object.fromEntries(Object.entries({
          happened: str(u.happened, 600), intent: str(u.intent, 400), difficulty: str(u.difficulty, 400),
          actionTaken: str(u.actionTaken, 600), outcome: str(u.outcome, 600),
          verifiedFacts: (u.verifiedFacts || []).slice(0, 12),
          observableDetails: (u.observableDetails || []).slice(0, 12),
        }).filter(([, v]) => (Array.isArray(v) ? v.length : v))),
      };
    }),
    ...(turns.length ? { conversation: turns } : {}),
  };
  return { project, captures, assets, capture };
}

// A small JPEG of a stored image, for the director's eyes.
async function thumbPart(key) {
  const { buffer, contentType } = await getObjectBytes(key);
  const vis = await toVisionImage(buffer, contentType, key);
  const jpg = await sharp(vis.buffer).rotate().resize(512, 512, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
  return { type: 'image', mediaType: 'image/jpeg', data: jpg.toString('base64') };
}

async function visionParts(assets) {
  const picks = [];
  for (const a of assets) {
    if (a.kind === 'image') picks.push({ label: `Image ${a.id} (photo)`, key: a.key });
  }
  for (const a of assets) {
    if (a.kind !== 'video') continue;
    for (const s of a.stills.slice(0, 2)) picks.push({ label: `Image ${a.id} @t=${s.t}s (still from clip)`, key: s.key });
  }
  const chosen = picks.slice(0, MAX_VISION_IMAGES);
  const parts = await Promise.all(chosen.map(async (p) => {
    try { return [{ type: 'text', text: p.label }, await thumbPart(p.key)]; } catch { return []; }
  }));
  return parts.flat();
}

// ── 2. Director ──────────────────────────────────────────────────────────────

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOL = {
  name: 'plan_capture_reel',
  description: 'The cut list for one Instagram reel made from this capture.',
  input_schema: obj({
    concept: { type: 'string' },
    audioMode: { type: 'string', enum: ['voiceover', 'original', 'music'] },
    voice: obj({ name: { type: 'string', enum: VOICES }, direction: { type: 'string' } }),
    hook: obj({ text: { type: 'string' }, emphasis: { type: 'string' } }),
    scenes: {
      type: 'array',
      items: obj({
        assetId: { type: 'string' },
        startSec: { type: 'number' },
        durationSec: { type: 'number' },
        voiceLine: { type: 'string' },
        kicker: { type: 'string' },
        overlayText: { type: 'string' },
        cardNumber: { type: 'integer' },
        motion: { type: 'string', enum: MOTIONS },
        transition: { type: 'string', enum: TRANSITIONS },
        focusX: { type: 'number' },
        focusY: { type: 'number' },
      }),
    },
    cta: obj({ line: { type: 'string' }, sub: { type: 'string' } }),
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  }),
};

function assetsForPrompt(assets) {
  return assets.map((a) => (a.kind === 'image'
    ? { id: a.id, type: 'photo', summary: a.summary, description: a.description, subjects: a.subjects, ...(a.text ? { textInImage: a.text } : {}) }
    : {
      id: a.id, type: 'clip', durationSec: a.durationSec, summary: a.summary, description: a.description,
      stills: a.stills.map((s) => ({ t: s.t, summary: s.summary })),
      ...(a.segments?.length ? { timedTranscript: a.segments } : (a.transcript ? { transcript: a.transcript } : {})),
    }));
}

const wordsIn = (s) => String(s || '').split(/\s+/).filter(Boolean);

function normalizePlan(raw, assets, style = null) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const p = raw && typeof raw === 'object' ? raw : {};
  const cardsOn = Boolean(style?.chapters?.numbered) && style?.chapters?.card === 'white-card';
  const overlayOf = (v) => (style
    ? str(v, 90).split(/\s*(?:\n|\|)\s*/).map((l) => wordsIn(l).join(' ')).filter(Boolean).join(' | ')
      .split(' ').slice(0, 10).join(' ')
    : '');
  const scenes = (Array.isArray(p.scenes) ? p.scenes : []).map((s) => {
    if (cardsOn && str(s?.assetId, 8).toUpperCase() === 'CARD' && Number(s.cardNumber) > 0) {
      return {
        assetId: 'CARD', card: true, cardNumber: Math.min(20, Math.round(Number(s.cardNumber))),
        startSec: 0, durationSec: clampN(num(s.durationSec, 1.8), 1, 3),
        voiceLine: str(s.voiceLine, 260), kicker: '', overlayText: overlayOf(s.overlayText),
        motion: 'none', transition: 'cut', focusX: 50, focusY: 50,
      };
    }
    const a = byId.get(str(s?.assetId, 8));
    if (!a) return null;
    let start = a.kind === 'video' ? clampN(num(s.startSec), 0, Math.max(0, a.durationSec - 0.5)) : 0;
    let dur = clampN(num(s.durationSec, 2), style ? 0.3 : 0.8, a.kind === 'video' ? 8 : (style ? 6 : 4));
    if (a.kind === 'video' && start + dur > a.durationSec) {
      start = Math.max(0, a.durationSec - dur);
      dur = Math.min(dur, a.durationSec - start);
    }
    return {
      assetId: a.id,
      startSec: Math.round(start * 100) / 100,
      durationSec: Math.round(dur * 100) / 100,
      voiceLine: str(s.voiceLine, 260),
      kicker: style ? '' : wordsIn(str(s.kicker, 28)).slice(0, 4).join(' '),
      overlayText: overlayOf(s.overlayText),
      motion: MOTIONS.includes(s.motion) ? s.motion : (a.kind === 'video' ? 'none' : 'push-in'),
      transition: TRANSITIONS.includes(s.transition) ? s.transition : 'cut',
      focusX: Math.round(clampN(num(s.focusX, 50), 0, 100)),
      focusY: Math.round(clampN(num(s.focusY, 45), 0, 100)),
    };
  }).filter(Boolean).slice(0, style ? MAX_STYLED_SCENES : MAX_SCENES);
  if (scenes[0]?.card) scenes.push(scenes.shift()); // never open on a chapter card
  // a styled plan that holds one shot (a single-take reference) becomes a slow
  // sequence of the capture's photos — one still cannot carry a long take
  if (style && scenes.filter((x) => !x.card).length < 2 && assets.length >= 2) {
    const first = scenes.find((x) => !x.card) || null;
    const asked = scenes.reduce((n, x) => n + x.durationSec, 0);
    const total = clampN(Math.max(asked, num(style.pacing?.targetLengthSec, 12)), 8, 30);
    const n = clampN(Math.round(total / 5), 2, Math.min(5, assets.length));
    const pool = assets.filter((a) => a.id !== first?.assetId)
      .sort((a, b) => (a.kind === 'image' ? 0 : 1) - (b.kind === 'image' ? 0 : 1));
    const moves = ['push-in', 'pan-left', 'pull-out', 'pan-right'];
    const per = Math.round((total / n) * 100) / 100;
    const seq = [];
    for (let i = 0; i < n; i += 1) {
      const a = i === 0 && first ? byId.get(first.assetId) : pool[(i - (first ? 1 : 0)) % pool.length];
      seq.push({
        ...(i === 0 && first ? first : {
          assetId: a.id, startSec: 0, voiceLine: '', kicker: '', overlayText: '', transition: 'cut', focusX: 50, focusY: 45,
        }),
        assetId: a.id,
        durationSec: a.kind === 'video' ? Math.min(per, a.durationSec) : Math.min(per, 6),
        motion: a.kind === 'video' ? 'none' : moves[i % moves.length],
      });
    }
    scenes.splice(0, scenes.length, ...seq, ...scenes.filter((x) => x.card));
  }
  if (scenes.filter((x) => !x.card).length < 2 && assets.length >= 2) throw new Error('The director returned fewer than two usable shots.');
  if (!scenes.length) throw new Error('The director returned no usable shots.');
  scenes[0].kicker = '';
  scenes[0].transition = 'cut';
  let kickers = 0;
  scenes.forEach((s) => { if (s.kicker && ++kickers > 4) s.kicker = ''; });

  const talking = scenes.some((s) => !s.card && byId.get(s.assetId).kind === 'video' && byId.get(s.assetId).words?.length);
  const musicLed = style?.audio?.mode === 'music';
  let audioMode = musicLed ? 'music' : (p.audioMode === 'original' && talking ? 'original' : 'voiceover');
  const voiceWords = scenes.reduce((n, s) => n + wordsIn(s.voiceLine).length, 0);
  if (musicLed) {
    scenes.forEach((x) => { x.voiceLine = ''; });
    // no narration is tied to the picture: a photo repeated back-to-back is
    // swapped for the least-used other one (a repeated still is a dead cut)
    const used = new Map();
    scenes.forEach((x) => used.set(x.assetId, (used.get(x.assetId) || 0) + 1));
    for (let i = 1; i < scenes.length; i += 1) {
      const cur = scenes[i];
      if (cur.card || cur.assetId !== scenes[i - 1].assetId || byId.get(cur.assetId)?.kind !== 'image') continue;
      const spare = assets.filter((a) => a.id !== cur.assetId && a.id !== scenes[i + 1]?.assetId)
        .sort((a, b) => (used.get(a.id) || 0) - (used.get(b.id) || 0))[0];
      if (!spare) continue;
      used.set(cur.assetId, used.get(cur.assetId) - 1);
      used.set(spare.id, (used.get(spare.id) || 0) + 1);
      Object.assign(cur, { assetId: spare.id, startSec: 0 });
    }
  }
  if (audioMode === 'original') scenes.forEach((x) => { if (x.card) x.card = false; });
  if (audioMode === 'voiceover' && voiceWords < 6) {
    if (talking) audioMode = 'original';
    else throw new Error('The director wrote no narration.');
  }

  const hookText = wordsIn(str(p.hook?.text, 120)).slice(0, style ? 14 : 9).join(' ');
  const emph = str(p.hook?.emphasis, 30);
  const hookWords = wordsIn(hookText).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''));
  const emphasis = hookWords.includes(emph.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')) ? emph : '';
  const hashtags = [...new Set((Array.isArray(p.hashtags) ? p.hashtags : [])
    .map((h) => str(h, 40).replace(/\s+/g, ''))
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .filter((h) => /^#[\p{L}\p{N}_]{2,}$/u.test(h)))].slice(0, 10);

  return {
    concept: str(p.concept, 400),
    audioMode,
    voice: { name: VOICES.includes(p.voice?.name) ? p.voice.name : 'coral', direction: str(p.voice?.direction, 300) },
    hook: { text: hookText, emphasis },
    scenes,
    cta: { line: wordsIn(str(p.cta?.line, 80)).slice(0, 10).join(' '), sub: str(p.cta?.sub, 40) },
    caption: str(p.caption, 2200),
    hashtags,
  };
}

async function directReel({ material, handle, brand, direction, style = null }) {
  const split = splitPromptTemplate(loadPrompt());
  // a chosen reel style adds its rules to the system prompt and its spec to the data
  const system = style ? `${split.system}\n\n${fs.readFileSync(STYLE_RULES_FILE, 'utf8')}` : split.system;
  const userTemplate = style
    ? `${split.userTemplate}\n\nREEL STYLE (follow its pattern, not its words):\n${JSON.stringify(styleRun.styleBriefOf(style), null, 2)}`
    : split.userTemplate;
  const user = fill(userTemplate, {
    HANDLE: handle ? `@${handle}` : '(no handle connected)',
    BRAND_JSON: JSON.stringify(brand || {}, null, 2),
    CAPTURE_JSON: JSON.stringify(material.capture, null, 2),
    ASSETS_JSON: JSON.stringify(assetsForPrompt(material.assets), null, 2),
    DIRECTION: direction || '(none)',
  });
  const images = await visionParts(material.assets);
  const llm = resolvePlanAgentLlm('captureReel');
  const started = Date.now();
  const res = await completeToolCall({
    model: llm.model,
    system,
    userParts: [...images, { type: 'text', text: user }],
    tool: TOOL,
    maxTokens: 16000,
    kind: 'captureReel',
    timeoutMs: 240000,
    retryHint: 'Return ONLY the JSON object for plan_capture_reel, matching the schema exactly.',
  });
  const usage = res.usage || {};
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const costUsd = estimatePlanCostUsd(res.model, inputTokens, outputTokens, num(usage.cached_tokens));
  const debug = {
    source: 'Capture reel — director',
    model: res.model,
    prompt: `${system}\n\n---\n\n${user}\n\n[${images.filter((x) => x.type === 'image').length} image(s) attached]`,
    output: JSON.stringify(res.parsed, null, 2),
    elapsedMs: Date.now() - started,
    inputTokens,
    outputTokens,
    costUsd,
  };
  let plan;
  try {
    plan = normalizePlan(res.parsed, material.assets, style);
  } catch (err) {
    // the rejected cut list goes to the debug panel with the error
    err.debug = { ...debug, note: `rejected: ${err.message}` };
    throw err;
  }
  return {
    plan,
    raw: res.parsed,
    model: res.model,
    costUsd,
    debug,
  };
}

// ── 3. Voice ─────────────────────────────────────────────────────────────────

async function voiceReel(plan) {
  const t0 = Date.now();
  const script = plan.scenes.map((s) => s.voiceLine).filter(Boolean).join(' ');
  const client = getOpenAIClient();
  const speech = await client.audio.speech.create({
    model: process.env.REEL_TTS_MODEL || 'gpt-4o-mini-tts',
    voice: plan.voice.name,
    input: script,
    instructions: [
      'Read this as a natural, confident Instagram Reel voiceover from the studio owner.',
      'Conversational and warm, with energy on the first line; quick pace, tiny pauses between sentences, no announcer voice.',
      plan.voice.direction,
    ].filter(Boolean).join(' '),
    response_format: 'mp3',
  });
  const mp3 = Buffer.from(await speech.arrayBuffer());
  const ttsMs = Date.now() - t0;
  const timed = await whisperWords(mp3);
  const whisperMs = Date.now() - t0 - ttsMs;
  let { words } = timed;
  const total = timed.duration || (words.length ? words[words.length - 1].end : 0);
  if (!words.length) {
    // no timings back: spread the script evenly over the track
    const ws = wordsIn(script);
    const per = (total || ws.length / 2.6) / Math.max(1, ws.length);
    words = ws.map((w, i) => ({ text: w, start: i * per, end: (i + 1) * per }));
  }
  return { mp3, words, duration: total || words[words.length - 1].end, script, chars: script.length, ttsMs, whisperMs };
}

// ── 4. Timeline ──────────────────────────────────────────────────────────────

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// Captions are lit in the brand accent over footage — a near-black accent would
// vanish, so it is lifted toward white (same hue) until it reads.
function liftAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#FFFFFF';
  let rgb = [0, 8, 16].map((s) => (parseInt(m[1], 16) >> (16 - s)) & 255);
  for (let i = 0; i < 12 && luminance(`#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`) < 0.28; i += 1) {
    rgb = rgb.map((c) => Math.round(c + (255 - c) * 0.18));
  }
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// 2–3 word karaoke cues, broken at pauses and punctuation.
function captionCues(words) {
  const cues = [];
  let cur = [];
  const flush = () => { if (cur.length) cues.push(cur); cur = []; };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= 3 || w.start - prev.end > 0.35 || /[.!?,;:]$/.test(prev.text) || w.end - cur[0].start > 1.4)) flush();
    cur.push(w);
  });
  flush();
  return cues.map((ws, i) => {
    const next = cues[i + 1];
    const end = Math.min(next ? next[0].start : Infinity, ws[ws.length - 1].end + 0.35);
    const fromFrame = frames(ws[0].start);
    const toFrame = Math.max(fromFrame + 6, frames(end));
    return {
      fromFrame,
      toFrame,
      words: ws.map((w, j) => ({
        text: w.text.replace(/^[^\p{L}\p{N}$#@]+|[.,;:]+$/gu, ''),
        fromFrame: frames(w.start),
        toFrame: j < ws.length - 1 ? frames(ws[j + 1].start) : toFrame,
      })).filter((w) => w.text),
    };
  }).filter((c) => c.words.length);
}

// Remotion fetches media over http: a light, upright JPEG next to each photo
// (HEIC-safe), the clip itself as stored.
async function imageSrc(key) {
  const out = `${key.replace(/\.[^./]+$/, '')}.reel.jpg`;
  const have = await headObject(out).catch(() => null);
  if (!have) {
    const { buffer, contentType } = await getObjectBytes(key);
    const vis = await toVisionImage(buffer, contentType, key);
    const jpg = await sharp(vis.buffer).rotate()
      .resize(1440, 2560, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    await uploadBytes(out, jpg, 'image/jpeg', { immutable: true });
  }
  return getMediaUrl(out);
}

// Clips re-shared from Instagram are often letterboxed inside the frame (black
// bands baked into the pixels, sometimes only for part of the clip). Find the
// picture inside the bands over a shot's window, as fractions of the frame, so
// the composition can zoom past them (the union of the banded frames).
// null = no bands worth removing.
const clipFileCache = new Map();
async function clipFile(key) {
  if (!clipFileCache.has(key)) {
    clipFileCache.set(key, (async () => {
      const { buffer } = await getObjectBytes(key);
      const file = path.join(os.tmpdir(), `capreel-clip-${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`);
      await fs.promises.writeFile(file, buffer);
      return file;
    })());
  }
  return clipFileCache.get(key);
}

async function letterboxOf(key, startSec, durSec) {
  try {
    const file = await clipFile(key);
    const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', '-ss', String(startSec), '-t', String(Math.max(0.5, durSec)),
      '-i', file, '-an', '-vf', 'cropdetect=limit=40:round=2:reset=1:skip=0', '-f', 'null', '-'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const size = /Video: [^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr);
    const crops = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => m.slice(1).map(Number));
    if (!size || !crops.length) return null;
    const [W, H] = [Number(size[1]), Number(size[2])];
    // bands for part of the shot: zoom when they are on for a good share of
    // it (a clean frame then only gets a slightly tighter crop)
    const boxed = crops.filter((c) => c[0] < W * 0.96 || c[1] < H * 0.96);
    if (boxed.length < crops.length * 0.4) return null;
    const x0 = Math.min(...boxed.map((c) => c[2]));
    const y0 = Math.min(...boxed.map((c) => c[3]));
    const x1 = Math.max(...boxed.map((c) => c[2] + c[0]));
    const y1 = Math.max(...boxed.map((c) => c[3] + c[1]));
    const box = { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
    if (box.w >= 0.96 && box.h >= 0.96) return null;
    if (box.w < 0.35 || box.h < 0.35) return null; // a dark shot, not bands
    return Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  } catch (err) {
    console.warn('[captureReel] letterbox check failed', key, err.message);
    return null;
  }
}

// The still of a clip nearest a time — used when the clip is too short to fill
// its shot, and for the end card's backdrop.
const stillNear = (asset, t) => asset.stills.slice().sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0] || null;

async function buildTimeline({ plan, material, voice, voiceUrl, brand, style = null, music = null }) {
  const byId = new Map(material.assets.map((a) => [a.id, a]));
  const look = style ? styleRun.lookOf(style) : null;
  let shots = [];
  const captionWords = [];
  let voEnd;

  if (plan.audioMode === 'voiceover') {
    // a shot runs while its line is said: cut a hair before its first word
    const counts = plan.scenes.map((s) => wordsIn(s.voiceLine).length);
    const S = counts.reduce((a, b) => a + b, 0) || 1;
    const W = voice.words.length;
    let cum = 0;
    const starts = counts.map((n, i) => {
      const at = i === 0 ? 0 : Math.max(0, VOICE_LEAD + voice.words[Math.min(W - 1, Math.round((cum * W) / S))].start - 0.08);
      cum += n;
      return at;
    });
    for (let i = 1; i < starts.length; i += 1) starts[i] = Math.max(starts[i], starts[i - 1] + 0.6);
    voEnd = VOICE_LEAD + voice.duration;
    plan.scenes.forEach((s, i) => {
      const end = i < starts.length - 1 ? starts[i + 1] : voEnd + 0.2;
      shots.push({ scene: s, start: starts[i], dur: Math.max(0.5, end - starts[i]), volume: 0 });
    });
    voice.words.forEach((w) => captionWords.push({ text: w.text, start: w.start + VOICE_LEAD, end: w.end + VOICE_LEAD }));
    if (style) shots = styleRun.splitFastShots(shots, { shotSec: style.pacing?.shotSec, assets: material.assets, hookHoldSec: num(style.pacing?.hookHoldSec, 0), everyShot: style.text?.perShot === 'every-shot' });
  } else if (plan.audioMode === 'music') {
    // music-led: the director's shot lengths, the opener held, cuts on the beat
    let t = 0;
    plan.scenes.forEach((s, i) => {
      const dur = i === 0 ? Math.max(s.durationSec, clampN(num(style?.pacing?.hookHoldSec, 1.5), 0.8, 3)) : s.durationSec;
      shots.push({ scene: s, start: t, dur, volume: 0 });
      t += dur;
    });
    if (style?.pacing?.beatSync && music?.beats) {
      const snapped = styleRun.snapToBeats(shots, music.beats, { shotSec: style.pacing.shotSec });
      shots = shots.map((sh, i) => ({ ...sh, ...snapped[i] }));
    }
    voEnd = t;
  } else {
    let t = 0;
    plan.scenes.forEach((s) => {
      const a = byId.get(s.assetId);
      if (!a) return;
      const dur = a.kind === 'video' ? s.durationSec : Math.min(s.durationSec, 1.6);
      shots.push({ scene: s, start: t, dur, volume: a.kind === 'video' ? 1 : 0 });
      if (a.kind === 'video' && a.words?.length) {
        a.words
          .filter((w) => w.start >= s.startSec - 0.05 && w.end <= s.startSec + dur + 0.05)
          .forEach((w) => captionWords.push({ text: w.text, start: t + (w.start - s.startSec), end: t + (w.end - s.startSec) }));
      }
      t += dur;
    });
    voEnd = t;
  }

  const endCard = look ? look.endCard : 'card';
  const lastEnd = shots.length ? shots[shots.length - 1].start + shots[shots.length - 1].dur : voEnd;
  const hasCta = Boolean(plan.cta.line) && endCard !== 'none';
  // text-on-shot: the last shot is held a beat longer and carries the CTA
  if (hasCta && endCard === 'text-on-shot' && shots.length) shots[shots.length - 1].dur += CTA_SEC;
  const ctaStart = endCard === 'text-on-shot' ? lastEnd : lastEnd;
  const total = hasCta ? lastEnd + CTA_SEC : lastEnd + 0.3;

  // every shot's media is prepared at once (S3 reads, JPEG copies, band checks)
  const scenes = await Promise.all(shots.map(async (sh) => {
    const a = byId.get(sh.scene.assetId);
    if (sh.scene.card || !a) {
      return {
        from: frames(sh.start), durationInFrames: Math.max(1, frames(sh.start + sh.dur) - frames(sh.start)),
        kind: 'card', src: '', motion: 'none', transition: 'cut',
        cardNumber: sh.scene.cardNumber || 1, cardTitle: sh.scene.overlayText || '',
      };
    }
    const base = {
      from: frames(sh.start),
      durationInFrames: Math.max(1, frames(sh.start + sh.dur) - frames(sh.start)),
      motion: sh.scene.motion,
      transition: sh.scene.transition,
      focusX: sh.scene.focusX,
      focusY: sh.scene.focusY,
      ...(sh.scene.kicker ? { kicker: sh.scene.kicker } : {}),
      ...(sh.scene.overlayText ? { overlayText: sh.scene.overlayText } : {}),
    };
    const still = (key) => imageSrc(key).then((src) => ({ ...base, kind: 'image', src, motion: base.motion === 'none' ? 'push-in' : base.motion }));
    if (a.kind !== 'video') return still(a.key);
    let start = sh.scene.startSec;
    if (a.durationSec - start < sh.dur) start = Math.max(0, a.durationSec - sh.dur);
    if (a.durationSec - start - 0.1 >= sh.dur) {
      const [src, crop] = await Promise.all([getMediaUrl(a.key), letterboxOf(a.key, start, sh.dur)]);
      return { ...base, kind: 'video', src, sourceStartSec: start, volume: sh.volume, ...(crop ? { crop } : {}) };
    }
    // too short for the line said over it: hold its closest still instead
    const near = stillNear(a, start);
    if (near) return still(near.key);
    return { ...base, kind: 'video', src: await getMediaUrl(a.key), sourceStartSec: 0, volume: sh.volume };
  }));

  // end card backdrop: the opening shot again (a loop back to the hook)
  if (hasCta && endCard === 'card') {
    const first = byId.get(plan.scenes[0].assetId);
    const still = first.kind === 'video' ? stillNear(first, plan.scenes[0].startSec) : null;
    const key = first.kind === 'image' ? first.key : still?.key;
    const last = scenes[scenes.length - 1];
    if (key) {
      scenes.push({
        from: frames(ctaStart), durationInFrames: frames(total) - frames(ctaStart), kind: 'image',
        src: await imageSrc(key), motion: 'pull-out', transition: 'zoom',
        focusX: plan.scenes[0].focusX, focusY: plan.scenes[0].focusY,
      });
    } else if (last) {
      last.durationInFrames = frames(total) - last.from;
    }
  }

  const hookSec = style
    ? clampN(num(style.pacing?.hookHoldSec, 1.6), 1.1, 3.2)
    : clampN(0.55 + wordsIn(plan.hook.text).length * 0.22, HOOK_MIN, HOOK_MAX);
  const accent = brand.accent || '#FFFFFF';
  const lit = liftAccent(accent);
  return {
    format: { width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: frames(total) },
    brand: {
      accent: lit,
      accentInk: luminance(lit) > 0.45 ? '#111111' : '#FFFFFF',
      headlineFont: brand.headlineFont || '',
      bodyFont: brand.bodyFont || '',
    },
    ...(plan.hook.text ? { hook: { text: plan.hook.text, emphasis: plan.hook.emphasis, durationInFrames: frames(hookSec) } } : {}),
    scenes,
    // captions stay off the end card
    captions: look?.captions === 'none' ? [] : captionCues(captionWords.filter((w) => w.start < ctaStart)),
    ...(hasCta ? { cta: { line: plan.cta.line, sub: plan.cta.sub, fromFrame: frames(ctaStart), durationInFrames: frames(total) - frames(ctaStart) } } : {}),
    ...((voiceUrl || music?.url) ? {
      audio: {
        ...(voiceUrl ? { voiceoverSrc: voiceUrl, voiceVolume: 1, startFrame: frames(VOICE_LEAD) } : {}),
        ...(music?.url ? { musicSrc: music.url, musicVolume: plan.audioMode === 'music' ? 0.9 : 0.13 } : {}),
      },
    } : {}),
    ...(look ? { look } : {}),
  };
}

// ── 5. Render ────────────────────────────────────────────────────────────────

function renderReel(timeline, outPath, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const specPath = path.join(os.tmpdir(), `capreel-${crypto.randomUUID()}.json`);
    fs.writeFileSync(specPath, JSON.stringify({ composition: 'CaptureReel', props: { reel: timeline } }));
    const child = spawn('node', ['render.mjs', specPath, outPath], { cwd: REMOTION_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timingLines = '';
    child.stderr.on('data', (d) => {
      const text = d.toString();
      if (text.includes('[render:timing]')) timingLines += text;
      stderr = (stderr + text).slice(-6000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.unlink(specPath, () => {});
      const bundleMs = /\[render:timing\] bundle (\d+)ms/.exec(timingLines);
      const renderMs = /· render (\d+)ms/.exec(timingLines);
      const timing = bundleMs && renderMs ? { 'render · bundle': Number(bundleMs[1]), 'render · frames': Number(renderMs[1]) } : null;
      if (code === 0 && fs.existsSync(outPath)) { resolve({ outPath, timing }); return; }
      const tail = stderr.split('\n').filter(Boolean).slice(-6).join(' | ');
      // the renderer workspace was never installed on this server (see scripts/setup-remotion.js)
      if (/ERR_MODULE_NOT_FOUND|Cannot find (package|module) '@remotion|Could not find Chrome|browser.*not.*found/i.test(stderr)) {
        reject(Object.assign(new Error('Video rendering is not set up on this server yet, so the reel could not be made.'), { userFacing: true, detail: tail }));
        return;
      }
      reject(Object.assign(new Error(`Reel render failed (${code === null ? 'killed — out of memory or timed out' : `exit ${code}`})`), { detail: tail }));
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function posterOf(mp4Path, atSec) {
  const out = `${mp4Path}.jpg`;
  await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(atSec), '-i', mp4Path,
    '-frames:v', '1', '-vf', 'scale=720:-2', '-q:v', '4', out], { timeout: 60000 });
  const buf = await fs.promises.readFile(out);
  fs.promises.unlink(out).catch(() => {});
  return buf;
}

// ── Orchestration + queue ────────────────────────────────────────────────────

// wall-clock time spent in each stage (ms) — kept on the reel + shown in the debug panel
function stageClock() {
  const times = {};
  let cur = null;
  let at = Date.now();
  return {
    to(name) { const now = Date.now(); if (cur) times[cur] = (times[cur] || 0) + now - at; cur = name; at = now; },
    end() { this.to(null); return times; },
    times,
  };
}

async function stage(reel, name, clock) {
  reel.stage = name;
  clock?.to(name);
  await CaptureReel.updateOne({ _id: reel._id }, { $set: { stage: name, status: 'working' } });
}

async function runCaptureReel(reelId) {
  const reel = await CaptureReel.findById(reelId);
  if (!reel || reel.status === 'done') return;
  if (!isS3Configured()) {
    await CaptureReel.updateOne({ _id: reelId }, { $set: { status: 'error', error: 'Storage is not configured, so a reel cannot be rendered here.' } });
    return;
  }
  const started = Date.now();
  const tmp = path.join(os.tmpdir(), `capreel-${reel._id}.mp4`);
  const ledger = costLedger();
  let model = '';
  const clock = stageClock();
  clock.to('reading');
  try {
    await CaptureReel.updateOne({ _id: reel._id }, { $set: { status: 'working', stage: 'reading', startedAt: new Date(), error: '' } });
    const material = await loadMaterial(reel, ledger);
    const handle = reel.instagramUsername || '';
    const [dna, colors, fonts] = await Promise.all([
      handle ? loadBrandDna(reel.user, handle).catch(() => null) : null,
      brandKitColors(reel.user, handle),
      brandKitFonts(reel.user, handle),
    ]);
    const brandForPrompt = dna ? Object.fromEntries(Object.entries({
      whatYouOffer: dna.whatYouOffer, whoYouHelp: dna.whoYouHelp, position: dna.position,
      howYouSound: dna.howYouSound, neverDo: dna.neverDo,
      voice: dna.brandVoice && typeof dna.brandVoice === 'object' ? dna.brandVoice : undefined,
    }).filter(([, v]) => v)) : {};

    const styleDoc = reel.styleId ? await require('../models/ReelStyle').findById(reel.styleId).lean() : null;
    const style = styleDoc?.status === 'ready' ? styleDoc.style : null;
    if (reel.styleId && !style) throw userError('That reel style is not available any more. Pick another.');

    await stage(reel, 'writing', clock);
    const directed = await directReel({ material, handle, brand: brandForPrompt, direction: reel.direction, style });
    ledger.add(directed.debug);
    model = directed.model;
    const { plan } = directed;

    // the style's music bed is generated while the voice is recorded
    const wantsMusic = style && style.audio?.mode !== 'voiceover' && plan.audioMode !== 'original';
    const musicJob = wantsMusic
      ? styleRun.generateMusic(style).catch((err) => { console.warn(`[captureReel] ${reel._id} music:`, err.message); return { error: err.message }; })
      : null;

    let voice = null;
    let voiceUrl = '';
    let voiceKey = '';
    if (plan.audioMode === 'voiceover') {
      await stage(reel, 'voicing', clock);
      voice = await voiceReel(plan);
      voiceKey = `projects/${reel.user}/reel-${reel._id}-voice.mp3`;
      await uploadBytes(voiceKey, voice.mp3, 'audio/mpeg', { immutable: true });
      voiceUrl = await getMediaUrl(voiceKey);
      ledger.add({
        source: 'Capture reel — voiceover (TTS)',
        model: process.env.REEL_TTS_MODEL || 'gpt-4o-mini-tts',
        prompt: `voice: ${plan.voice.name}${plan.voice.direction ? ` · ${plan.voice.direction}` : ''}\n\n${voice.script}`,
        output: `${voice.duration.toFixed(1)}s of audio`,
        elapsedMs: voice.ttsMs,
        costUsd: mins(voice.duration) * TTS_USD_PER_MIN,
        note: `≈ $${TTS_USD_PER_MIN}/min of audio`,
      });
      ledger.add({
        source: 'Capture reel — voice word timing',
        model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1',
        output: `${voice.words.length} timed words`,
        elapsedMs: voice.whisperMs,
        costUsd: mins(voice.duration) * WHISPER_USD_PER_MIN,
      });
    }

    let music = null;
    let musicKeySaved = '';
    if (musicJob) {
      await stage(reel, 'scoring', clock);
      const got = await musicJob;
      if (got?.mp3) {
        music = got;
        ledger.add({
          source: 'Capture reel — music bed', model: got.model, prompt: got.prompt,
          output: got.beats ? `${got.beats.bpm} BPM · pulse ${got.beats.pulse} · ${got.beats.durationSec}s generated` : 'generated',
          elapsedMs: got.elapsedMs, costUsd: got.costUsd, note: 'original instrumental (Lyria) · cost is an estimate per track (REEL_MUSIC_USD_PER_TRACK)',
        });
      } else {
        ledger.add({ source: 'Capture reel — music bed', output: `Skipped: ${got?.error || 'unavailable'}`, note: 'reel rendered without music' });
      }
    }

    await stage(reel, 'cutting', clock);
    const brand = {
      accent: colors?.accent || '',
      headlineFont: fonts?.heading?.family || '',
      bodyFont: fonts?.body?.family || '',
    };
    const timeline = await buildTimeline({ plan, material, voice, voiceUrl, brand, style, music });
    if (music) {
      // the bed is cut to the finished length, faded, and stored with the reel
      const bed = await styleRun.fitMusic(music.mp3, timeline.format.durationInFrames / FPS);
      const musicKey = `projects/${reel.user}/reel-${reel._id}-music.mp3`;
      await uploadBytes(musicKey, bed, 'audio/mpeg', { immutable: true });
      timeline.audio = { ...(timeline.audio || {}), musicSrc: await getMediaUrl(musicKey), musicVolume: plan.audioMode === 'music' ? 0.9 : 0.13 };
      musicKeySaved = musicKey;
    }
    await stage(reel, 'rendering', clock); // 'cutting' above = choosing + preparing the media
    const renderInfo = await renderReel(timeline, tmp);
    if (renderInfo.timing) Object.assign(clock.times, renderInfo.timing);

    await stage(reel, 'saving', clock);
    const videoKey = `projects/${reel.user}/reel-${reel._id}.mp4`;
    const posterKey = `projects/${reel.user}/reel-${reel._id}-poster.jpg`;
    const hookEnd = timeline.hook ? timeline.hook.durationInFrames / FPS - 0.2 : 0.8;
    await Promise.all([
      fs.promises.readFile(tmp).then((buf) => uploadBytes(videoKey, buf, 'video/mp4', { immutable: true })),
      posterOf(tmp, Math.max(0.3, hookEnd))
        .then((jpg) => uploadBytes(posterKey, jpg, 'image/jpeg', { immutable: true }))
        .catch((err) => console.warn('[captureReel] poster failed', err.message)),
    ]);
    await CaptureReel.updateOne({ _id: reel._id }, {
      $set: {
        status: 'done', stage: 'done', error: '',
        plan, timeline,
        caption: plan.caption, hashtags: plan.hashtags,
        videoKey, posterKey, voiceKey, musicKey: musicKeySaved,
        durationSec: Math.round((timeline.format.durationInFrames / FPS) * 10) / 10,
        model,
        costUsd: Math.round(ledger.total() * 10000) / 10000,
        timings: clock.end(),
        finishedAt: new Date(),
      },
    });
    // on the calendar like a generated carousel (next empty publishing day)
    try {
      const post = await require('./reelCalendar').placeReelOnCalendar(reel._id);
      if (post) {
        ledger.add({ source: 'Capture reel — calendar', output: `Placed on ${post.date} (${post.day})`, note: `post ${post._id}` });
      }
    } catch (err) {
      console.error(`[captureReel] ${reel._id} could not be placed on the calendar:`, err.message);
    }
    console.log(`[captureReel] ${reel._id} timings ${JSON.stringify(clock.times)}`);
    console.log(`[captureReel] ${reel._id} done · ${plan.audioMode} · ${timeline.scenes.length} shots`
      + ` · ${(timeline.format.durationInFrames / FPS).toFixed(1)}s · ${Math.round((Date.now() - started) / 1000)}s · ~$${ledger.total().toFixed(3)}`);
  } catch (err) {
    if (err.debug) ledger.add(err.debug);
    const detail = [err.message, err.detail].filter(Boolean).join(' — ').slice(0, 2000);
    ledger.add({ source: 'Capture reel — failed', output: detail, note: `stage: ${reel.stage || '?'}` });
    console.error(`[captureReel] ${reel._id} failed:`, err.stack || err.message, err.detail || '');
    await CaptureReel.updateOne({ _id: reel._id }, {
      $set: {
        status: 'error',
        errorDetail: detail,
        error: err.userFacing ? err.message : 'The reel could not be made this time. Try again.',
        finishedAt: new Date(),
        costUsd: Math.round(ledger.total() * 10000) / 10000,
      },
    });
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
    for (const [key, file] of clipFileCache) {
      clipFileCache.delete(key);
      file.then((f) => fs.promises.unlink(f)).catch(() => {});
    }
    // the run's summary row in the AI debug panel: total cost + where the time went
    const times = clock.end();
    const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;
    ledger.add({
      source: 'Capture reel — timings',
      output: Object.entries(times).map(([k, v]) => `${k}: ${fmt(v)}`).join('\n'),
      elapsedMs: Date.now() - started,
      note: 'render + upload run on the worker (no API cost)',
    });
    const latest = await CaptureReel.findById(reel._id).select('status error').lean().catch(() => null);
    recordBackgroundDebug(reel.user, 'Capture reel', {
      agents: ledger.rows,
      model,
      mode: 'capture reel',
      elapsedMs: Date.now() - started,
      usage: { estimatedCostUsd: Math.round(ledger.total() * 1e6) / 1e6 },
      ...(latest?.status === 'error' ? { error: latest.error } : {}),
    });
  }
}

// In-process fallback runner (no Redis): one reel at a time per API process,
// tracked so a deploy lets it finish. The normal path is services/reelQueue.js.
const queue = [];
const active = new Set();
const CONCURRENCY = Math.max(1, Number(process.env.CAPTURE_REEL_CONCURRENCY) || 1);

function pump() {
  const { track } = require('../utils/backgroundWork');
  while (active.size < CONCURRENCY && queue.length) {
    const id = queue.shift();
    active.add(id);
    track(runCaptureReel(id)
      .catch((err) => console.error('[captureReel] runner crashed', err.message))
      .finally(() => { active.delete(id); pump(); }));
  }
}

function runInProcess(id) {
  const key = String(id);
  if (active.has(key) || queue.includes(key)) return;
  queue.push(key);
  pump();
}

const isRunningHere = (id) => active.has(String(id)) || queue.includes(String(id));

module.exports = {
  _loadMaterial: loadMaterial,
  _directReel: directReel,
  runInProcess,
  isRunningHere,
  runCaptureReel,
  // exported for tests
  normalizePlan,
  captionCues,
  buildTimeline,
  renderReel,
  liftAccent,
  letterboxOf,
  STAGES,
};
