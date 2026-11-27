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
  getObjectBytes, getObjectStream, uploadBytes, headObject, getMediaUrl, isS3Configured,
} = require('./s3Client');
const { analyzeVideoAsset } = require('./videoAnalysis');
const { brandKitColors, brandKitFonts } = require('./brandKitColors');
const { loadBrandDna } = require('./planInputs');
const { toVisionImage } = require('./visionImage');
const { recordBackgroundDebug } = require('./aiDebugLog');
const styleRun = require('./reelStyleRun');
const { memoryLimitMb } = require('../utils/memoryLimit');

// A render peaks around 700 MB (headless Chrome + ffmpeg, one tab — measured
// Nov 2026) on top of the process itself. Below this the container is
// OOM-killed mid-render and takes everything in the process down with it, so
// the reel is refused up front, before any paid model call.
const REEL_MIN_MEMORY_MB = Number(process.env.REEL_RENDER_MIN_MEMORY_MB) || 1536;

// A reel is tried up to this many times before it is marked failed (a
// temporary error, a worker that died). A retry after the cut was saved only
// re-renders it — no model call is paid twice.
const MAX_ATTEMPTS = Math.max(1, Number(process.env.CAPTURE_REEL_MAX_ATTEMPTS) || 3);
const retryError = (message) => Object.assign(new Error(message), { retryable: true });

// A saved timeline's media URLs may be presigned (no CDN) and expire after an
// hour — re-sign them from their keys before re-rendering.
async function refreshTimelineUrls(timeline) {
  const resign = async (url) => {
    if (!url || !/X-Amz-/i.test(url)) return url;
    try { return await getMediaUrl(decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''))); } catch { return url; }
  };
  const t = JSON.parse(JSON.stringify(timeline));
  await Promise.all((t.scenes || []).map(async (sc) => { sc.src = await resign(sc.src); }));
  // motion graphics reels keep their pictures in motion.media
  await Promise.all(Object.values(t.motion?.media || {}).map(async (m) => { m.src = await resign(m.src); }));
  if (t.audio) {
    t.audio.voiceoverSrc = await resign(t.audio.voiceoverSrc);
    t.audio.musicSrc = await resign(t.audio.musicSrc);
  }
  return t;
}

const run = promisify(execFile);
const PROMPT_FILE = path.join(__dirname, '..', '..', 'prompts', 'capture-reel.md');
const STYLE_RULES_FILE = path.join(__dirname, '..', '..', 'prompts', 'capture-reel-style.md');
const REMOTION_DIR = path.join(__dirname, '..', '..', 'remotion');

// 25 fps: every frame is a full headless-Chrome capture + encode (~2/3 of a
// frame's cost is that fixed overhead, measured Nov 2026), so 30 → 25 is ~17%
// less render time; Instagram takes 25 fps and slow camera moves don't show it.
const FPS = Math.min(30, Math.max(24, Number(process.env.REEL_FPS) || 25));
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
const TRANSITIONS = ['cut', 'zoom', 'whip', 'slide', 'flash', 'dissolve'];
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

// The soundtrack of a stored clip without holding the video in memory: the
// object streams to a temp file and ffmpeg reads it from disk. Phone clips run
// to hundreds of MB — buffering them (getObjectBytes) OOM-killed the 512 MB
// API instance on Include voiceover's sound check.
async function audioOfKey(key) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'capreel-k-'));
  try {
    const src = path.join(dir, 'src');
    const out = path.join(dir, 'voice.mp3');
    const { body } = await getObjectStream(key);
    await require('stream/promises').pipeline(body, fs.createWriteStream(src));
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
    .map((s) => ({
      start: Math.round(num(s.start) * 10) / 10, end: Math.round(num(s.end) * 10) / 10, text: str(s.text, 300),
      // how sure Whisper was it heard clear speech — the on-camera sound check (speechQualityOf)
      ...(s.avg_logprob != null ? { conf: Math.round(num(s.avg_logprob) * 100) / 100 } : {}),
      ...(s.no_speech_prob != null ? { noSpeech: Math.round(num(s.no_speech_prob) * 100) / 100 } : {}),
    }))
    .filter((s) => s.text);
  return { words, segments: segs, duration: num(res.duration) };
}

// Integrated loudness (LUFS) of a clip's sound — a whisper-quiet or distant
// speaker reads as poor sound however well Whisper understood it
async function loudnessOf(mp3) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'capreel-l-'));
  try {
    const src = path.join(dir, 'a.mp3');
    await fs.promises.writeFile(src, mp3);
    const { stderr } = await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-i', src, '-af', 'ebur128', '-f', 'null', '-'], { timeout: 60000 })
      .catch((e) => ({ stderr: e.stderr || '' }));
    const m = /Integrated loudness:[\s\S]*?I:\s*(-?[\d.]+)\s*LUFS/.exec(String(stderr));
    return m ? Number(m[1]) : null;
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Is a talking clip's own sound good enough to play in a voiceover reel?
// Whisper's confidence over the speech (avg_logprob; ≈ −0.2 clear, below −0.6
// mumbled / noisy / far away), how much of it it thought was not speech, and
// how loud it is. Poor sound never replaces the voiceover.
function speechQualityOf({ segments = [], words = [], loudness = null }) {
  const spoken = segments.filter((x) => x.end > x.start && x.conf != null);
  if (words.length < 6 || !spoken.length) return { quality: 'poor', note: 'too little speech' };
  const len = spoken.reduce((n, x) => n + (x.end - x.start), 0) || 1;
  const conf = spoken.reduce((n, x) => n + x.conf * (x.end - x.start), 0) / len;
  const noSpeech = spoken.reduce((n, x) => n + (x.noSpeech || 0) * (x.end - x.start), 0) / len;
  const why = [];
  if (conf < -0.6) why.push('hard to make out');
  if (noSpeech > 0.35) why.push('much of it is not clear speech');
  if (loudness != null && loudness < -34) why.push('too quiet / far from the mic');
  const note = `clarity ${conf.toFixed(2)}, ${loudness != null ? `${loudness.toFixed(0)} LUFS` : 'loudness unknown'}`;
  return why.length ? { quality: 'poor', note: `${why.join('; ')} (${note})` } : { quality: 'good', note };
}

// The words of a clip with their times — so the director can cut on sentences
// and original-audio captions stay in sync. Memoised per key.
const clipWordsCache = new Map();
async function clipWords(key) {
  if (clipWordsCache.has(key)) return clipWordsCache.get(key);
  const p = (async () => {
    const mp3 = await audioOfKey(key);
    const [w, loudness] = await Promise.all([whisperWords(mp3, { segments: true }), loudnessOf(mp3).catch(() => null)]);
    return { ...w, loudness };
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
  // what the studio recorded in the recording guide (ReelPlanner): which story
  // sequence a take belongs to, and whether it is them talking or B-roll
  const takeOf = new Map((reel.takes || []).filter((t) => t?.key).map((t) => [t.key, t]));
  const pushAsset = (a, pool) => {
    if (!a.key || assets.length >= MAX_ASSETS || assets.some((x) => x.key === a.key)) return;
    const an = a.analysis || {};
    const take = takeOf.get(a.key);
    const extra = {
      ...(pool ? { pool } : {}),
      ...(take ? { take: { sequence: Number(take.sequence) + 1, role: take.role === 'broll' ? 'broll' : 'speaking' } } : {}),
    };
    if (a.type === 'image') {
      assets.push({
        id: `A${assets.length + 1}`, kind: 'image', key: a.key,
        summary: str(an.summary, 200), description: str(an.description, 400),
        subjects: (an.subjects || []).map((s) => (typeof s === 'string' ? s : s?.name)).filter(Boolean).slice(0, 8),
        // where each subject is (% of the image) — anchors for animated overlays
        subjectBoxes: (an.subjects || []).filter((s) => s && s.name && s.box)
          .map((s) => ({ name: String(s.name), box: s.box, point: s.point || { x: s.box.x + s.box.w / 2, y: s.box.y + s.box.h / 2 } }))
          .slice(0, 8),
        text: str(an.text, 160),
        ...extra,
      });
    } else if (a.type === 'video' && num(an.durationSec) > 0.5) {
      assets.push({
        id: `A${assets.length + 1}`, kind: 'video', key: a.key,
        durationSec: num(an.durationSec),
        summary: str(an.summary, 200), description: str(an.description, 500),
        transcript: str(an.transcript, 1500),
        stills: (an.frames || []).filter((f) => f?.key).map((f) => ({ key: f.key, t: num(f.t), summary: str(f.summary, 160) })),
        ...extra,
      });
    }
  };
  for (const c of captures) {
    // a spoken take recorded for an earlier reel is not this reel's footage
    for (const a of c.attachments || []) if (a.reelTake !== 'say' || takeOf.has(a.key)) pushAsset(a, '');
  }
  // a recommended post's B-roll pool: the idea's suggested photos/clips and its
  // source captures' media (other captures of the same studio), after the capture's own
  const libKeys = (reel.brollKeys || []).filter(Boolean);
  if (libKeys.length && assets.length < MAX_ASSETS) {
    const others = await Project.find({ user: reel.user, 'captures.attachments.key': { $in: libKeys } })
      .select('captures.attachments').lean().catch(() => []);
    const byKey = new Map();
    others.forEach((p) => (p.captures || []).forEach((c) => (c.attachments || []).forEach((a) => {
      if (libKeys.includes(a.key)) byKey.set(a.key, a);
    })));
    libKeys.forEach((k) => { if (byKey.get(k)?.analysis?.status === 'done' || byKey.get(k)?.type === 'image') pushAsset(byKey.get(k), 'library'); });
  }
  // a photo or clip whose upload never finished is on the capture but not in S3:
  // it would fail every try with NoSuchKey (2026-11-26) — leave it out
  const listed = assets.length;
  const present = await Promise.all(assets.map((a) => headObject(a.key).then(Boolean).catch(() => true)));
  const missing = assets.filter((_, i) => !present[i]);
  if (missing.length) {
    console.warn(`[captureReel] ${reel._id} skipping ${missing.length} file(s) never uploaded:`, missing.map((a) => a.key).join(', '));
    const kept = assets.filter((_, i) => present[i]);
    assets.length = 0;
    kept.forEach((a, i) => assets.push({ ...a, id: `A${i + 1}` }));
  }
  // a motion graphics reel needs no pictures: it is drawn from the capture's words
  const graphicsOnly = reel.storyPlan?.format === 'motion_graphics' || reel.graphicsOk;
  if (!assets.length && !graphicsOnly) {
    throw userError(listed
      ? "This capture's photos didn't finish uploading, so there is nothing to cut a reel from. Add them to the capture again."
      : 'This capture has no photos or clips to cut a reel from. Add some first.');
  }

  // timed transcripts for clips that have speech (≤4)
  // a recommended post's spoken takes are the reel's A-roll: transcribe them all
  const talking = assets.filter((a) => a.kind === 'video' && (a.take?.role === 'speaking' || a.transcript.split(/\s+/).length >= 6))
    .slice(0, reel.storyPlan ? 10 : 4);
  await Promise.all(talking.map(async (a) => {
    try {
      const cached = clipWordsCache.has(a.key);
      const t0 = Date.now();
      const w = await clipWords(a.key);
      a.words = w.words;
      a.segments = w.segments;
      a.speech = speechQualityOf(w);
      if (!cached) {
        ledger?.add({
          source: 'Capture reel — clip transcript (timed)', model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1',
          elapsedMs: Date.now() - t0, output: str(w.segments.map((x) => x.text).join(' '), 1200),
          costUsd: mins(w.duration || a.durationSec) * WHISPER_USD_PER_MIN, note: `${a.id} · ${Math.round(w.duration || a.durationSec)}s of audio · on-camera sound ${a.speech.quality} — ${a.speech.note}`,
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
        // voiceover reels: "clip" = this talking clip plays its own sound (the voiceover pauses)
        sound: { type: 'string', enum: ['voiceover', 'clip'] },
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
      ...(a.segments?.length ? { timedTranscript: a.segments.map(({ start, end, text }) => ({ start, end, text })) } : (a.transcript ? { transcript: a.transcript } : {})),
      // whether this clip's own sound may play in a voiceover reel (scene sound "clip")
      ...(a.speech ? { onCameraSound: a.speech.quality } : {}),
    }));
}

const wordsIn = (s) => String(s || '').split(/\s+/).filter(Boolean);

// A voiceover reel's on-camera moment: allowed only on a talking clip whose own
// sound passed speechQualityOf, and only around words actually said in the
// window asked for — widened to whole sentences (Whisper segments), at most 12 s.
const CLIP_MAX_SEC = 12;
function onCameraCut(a, startSec, durationSec) {
  if (a?.kind !== 'video' || a.speech?.quality !== 'good' || !a.words?.length) return null;
  const from = Math.max(0, startSec);
  const to = Math.min(a.durationSec, from + Math.max(1, durationSec));
  const inWin = a.words.filter((w) => w.end > from + 0.05 && w.start < to - 0.05);
  if (inWin.length < 3) return null;
  // whole sentences: start at the segment the first word is in, end at the one the last word is in
  const segOf = (t) => (a.segments || []).find((x) => t >= x.start - 0.05 && t <= x.end + 0.05);
  let s0 = segOf(inWin[0].start)?.start ?? inWin[0].start;
  let s1 = segOf(inWin[inWin.length - 1].end)?.end ?? inWin[inWin.length - 1].end;
  if (s1 - s0 > CLIP_MAX_SEC) s1 = (inWin.filter((w) => w.end <= s0 + CLIP_MAX_SEC).pop() || inWin[0]).end;
  // land on word edges, a breath either side, inside the clip
  const first = a.words.find((w) => w.end > s0 + 0.02) || inWin[0];
  const last = [...a.words].reverse().find((w) => w.start < s1 - 0.02) || inWin[inWin.length - 1];
  s0 = Math.max(0, first.start - 0.15);
  s1 = Math.min(a.durationSec, last.end + 0.3);
  if (s1 - s0 < 1) return null;
  return { startSec: Math.round(s0 * 100) / 100, durationSec: Math.round((s1 - s0) * 100) / 100 };
}

// Lip-flap: someone talking on mute while a different voice narrates is the tell of an amateur cut.
// A voiceover scene on a stretch of a clip where they speak moves to a silent stretch of the same clip
// (between sentences, before or after they talk) — or, with none long enough, to the least-used other
// shot that has no one talking (never the one either side of it).
function noLipFlap(scenes, byId, assets) {
  const speaking = (a, s0, s1) => (a.words || []).reduce((n, w) => n + Math.max(0, Math.min(s1, w.end) - Math.max(s0, w.start)), 0);
  const used = new Map();
  scenes.forEach((x) => used.set(x.assetId, (used.get(x.assetId) || 0) + 1));
  scenes.forEach((x, i) => {
    if (x.card || x.sound === 'clip') return;
    const a = byId.get(x.assetId);
    if (a?.kind !== 'video' || !a.words?.length) return;
    if (speaking(a, x.startSec, x.startSec + x.durationSec) < 0.4) return;
    // silent stretches: the gaps between words (and before the first / after the last)
    // in a voiceover the shot lasts as long as its line takes to say (~2.6 words a second)
    const need = Math.max(x.durationSec, wordsIn(x.voiceLine).length / 2.6) + 0.2;
    const edges = [0, ...a.words.flatMap((w) => [w.start, w.end]), a.durationSec];
    let best = null;
    for (let k = 0; k + 1 < edges.length; k += 2) {
      const g0 = edges[k] + 0.1;
      const g1 = edges[k + 1] - 0.1;
      if (g1 - g0 >= need && (!best || g1 - g0 > best[1] - best[0])) best = [g0, g1];
    }
    if (best) {
      x.startSec = Math.round(best[0] * 100) / 100;
      return;
    }
    const near = new Set([scenes[i - 1]?.assetId, scenes[i + 1]?.assetId]);
    const spare = assets
      .filter((b) => b.id !== a.id && !near.has(b.id) && !(b.kind === 'video' && b.words?.length > 2))
      .sort((b, c) => (used.get(b.id) || 0) - (used.get(c.id) || 0))[0]
      || assets.filter((b) => b.id !== a.id && !(b.kind === 'video' && b.words?.length > 2))
        .sort((b, c) => (used.get(b.id) || 0) - (used.get(c.id) || 0))[0];
    if (!spare) return;
    used.set(a.id, used.get(a.id) - 1);
    used.set(spare.id, (used.get(spare.id) || 0) + 1);
    Object.assign(x, { assetId: spare.id, startSec: 0, motion: spare.kind === 'image' ? (x.motion === 'none' ? 'push-in' : x.motion) : 'none' });
  });
}

// The editor's pass over the director's cut (default look). What a seasoned Reel editor does without
// thinking: transitions are punctuation (≤ ~1 join in 4, never two in a row, one flash at most, none on
// the opening shot); talking heads are cut straight in and out; slides read cheap (→ whip); and the camera
// keeps one direction of travel across a cut — no pan answered by the opposite pan, no push-in repeated
// on the next still, a whip continuing the way the previous shot was already moving.
function editorPass(scenes, byId, assets = []) {
  const isStill = (x) => !x.card && byId.get(x.assetId)?.kind === 'image';
  const talks = (x) => x.sound === 'clip';
  noLipFlap(scenes, byId, assets);
  let sinceFancy = 9;
  let flashes = 0;
  scenes.forEach((x, i) => {
    const prev = scenes[i - 1];
    if (x.transition === 'slide') x.transition = 'whip';
    if (x.transition === 'flash' && ++flashes > 1) x.transition = 'zoom';
    const fancy = x.transition !== 'cut';
    // same subject on both sides: a straight (jump) cut — a dissolve or whip between two takes of one shot reads as a mistake
    const same = prev && prev.assetId === x.assetId;
    if (i === 0 || talks(x) || (prev && talks(prev)) || same || (fancy && sinceFancy < 3)) x.transition = 'cut';
    sinceFancy = x.transition === 'cut' ? sinceFancy + 1 : 0;
    // camera continuity between two stills
    if (prev && isStill(x) && isStill(prev)) {
      const opposite = { 'pan-left': 'pan-right', 'pan-right': 'pan-left', 'push-in': 'pull-out', 'pull-out': 'push-in' };
      if (x.motion === prev.motion && x.motion !== 'none' && x.transition === 'cut') x.motion = opposite[x.motion] || 'push-in';
      else if ((x.motion === 'pan-left' && prev.motion === 'pan-right') || (x.motion === 'pan-right' && prev.motion === 'pan-left')) x.motion = 'push-in';
      // a whip carries the previous pan's direction on (it enters from the right: the world moves left)
      if (x.transition === 'whip' && prev.motion === 'pan-right') prev.motion = 'pan-left';
    }
  });
}

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
    // an on-camera moment: the clip's own sound, cut to whole spoken words
    if (s.sound === 'clip' && !style) {
      const own = onCameraCut(a, num(s.startSec), num(s.durationSec, 4));
      if (own) {
        return {
          assetId: a.id, sound: 'clip', startSec: own.startSec, durationSec: own.durationSec, voiceLine: '',
          kicker: wordsIn(str(s.kicker, 28)).slice(0, 4).join(' '), overlayText: '',
          motion: 'none', transition: TRANSITIONS.includes(s.transition) ? s.transition : 'cut',
          focusX: Math.round(clampN(num(s.focusX, 50), 0, 100)), focusY: Math.round(clampN(num(s.focusY, 40), 0, 100)),
        };
      }
    }
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
      sound: 'voiceover',
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
  // on-camera moments live inside a voiceover reel only (original mode plays every clip's sound anyway)
  if (audioMode !== 'voiceover') scenes.forEach((x) => { if (x.sound === 'clip') x.sound = 'voiceover'; });
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

  if (!style) editorPass(scenes, byId, assets);

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

async function directReel({ material, handle, brand, direction, style = null, extraRules = '' }) {
  const split = splitPromptTemplate(loadPrompt());
  // a chosen reel style adds its rules to the system prompt and its spec to the data
  let system = style ? `${split.system}\n\n${fs.readFileSync(STYLE_RULES_FILE, 'utf8')}` : split.system;
  if (extraRules) system = `${system}\n\n${extraRules}`;
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

// Capture › Reel › Include voiceover: the studio's own recordings (one take per
// script part, in part order — the last take of a part wins) joined into one
// voice track, levelled, then timed word by word like the TTS voice.
async function studioVoiceOf(reel) {
  const takes = Array.isArray(reel.voiceover?.takes) ? reel.voiceover.takes : [];
  if (!takes.length) return null;
  const byPart = new Map();
  takes.forEach((t) => { if (t?.key) byPart.set(Number(t.part) || 0, t.key); });
  const keys = [...byPart.entries()].sort((a, b) => a[0] - b[0]).map(([, k]) => k);
  const t0 = Date.now();
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'capreel-vo-'));
  try {
    const inputs = [];
    for (let i = 0; i < keys.length; i += 1) {
      const { buffer } = await getObjectBytes(keys[i]);
      const src = path.join(dir, `take-${i}`);
      await fs.promises.writeFile(src, buffer);
      inputs.push(src);
    }
    const out = path.join(dir, 'voice.mp3');
    // each take trimmed of leading/trailing silence, a short breath between parts, one level for the whole track
    const chains = inputs.map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,apad=pad_dur=0.25[a${i}]`);
    const filter = `${chains.join(';')};${inputs.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5[v]`;
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      ...inputs.flatMap((f) => ['-i', f]),
      '-filter_complex', filter, '-map', '[v]', '-ac', '1', '-ar', '44100', '-b:a', '128k', out], { timeout: 180000 });
    const mp3 = await fs.promises.readFile(out);
    const joinMs = Date.now() - t0;
    const timed = await whisperWords(mp3);
    const words = timed.words || [];
    const duration = timed.duration || (words.length ? words[words.length - 1].end : 0);
    const script = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
    return { mp3, words, duration, script, chars: script.length, ttsMs: joinMs, whisperMs: Date.now() - t0 - joinMs, parts: keys.length };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
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
// A reel style's colour grade, applied ONCE to the photo here instead of as a
// CSS filter Chrome re-applies on every frame (~20% of a frame's render cost
// in software GL). Matches reelLook GRADE: warm = sepia .12 · saturate 1.08 ·
// contrast 1.03; bright; cool.
const SEPIA = [[0.393, 0.769, 0.189], [0.349, 0.686, 0.168], [0.272, 0.534, 0.131]];
function gradeImage(img, grade) {
  const contrast = (img2, c) => img2.linear(c, 128 * (1 - c));
  if (grade === 'warm') {
    const a = 0.12;
    const m = SEPIA.map((row, i) => row.map((v, j) => v * a + (i === j ? 1 - a : 0)));
    return contrast(img.recomb(m).modulate({ saturation: 1.08 }), 1.03);
  }
  if (grade === 'bright') return contrast(img.modulate({ brightness: 1.06, saturation: 1.04 }), 1.04);
  if (grade === 'cool') return contrast(img.modulate({ hue: -6, saturation: 0.95 }), 1.02);
  if (grade === 'clean') return contrast(img.modulate({ brightness: 1.05, saturation: 0.94 }), 1.03);
  if (grade === 'moody') return contrast(img.modulate({ brightness: 0.9, saturation: 0.88 }), 1.1);
  return img;
}

async function imageSrc(key, grade = '') {
  const g = ['warm', 'bright', 'cool', 'clean', 'moody'].includes(grade) ? grade : '';
  // `.reelhd`: sized to COVER the 1080×1920 frame with room for a push-in (was 'inside' 1440×2560, which
  // left a landscape photo 1080 px tall — stretched ~1.8× to fill the frame: soft reels, 2026-11-24)
  const out = `${key.replace(/\.[^./]+$/, '')}.reelhd${g ? `.${g}` : ''}.jpg`;
  const have = await headObject(out).catch(() => null);
  if (!have) {
    const legacy = `${key.replace(/\.[^./]+$/, '')}.reel${g ? `.${g}` : ''}.jpg`;
    const src = await getObjectBytes(key).catch(async (err) => {
      // the original is gone but an earlier (smaller) copy was made: use that rather than fail the reel
      if (await headObject(legacy).catch(() => null)) return null;
      throw err;
    });
    if (!src) return getMediaUrl(legacy);
    const { buffer, contentType } = src;
    const vis = await toVisionImage(buffer, contentType, key);
    const img = sharp(vis.buffer).rotate()
      .resize(1134, 2016, { fit: 'outside', withoutEnlargement: true }); // cover + 5 % for the push-in, no bigger (render cost)
    const jpg = await gradeImage(img, g).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    sharp(jpg).metadata().then((m) => { if (m.width && m.height) imageSizes.set(key, { w: m.width, h: m.height }); }).catch(() => {});
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

// ── orientation (studio, 2026-11-24: "don't convert landscape footage to portrait, or the reverse") ──
// A photo's size as the reel shows it (rotation applied), from the reel copy imageSrc made.
const imageSizes = new Map();
async function imageSizeOf(key) {
  if (imageSizes.has(key)) return imageSizes.get(key);
  try {
    const url = await imageSrc(key, 'clean');
    if (imageSizes.has(key)) return imageSizes.get(key);
    const out = decodeURIComponent(String(url).split('?')[0].split('/').slice(3).join('/'));
    const { buffer } = await getObjectBytes(out);
    const m = await sharp(buffer).metadata();
    const size = m.width && m.height ? { w: m.width, h: m.height } : null;
    imageSizes.set(key, size);
    return size;
  } catch {
    imageSizes.set(key, null);
    return null;
  }
}

// A soft backdrop for a landscape shot shown whole in the 9:16 frame: the same picture, small, heavily
// blurred and darkened — rendered once as a still (a live CSS blur on video is far too slow in SwiftShader).
async function backdropOf(key, kind, atSec = 0) {
  const t = kind === 'video' ? Math.max(0, Math.round(atSec / 4) * 4) : 0; // one per 4 s of a clip
  const out = `${key.replace(/\.[^./]+$/, '')}.bd${kind === 'video' ? `-${t}` : ''}.jpg`;
  if (await headObject(out).catch(() => null)) return getMediaUrl(out);
  let frameBuf;
  if (kind === 'video') {
    const file = await clipFile(key);
    const { stdout } = await run(ffmpegPath(), ['-nostdin', '-v', 'error', '-ss', String(t + 0.5), '-i', file,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'], { encoding: 'buffer', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    frameBuf = stdout;
  } else {
    const { buffer, contentType } = await getObjectBytes(key);
    frameBuf = (await toVisionImage(buffer, contentType, key)).buffer;
  }
  const jpg = await sharp(frameBuf).rotate().resize(216, 384, { fit: 'cover' }).blur(14)
    .modulate({ brightness: 0.55, saturation: 0.85 }).jpeg({ quality: 72 }).toBuffer();
  await uploadBytes(out, jpg, 'image/jpeg', { immutable: true });
  return getMediaUrl(out);
}

// a clip's DISPLAY size (rotation applied) — how much the frame may punch in before it upscales
const videoSizeCache = new Map();
async function videoSizeOf(key) {
  if (!videoSizeCache.has(key)) {
    videoSizeCache.set(key, (async () => {
      const file = await clipFile(key);
      const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', '-i', file], { timeout: 30000 }).catch((e) => ({ stderr: String(e.stderr || '') }));
      const m = /Video: [^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr);
      if (!m) return null;
      let [w, h] = [Number(m[1]), Number(m[2])];
      if (/rotation of -?90|rotate\s*:\s*-?(90|270)/i.test(stderr)) [w, h] = [h, w];
      return { w, h };
    })().catch(() => null));
  }
  return videoSizeCache.get(key);
}

async function letterboxOf(key, startSec, durSec) {
  try {
    const file = await clipFile(key);
    const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', '-ss', String(startSec), '-t', String(Math.max(0.5, durSec)),
      '-i', file, '-an', '-vf', 'cropdetect=limit=40:round=2:reset=1:skip=0', '-f', 'null', '-'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const crops = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].map((m) => m.slice(1).map(Number));
    // cropdetect measures the picture AFTER rotation (a phone clip stored 1920×1080 + "rotate 90" is a
    // 1080×1920 picture) — so the frame is the display size, never the coded one. Reading the coded size
    // made every rotated phone clip look like a narrow letterboxed box and zoomed it ~1.8× (2026-11-26).
    const size = await videoSizeOf(key);
    if (!size || !crops.length) return null;
    const [W, H] = [size.w, size.h];
    if (crops.some((c) => c[0] > W + 2 || c[1] > H + 2)) return null; // sizes disagree: never guess a zoom
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
    if (box.x < 0 || box.y < 0 || box.x + box.w > 1.001 || box.y + box.h > 1.001) return null;
    return Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  } catch (err) {
    console.warn('[captureReel] letterbox check failed', key, err.message);
    return null;
  }
}

// The still of a clip nearest a time — used when the clip is too short to fill
// its shot, and for the end card's backdrop.
const stillNear = (asset, t) => asset.stills.slice().sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0] || null;

/* the studio's own words about a capture — what the explainer agent may draw from */
function storyText(capture) {
  const notes = (capture?.notes || []).map((n) => [n.note, n.summary, ...Object.values(n.understanding || {}).flat()].filter(Boolean).join(' '));
  const said = (capture?.conversation || []).filter((t) => t.role === 'user').map((t) => t.text);
  return [...notes, ...said].join('\n').slice(0, 6000);
}

/* drawings: { overlay: [{ fromSec, toSec, spec }] — over a voiced cut, timed to its words;
               inserts: [{ afterShot, durationSec, spec }] — cut into a music-led cut as their own card } */
// ── Punch-ins ────────────────────────────────────────────────────────────────
// A long hold is where a Reel loses people. An editor cuts in on the same shot — a hard step to a tighter
// framing and back — on a word onset, ideally after a small pause, every ~2.5 s. On a talking head it is the
// classic jump-zoom; on a still under narration it reads as a second angle. Not in the first or last second
// of a shot (too close to a cut), not on a drawing card or the end card.
const PUNCH_EVERY = 2.5;
function addPunchIns(scenes, words, endFrame) {
  scenes.forEach((x) => {
    if (x.explainer || x.kind === 'card' || x.frame || x.from >= endFrame) return; // a framed (landscape) shot holds its composition
    const talking = x.volume > 0;
    const sec = x.durationInFrames / FPS;
    if (sec < (talking ? 4.5 : 3.4)) return;
    const lo = x.from + FPS * 1.1;
    const hi = x.from + x.durationInFrames - FPS * 1.0;
    // onsets inside the shot, the ones after a breath first
    const onsets = words
      .map((w, i) => ({ f: frames(w.start), gap: i ? w.start - words[i - 1].end : 1 }))
      .filter((o) => o.f >= lo && o.f <= hi);
    if (!onsets.length) return;
    const want = Math.max(1, Math.floor(sec / PUNCH_EVERY) - (talking ? 0 : 1));
    const picks = [];
    for (let k = 1; k <= want; k += 1) {
      const target = x.from + (x.durationInFrames * k) / (want + 1);
      const best = onsets
        .filter((o) => picks.every((pf) => Math.abs(pf - o.f) > FPS * 1.4))
        .sort((a, b) => (Math.abs(a.f - target) - (a.gap > 0.2 ? FPS * 0.6 : 0)) - (Math.abs(b.f - target) - (b.gap > 0.2 ? FPS * 0.6 : 0)))[0];
      if (best) picks.push(best.f);
    }
    if (picks.length) x.punches = picks.sort((a, b) => a - b).map((f) => f - x.from);
  });
}

// ── Voiceover with on-camera moments ─────────────────────────────────────────
const J_CUT = 0.2; // s the speaker is heard before seen
const L_CUT = 0.3; // s the next picture comes up under the speaker's last words
// Scenes with sound "clip" play the talking clip's own audio; the voiceover is
// cut into runs (the stretches between them) and each run plays its slice of
// the voice track. Within a run the shots are timed to the voice words as in a
// plain voiceover reel; a clip scene holds the sentences the director picked.
// Voice time → reel time is `src + off` for the run that holds it.
function mixedVoiceShots(plan, voice, byId, captionWords) {
  const W = voice.words.length;
  const voiced = plan.scenes.filter((x) => x.sound !== 'clip');
  const counts = voiced.map((x) => wordsIn(x.voiceLine).length);
  const S = counts.reduce((a, b) => a + b, 0) || 1;
  // each voiced scene's words in the track, by its share of the script
  let cum = 0;
  const range = new Map();
  voiced.forEach((x, i) => {
    const a = Math.round((cum * W) / S);
    cum += counts[i];
    range.set(x, [a, Math.max(a, Math.round((cum * W) / S))]);
  });
  const shots = [];
  const runs = [];
  let t = 0;
  let run = null;
  const closeRun = (last) => {
    if (!run) return;
    const B = run.b;
    // the run ends after its last word (a breath), never into the next run's first word
    run.srcEnd = B >= W ? voice.duration + 0.05 : Math.max(run.srcStart + 0.3, Math.min(voice.words[B].start - 0.06, voice.words[B - 1].end + 0.3));
    runs.push(run);
    t = run.srcEnd + run.off;
    // the run's last shot holds until the voice stops
    if (last) last.dur = Math.max(0.5, t - last.start);
    run = null;
  };
  let lastVoiced = null;
  let afterClip = false;
  plan.scenes.forEach((sc) => {
    if (sc.sound === 'clip') {
      closeRun(lastVoiced);
      lastVoiced = null;
      const start = t;
      // J-cut: their voice starts a beat before we see them (the previous shot holds over their breath in,
      // and runs a few frames on underneath so no black frame can show at the reveal)
      const j = shots.length && sc.startSec >= J_CUT ? J_CUT : 0;
      if (shots.length) shots[shots.length - 1].dur += 0.12;
      shots.push({ scene: j ? { ...sc, startSec: Math.round((sc.startSec - j) * 100) / 100 } : sc, start: start - j, dur: sc.durationSec + j, volume: 1, revealSec: j });
      afterClip = true;
      const a = byId.get(sc.assetId);
      (a?.words || [])
        .filter((w) => w.start >= sc.startSec - 0.05 && w.end <= sc.startSec + sc.durationSec + 0.05)
        .forEach((w) => captionWords.push({ text: w.text, start: start + (w.start - sc.startSec), end: start + (w.end - sc.startSec) }));
      t = start + sc.durationSec;
      return;
    }
    const [a, b] = range.get(sc);
    afterClip = afterClip && !run;
    if (!run) {
      // the voice (re)starts: the first run after a short lead, a later one a breath after the clip
      const srcStart = a === 0 ? 0 : Math.max(runs.length ? runs[runs.length - 1].srcEnd : 0, (voice.words[a]?.start ?? 0) - 0.12);
      const lead = runs.length || shots.length ? 0.2 : VOICE_LEAD;
      run = { a, b, srcStart, off: t + lead - srcStart };
      // L-cut: after someone on camera, the next picture comes up under their last words
      const start = shots.length ? Math.max(shots[shots.length - 1].start + 1, t - (afterClip ? L_CUT : 0)) : 0;
      shots.push({ scene: sc, start, dur: Math.max(0.5, t - start + 0.5), volume: 0 });
    } else {
      run.b = b;
      const at = Math.max(lastVoiced.start + 0.6, (voice.words[Math.min(W - 1, a)]?.start ?? 0) + run.off - 0.08);
      lastVoiced.dur = Math.max(0.5, at - lastVoiced.start);
      shots.push({ scene: sc, start: at, dur: 0.5, volume: 0 });
    }
    run.b = b;
    lastVoiced = shots[shots.length - 1];
  });
  closeRun(lastVoiced);
  if (lastVoiced) lastVoiced.dur += 0.2;
  // captions: the voice words where they now sound
  runs.forEach((r) => voice.words.forEach((w) => {
    if (w.start >= r.srcStart - 0.01 && w.end <= r.srcEnd + 0.05) captionWords.push({ text: w.text, start: w.start + r.off, end: w.end + r.off });
  }));
  captionWords.sort((x, y) => x.start - y.start);
  const last = shots[shots.length - 1];
  return { shots, voiceRuns: runs, voEnd: last ? last.start + last.dur : t };
}

// a span the explainer agent placed on the continuous voice (seconds incl. VOICE_LEAD) → where it now
// sounds, cut to the run it starts in (a drawing never hangs over an on-camera moment)
function voiceSpanToReel(runs, x) {
  const s0 = x.fromSec - VOICE_LEAD;
  const s1 = x.toSec - VOICE_LEAD;
  const r = runs.find((q) => s0 >= q.srcStart - 0.05 && s0 < q.srcEnd);
  if (!r) return null;
  const to = Math.min(s1, r.srcEnd);
  if (to - s0 < 0.8) return null;
  return { ...x, fromSec: s0 + r.off, toSec: to + r.off };
}

// The Brand Kit's type roles as the renderer loads them (remotion/src/brandFonts.ts): a stylesheet
// (Google / Fontshare) or the uploaded file — same as a talking reel (reelFormatDirector)
async function reelFontsOf(f) {
  if (!f) return null;
  const out = {};
  for (const role of ['heading', 'body', 'detail']) {
    const v = f[role];
    if (!v?.family) continue;
    // eslint-disable-next-line no-await-in-loop
    const url = v.fileKey ? await getMediaUrl(v.fileKey).catch(() => '') : '';
    out[role] = { family: v.family, stack: v.stack || `'${v.family}', sans-serif`, ...(v.stylesheet ? { css: v.stylesheet } : {}), ...(url ? { url } : {}) };
  }
  return Object.keys(out).length ? out : null;
}

// Voiceover / photo reels get the talking reel's captions (2026-11-26, "captions look bad"): the caption
// agent groups the words by meaning and picks one key word (Brand Kit heading face, brand colour), then
// the photo behind every caption is measured for ink / soft shadow / brand-colour fit. Every scene here
// is a photo or clip (no speaker), so captions sit in the lower third (TwoVoiceCaptions 74 %).
async function twoVoiceCaptions({ words, scenes, plan, voice, brand, onDebug, reelId }) {
  const design = require('./reelDesignAgents');
  const palette = Object.fromEntries(Object.entries({ accent: brand.accent, fg: brand.fg, ground: brand.ground })
    .filter(([, v]) => /^#[0-9a-f]{6}$/i.test(String(v || ''))));
  const sceneOf = (f) => scenes.filter((x) => f >= x.from && f < x.from + x.durationInFrames).pop() || null;
  const indexed = words.map((w, i) => {
    const sc = sceneOf(frames(w.start));
    return { ...w, i, on: sc?.explainer || sc?.kind === 'card' ? 'card' : 'insert' };
  });
  const story = [plan.hook?.text, voice?.script || plan.scenes.map((x) => x.voiceLine).filter(Boolean).join(' ')].filter(Boolean).join(' — ');
  let out;
  try {
    out = await design.designCaptions({ words: indexed, chapters: [], story, palette: Object.keys(palette).length ? palette : null });
  } catch (err) {
    console.warn(`[captureReel] ${reelId} caption agent failed — karaoke captions:`, err.message);
    onDebug?.({ source: 'Capture reel — caption agent', output: `Skipped: ${err.message}`, note: 'karaoke captions instead' });
    return null;
  }
  if (out?.debug) onDebug?.(out.debug);
  if (!out?.cues?.length) return null;
  const captions = out.cues.map((cue, k) => {
    const ws = indexed.slice(cue.from, cue.to + 1);
    const next = out.cues[k + 1] ? indexed[out.cues[k + 1].from] : null;
    const end = Math.min(next ? next.start : Infinity, ws[ws.length - 1].end + 0.3);
    const fromFrame = frames(ws[0].start);
    return {
      fromFrame,
      toFrame: Math.max(fromFrame + 8, frames(end)),
      key: cue.key >= 0 ? cue.key - cue.from : -1,
      keyStyle: cue.keyStyle,
      pos: 'lower',
      keyColorRole: cue.key >= 0 ? cue.keyColor : 'ink',
      words: ws.map((w, j) => ({
        text: w.text.replace(/^[^\p{L}\p{N}$#@"“'‘]+|[,;:]+$/gu, ''),
        fromFrame: frames(w.start),
        toFrame: j < ws.length - 1 ? frames(ws[j + 1].start) : frames(end),
      })),
    };
  }).filter((c) => c.words.some((w) => w.text));
  const sceneAt = (f) => {
    const sc = sceneOf(f);
    if (!sc) return null;
    if (sc.explainer || sc.kind === 'card') return { card: true };
    if (sc.frame) return { framed: true }; // the words sit on the dark blurred backdrop, not the footage
    if (!sc._src) return null;
    const into = (f - sc.from) / FPS;
    return {
      key: sc._src.key, kind: sc._src.kind,
      atSec: sc._src.kind === 'video' ? (sc.sourceStartSec || 0) + into * (sc.playbackRate || 1) : 0,
      // photos drift (push-in / pull-out): measured at a middling zoom
      focusX: sc.focusX, focusY: sc.focusY, zoom: sc.kind === 'image' ? 1.06 : 1, crop: sc.crop,
    };
  };
  const contrast = await require('./reelCaptionContrast').applyCaptionContrast({
    captions, chapters: [], hook: null, sceneAt, palette,
    helpers: { clipFile, ffmpegPath },
  }).catch((err) => { console.warn(`[captureReel] ${reelId} caption contrast failed:`, err.message); return null; });
  captions.forEach((c) => { delete c.keyColorRole; });
  if (contrast) onDebug?.({ source: 'Capture reel — caption contrast (code)', output: JSON.stringify({ palette, ...contrast }) });
  return captions;
}

async function buildTimeline({ plan, material, voice, voiceUrl, brand, style = null, music = null, drawings = null, onDebug = null, reelId = '' }) {
  const byId = new Map(material.assets.map((a) => [a.id, a]));
  const look = style ? styleRun.lookOf(style) : null;
  let shots = [];
  const captionWords = [];
  let voEnd;

  let voiceRuns = null; // mixed voiceover: [{ srcStart, srcEnd, off }] — the voice track in stretches
  if (plan.audioMode === 'voiceover' && plan.scenes.some((x) => x.sound === 'clip')) {
    ({ shots, voiceRuns, voEnd } = mixedVoiceShots(plan, voice, byId, captionWords));
  } else if (plan.audioMode === 'voiceover') {
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
    // explainer drawings (Include graphics): each its own card after its shot, held a whole number of
    // beats so the cuts after it stay on the music's grid
    const ins = (drawings?.inserts || []).filter((x) => x.afterShot >= 0 && x.afterShot < shots.length - 1);
    if (ins.length) {
      const period = music?.beats?.bpm ? 60 / music.beats.bpm : 0;
      [...ins].sort((a, b) => b.afterShot - a.afterShot).forEach((x) => {
        const dur = period ? Math.ceil(x.durationSec / period) * period : x.durationSec;
        shots.splice(x.afterShot + 1, 0, { explainer: x.spec, start: 0, dur, volume: 0 });
      });
      let at = 0;
      shots.forEach((sh) => { sh.start = at; at += sh.dur; });
      t = at;
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
  const ctaSec = clampN(num(plan.cta?.durationSec, CTA_SEC), 1, 3);
  if (hasCta && endCard === 'text-on-shot' && shots.length) shots[shots.length - 1].dur += ctaSec;
  const ctaStart = endCard === 'text-on-shot' ? lastEnd : lastEnd;
  const total = hasCta ? lastEnd + ctaSec : lastEnd + 0.3;

  // every shot's media is prepared at once (S3 reads, JPEG copies, band checks)
  const scenes = await Promise.all(shots.map(async (sh) => {
    if (sh.explainer) {
      return {
        from: frames(sh.start), durationInFrames: Math.max(1, frames(sh.start + sh.dur) - frames(sh.start)),
        kind: 'card', src: '', motion: 'none', transition: 'cut', explainer: sh.explainer,
      };
    }
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
      ...(sh.revealSec ? { revealFrames: frames(sh.revealSec) } : {}),
      ...(sh.scene.overlayText ? { overlayText: sh.scene.overlayText } : {}),
      ...(sh.scene.textY != null ? { textY: sh.scene.textY } : {}),
      // teaser overlays, anchored on the photo (the renderer follows the camera)
      ...(sh.scene.annotations?.length ? {
        annotations: sh.scene.annotations.map((an) => ({ ...an, atFrame: Math.max(0, Math.round(num(an.atSec) * FPS)) })),
      } : {}),
      ...(a.width && a.height ? { srcW: a.width, srcH: a.height } : {}),
    };
    const before = sh.scene.beforeAssetId ? byId.get(sh.scene.beforeAssetId) : null;
    const still = async (key) => ({
      ...base,
      kind: 'image',
      _src: { key, kind: 'image' }, // the caption contrast measure reads the original; removed before render
      src: await imageSrc(key, look?.grade),
      // a before → after wipe: the before photo is wiped away to reveal this one
      ...(before?.kind === 'image' ? { beforeSrc: await imageSrc(before.key, look?.grade) } : {}),
      motion: base.motion === 'none' && !before ? 'push-in' : base.motion,
      ...(look && look.grade !== 'neutral' ? { graded: true } : {}),
    });
    if (a.kind !== 'video') return still(a.key);
    let start = sh.scene.startSec;
    const rate = clampN(num(sh.scene.speed, 1), 0.75, 2);
    const need = sh.dur * rate; // seconds of source a sped-up shot plays
    if (a.durationSec - start < need) start = Math.max(0, a.durationSec - need);
    if (a.durationSec - start - 0.1 >= need) {
      const [src, crop, size] = await Promise.all([getMediaUrl(a.key), letterboxOf(a.key, start, sh.dur), videoSizeOf(a.key)]);
      // landscape footage is never cropped to portrait (studio rule 2026-11-24): shown whole, full width,
      // on its own blurred backdrop — a 16:9 clip cropped to 9:16 is a ~3× zoom that throws away the shot
      const landscape = !look && size && size.w / size.h >= 1.05;
      const frame = landscape ? { aspect: Math.round((size.w / size.h) * 1000) / 1000, backdrop: await backdropOf(a.key, 'video', start).catch(() => '') } : null;
      return {
        ...base, kind: 'video', _src: { key: a.key, kind: 'video' }, src, sourceStartSec: start, volume: sh.volume,
        ...(rate !== 1 ? { playbackRate: rate } : {}), ...(crop && !frame ? { crop } : {}),
        ...(size ? { srcW: size.w, srcH: size.h } : {}),
        ...(frame ? { frame, motion: 'none' } : {}),
      };
    }
    // too short for the line said over it: hold its closest still instead
    const near = stillNear(a, start);
    if (near) return still(near.key);
    return { ...base, kind: 'video', _src: { key: a.key, kind: 'video' }, src: await getMediaUrl(a.key), sourceStartSec: 0, volume: sh.volume };
  }));

  // drawings sit at the END of the scene list, so plan.coverShotIndex still points at its shot; over a
  // voiced cut they lie on top of the footage while their words are said
  const drawn = scenes.filter((x) => x.explainer);
  for (let k = scenes.length - 1; k >= 0; k -= 1) if (scenes[k].explainer) scenes.splice(k, 1);
  (drawings?.overlay || []).forEach((raw) => {
    const x = voiceRuns ? voiceSpanToReel(voiceRuns, raw) : raw;
    if (!x || x.toSec > ctaStart - 0.1) return;
    drawn.push({
      from: frames(x.fromSec), durationInFrames: Math.max(1, frames(x.toSec) - frames(x.fromSec)),
      kind: 'card', src: '', motion: 'none', transition: 'cut', explainer: x.spec,
    });
  });
  const underDrawing = (sec) => drawn.some((x) => frames(sec) >= x.from && frames(sec) < x.from + x.durationInFrames);

  // end card backdrop: the opening shot again (a loop back to the hook)
  if (hasCta && endCard === 'card') {
    const first = byId.get(plan.scenes[0].assetId);
    const still = first.kind === 'video' ? stillNear(first, plan.scenes[0].startSec) : null;
    const key = first.kind === 'image' ? first.key : still?.key;
    const last = scenes[scenes.length - 1];
    if (key) {
      scenes.push({
        from: frames(ctaStart), durationInFrames: frames(total) - frames(ctaStart), kind: 'image',
        src: await imageSrc(key, look?.grade), motion: 'pull-out', transition: 'zoom',
        ...(look && look.grade !== 'neutral' ? { graded: true } : {}),
        focusX: plan.scenes[0].focusX, focusY: plan.scenes[0].focusY,
      });
    } else if (last) {
      last.durationInFrames = frames(total) - last.from;
    }
  }

  const hookSec = style
    ? clampN(num(style.pacing?.hookHoldSec, 1.6), 1.1, 3.2)
    : clampN(0.55 + wordsIn(plan.hook.text).length * 0.22, HOOK_MIN, HOOK_MAX);
  if (!look) addPunchIns([...scenes, ...drawn], captionWords, hasCta ? frames(ctaStart) : Infinity);

  // captions: the talking-reel caption agent when the default look carries them (no reel style — a
  // style keeps its own caption look); the karaoke chunks only when the agent fails
  const spokenWords = captionWords.filter((w) => w.start < ctaStart && !underDrawing(w.start));
  const twoVoice = !look && spokenWords.length >= 3 && process.env.REEL_VO_CAPTION_AGENT !== 'off'
    ? await twoVoiceCaptions({ words: spokenWords, scenes: [...scenes, ...drawn], plan, voice, brand, onDebug, reelId })
    : null;
  [...scenes, ...drawn].forEach((x) => { delete x._src; });
  const reelFonts = twoVoice ? await reelFontsOf(brand.fonts) : null;
  const accent = brand.accent || '#FFFFFF';
  const lit = liftAccent(accent);
  return {
    format: { width: WIDTH, height: HEIGHT, fps: FPS, durationInFrames: frames(total) },
    brand: {
      accent: lit,
      accentInk: luminance(lit) > 0.45 ? '#111111' : '#FFFFFF',
      headlineFont: brand.headlineFont || '',
      bodyFont: brand.bodyFont || '',
      // Brand Kit colours for the explainer drawings (remotion/src/brandPalette.ts)
      palette: { accent: brand.accent || '', fg: brand.fg || '', ground: brand.ground || '' },
      // Brand Kit typography for the two-voice captions (heading = key word, body = lead words)
      ...(reelFonts ? { fonts: reelFonts } : {}),
    },
    ...(plan.hook.text ? { hook: { text: plan.hook.text, emphasis: plan.hook.emphasis, durationInFrames: frames(hookSec) } } : {}),
    scenes: [...scenes, ...drawn],
    // captions stay off the end card, and off a drawing (its title says the idea; one text block at a time)
    captions: look?.captions === 'none' ? [] : (twoVoice || captionCues(spokenWords)),
    ...(twoVoice ? { captionStyle: 'twovoice' } : {}),
    ...(hasCta ? { cta: { line: plan.cta.line, sub: plan.cta.sub, fromFrame: frames(ctaStart), durationInFrames: frames(total) - frames(ctaStart) } } : {}),
    ...((voiceUrl || music?.url) ? {
      audio: {
        ...(voiceUrl ? { voiceoverSrc: voiceUrl, voiceVolume: 1, startFrame: frames(VOICE_LEAD) } : {}),
        // on-camera moments: the voice plays in stretches around them (remotion VoiceTrack)
        ...(voiceUrl && voiceRuns ? {
          voiceSegments: voiceRuns.map((r) => ({ fromFrame: frames(r.srcStart + r.off), trimBeforeFrames: frames(r.srcStart), durationInFrames: Math.max(1, frames(r.srcEnd) - frames(r.srcStart)) })),
        } : {}),
        ...(music?.url ? { musicSrc: music.url, musicVolume: plan.audioMode === 'music' ? 0.9 : 0.13 } : {}),
        ...(voiceRuns ? { duck: scenes.filter((x) => x.volume > 0).map((x) => ({ fromFrame: x.from, toFrame: x.from + x.durationInFrames })) } : {}),
      },
    } : {}),
    ...(look ? { look } : {}),
  };
}

// ── 5. Render ────────────────────────────────────────────────────────────────

// A render reports every 5 % (render.mjs). It is stopped when it goes quiet
// for REEL_RENDER_STALL_MS (a real hang), not on a fixed clock: a long reel on
// a small box can legitimately take a while, and killing it at a fixed time
// only made it start over. REEL_RENDER_TIMEOUT_MS is the outer limit.
const RENDER_STALL_MS = Number(process.env.REEL_RENDER_STALL_MS) || 4 * 60 * 1000;
const RENDER_TIMEOUT_MS = Number(process.env.REEL_RENDER_TIMEOUT_MS) || 45 * 60 * 1000;

function renderReel(timeline, outPath, { onProgress = null, timeoutMs = RENDER_TIMEOUT_MS, stallMs = RENDER_STALL_MS } = {}) {
  return new Promise((resolve, reject) => {
    const specPath = path.join(os.tmpdir(), `capreel-${crypto.randomUUID()}.json`);
    // sound effects (remotion/src/sfx.tsx) are on unless REEL_SFX=off
    const reel = String(process.env.REEL_SFX || '').toLowerCase() === 'off' ? { ...timeline, audio: { ...(timeline.audio || {}), sfx: false } } : timeline;
    fs.writeFileSync(specPath, JSON.stringify({ composition: 'CaptureReel', props: { reel } }));
    // its own process group, so a kill takes headless Chrome down with it
    // (killing only node leaves Chrome running, holding its memory)
    const child = spawn('node', ['render.mjs', specPath, outPath], { cwd: REMOTION_DIR, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const killAll = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    // a stop asks first (render.mjs closes Chrome on SIGTERM), then forces
    const stopRender = () => {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      setTimeout(killAll, 5000).unref?.();
    };
    let stderr = '';
    let timingLines = '';
    let why = '';
    // the watchdog: any output from the renderer counts as life
    let lastSign = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastSign > stallMs) {
        why = `no progress for ${Math.round(stallMs / 1000)}s`;
        clearInterval(watchdog);
        stopRender();
      }
    }, 15000);
    watchdog.unref?.();
    child.stderr.on('data', (d) => {
      const text = d.toString();
      lastSign = Date.now();
      if (text.includes('[render:timing]')) timingLines += text;
      const pct = [...text.matchAll(/\[render\] (\d+)%/g)].pop();
      if (pct && onProgress) { try { onProgress(Number(pct[1])); } catch { /* never stops the render */ } }
      stderr = (stderr + text).slice(-6000);
    });
    const timer = setTimeout(() => { why = `over ${Math.round(timeoutMs / 60000)} min`; stopRender(); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      clearInterval(watchdog);
      if (code !== 0) killAll(); // a crashed render can leave Chrome behind too
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
      reject(Object.assign(new Error(`Reel render failed (${why ? `stopped: ${why}` : code === null ? 'killed — out of memory' : `exit ${code}`})`), { detail: tail }));
    });
    child.on('error', (err) => { clearTimeout(timer); clearInterval(watchdog); reject(err); });
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

/* the explainer drawings for a photo reel (reelExplainerAgent.js): timed to the words over a voiced cut,
   or cut in after shots of a music-led one. Resolves { overlay | inserts, debug }. */
async function commissionDrawings({ plan, material, voice }) {
  const agent = require('./reelExplainerAgent');
  const story = storyText(material.capture);
  if (plan.audioMode === 'voiceover') {
    const words = voice.words.map((w, i) => ({ i, text: w.text, start: w.start + VOICE_LEAD, end: w.end + VOICE_LEAD, on: 'photo' }));
    const hookEndSec = clampN(0.55 + wordsIn(plan.hook?.text).length * 0.22, HOOK_MIN, HOOK_MAX);
    const got = await agent.designExplainers({ words, story, hookEndSec });
    return { overlay: got.explainers, debug: got.debug };
  }
  const byId = new Map(material.assets.map((a) => [a.id, a]));
  const shots = plan.scenes.map((sc, i) => {
    const a = byId.get(sc.assetId);
    return { i, text: [sc.overlayText, sc.kicker].filter(Boolean).join(' · '), shows: a ? (a.summary || a.description || '') : '' };
  });
  const got = await agent.designTeaserExplainers({ story, shots });
  return { inserts: got.explainers, debug: got.debug };
}

async function runCaptureReel(reelId) {
  const reel = await CaptureReel.findById(reelId);
  if (!reel || reel.status === 'done') return;
  if (!isS3Configured()) {
    await CaptureReel.updateOne({ _id: reelId }, { $set: { status: 'error', error: 'Storage is not configured, so a reel cannot be rendered here.' } });
    return;
  }
  const memMb = memoryLimitMb();
  if (memMb < REEL_MIN_MEMORY_MB) {
    const msg = 'Reels can\'t be rendered on this server yet — it doesn\'t have enough memory. Nothing was charged.';
    console.error(`[captureReel] ${reel._id} refused: ${memMb} MB available, rendering needs ≥ ${REEL_MIN_MEMORY_MB} MB (REEL_RENDER_MIN_MEMORY_MB)`);
    await CaptureReel.updateOne({ _id: reel._id }, {
      $set: { status: 'error', stage: 'queued', error: msg, errorDetail: `memory limit ${memMb} MB < ${REEL_MIN_MEMORY_MB} MB needed to render`, finishedAt: new Date() },
    });
    return;
  }
  // the studio's browser is rendering this one (services/browserReelRender.js):
  // leave it while it reports, take over when it goes quiet
  const browser = require('./browserReelRender');
  if (await browser.deferToBrowser(reel)) return;
  const counted = await CaptureReel.findOneAndUpdate({ _id: reel._id }, { $inc: { attempts: 1 } }, { new: true }).select('attempts').lean();
  const attempt = counted?.attempts || 1;
  if (attempt > MAX_ATTEMPTS + 1) {
    // a worker kept dying on this reel — stop, so it can't loop
    await CaptureReel.updateOne({ _id: reel._id }, {
      $set: { status: 'error', error: 'This reel could not be made after several tries. Try again.', errorDetail: `gave up after ${attempt - 1} attempts`, finishedAt: new Date() },
    });
    return;
  }
  // the cut was already made (and paid for) on an earlier try: render it again
  // (or the browser rendered it / gave it back — the cut is made either way)
  const handedBack = ['uploaded', 'abandoned'].includes(reel.browserRender?.state);
  const resumed = (attempt > 1 || handedBack) && Boolean(reel.previewAt && reel.timeline && reel.plan && !reel.videoKey);
  let handedOff = false; // the browser took the render: this run stops quietly
  const started = Date.now();
  const tmp = path.join(os.tmpdir(), `capreel-${reel._id}.mp4`);
  const ledger = costLedger();
  let model = '';
  let plan;
  let timeline;
  let voiceKey = '';
  let musicKeySaved = '';
  let dialogueBuild = null; // talking formats build their own timeline (reelFormatDirector)
  let retryErr = null;
  const clock = stageClock();
  clock.to('reading');
  try {
    await CaptureReel.updateOne({ _id: reel._id }, { $set: { status: 'working', stage: resumed ? 'rendering' : 'reading', startedAt: new Date(), error: '', renderPct: 0 } });
    if (resumed) {
      plan = reel.plan;
      timeline = await refreshTimelineUrls(reel.timeline);
      voiceKey = reel.voiceKey || '';
      musicKeySaved = reel.musicKey || '';
      model = reel.model || '';
      ledger.add({ source: 'Capture reel — resumed', output: `try ${attempt}: the saved cut is rendered again — no new model calls` });
    } else {
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
    let style = styleDoc?.status === 'ready' ? styleDoc.style : null;
    if (reel.styleId && !style) throw userError('That reel style is not available any more. Pick another.');
    // No voice in any reel (product decision, Nov 2026): a style keeps its look,
    // pacing and type, and its story is told by on-screen words over music.
    if (style) style = { ...style, audio: { ...(style.audio || {}), mode: 'music' }, captions: 'none' };

    // Capture › Reel › Include voiceover: the studio's recorded takes are the voice
    let studioVoice = null;
    if (reel.voiceover?.takes?.length) {
      try {
        studioVoice = await studioVoiceOf(reel);
        if (studioVoice && studioVoice.words.length < 4) studioVoice = null;
      } catch (err) {
        console.warn(`[captureReel] ${reel._id} studio voiceover unusable — cutting without it: ${err.message}`);
        studioVoice = null;
      }
      ledger.add({
        source: 'Capture reel — studio voiceover',
        model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1',
        output: studioVoice
          ? `${studioVoice.parts} recorded part(s) joined · ${studioVoice.duration.toFixed(1)}s · ${studioVoice.words.length} timed words\n\n${studioVoice.script}`
          : 'not used (no speech found in the takes)',
        costUsd: studioVoice ? mins(studioVoice.duration) * WHISPER_USD_PER_MIN : 0,
      });
    }

    await stage(reel, 'writing', clock);
    let earlyMusic = null;
    // a recommended post's reel plan (services/ideaReelPlan.js): every director
    // reads it with the capture, and its FORMAT picks the editor
    // (services/reelFormatDirector.js — one director per reel category)
    const story = reel.storyPlan?.sequences?.length ? reel.storyPlan : null;
    let formatDone = false;
    // Capture › format panel › Reel: "No graphics" keeps the cut to the footage and plain words
    const noGraphics = reel.prefs?.graphics === 'out';
    const noMusic = reel.prefs?.music === 'none';
    let defaultLook = noGraphics ? {
      extraRules: 'THE STUDIO CHOSE NO MOTION GRAPHICS for this reel. Use no animated graphic devices — no shapes, arrows, lines, stickers, icons, counters or decorative overlays. Words on screen stay plain text over the footage, and only where they carry the story.',
    } : null; // (also used by other formats that reuse the default director with their own rules)
    let motionBuild = null; // motion_graphics: the planned motion reel (motionReelPlanner.js)
    if (story) {
      const { storyPlanDirection } = require('./ideaReelPlan');
      material.capture.storyPlan = {
        title: story.title, format: story.format,
        sequences: story.sequences.map((q) => ({ title: q.title, role: q.role, shot: q.shot, say: q.say, onScreenText: q.onScreenText, seconds: q.targetSec })),
      };
      material.capture.notes.unshift({ note: storyPlanDirection(story) });
    }
    if (story && !style) {
      const fd = require('./reelFormatDirector');
      let fmt = story.format;
      const spoken = material.assets.some((a) => a.kind === 'video' && a.words?.length);
      if (fd.DIALOGUE_FORMATS.has(fmt) && !spoken) {
        // nobody was recorded speaking: the story is told in on-screen lines instead
        ledger.add({ source: 'Capture reel — format', output: `${fmt} → faceless_text`, note: 'no spoken take in the footage' });
        fmt = 'faceless_text';
      }
      if (fd.DIALOGUE_FORMATS.has(fmt)) {
        const out = await fd.directDialogueReel({ reel, material, story: { ...story, format: fmt }, brand: brandForPrompt, handle });
        out.debugRows.forEach((r) => ledger.add(r));
        model = out.model;
        ({ plan, style } = out);
        dialogueBuild = out.build;
        // one retry: Lyria now and then answers with no audio
        earlyMusic = styleRun.generateMusic(style)
          .catch(() => styleRun.generateMusic(style))
          .catch((err) => { console.warn(`[captureReel] ${reel._id} music:`, err.message); return { error: err.message }; });
        formatDone = true;
      } else if (fmt === 'faceless_text') {
        const out = await fd.directFacelessText({ material, story, brand: brandForPrompt, handle, directReel });
        ledger.add(out.debug);
        model = out.model;
        ({ plan, style } = out);
        formatDone = true;
      }
      else if (fmt === 'motion_graphics') {
        // Motion graphics (studio's guidance, 2026-11-19): selector → planner →
        // guard; rendered by MotionReel (remotion/src/MotionReel.tsx), no footage asked for
        const idea = reel.ideaId ? await require('../models/PostIdea').findById(reel.ideaId).select('title').lean().catch(() => null) : null;
        let mp;
        try {
          mp = await require('./motionReelPlanner').planMotionReel({
            material,
            brand: { accent: colors?.accent, ground: colors?.ground, fg: colors?.fg, headlineFont: fonts?.heading?.family, bodyFont: fonts?.body?.family },
            dna, handle, idea, storyPlan: story, language: 'English',
            stored: story.motionPlan || null,
          });
        } catch (err) {
          if (err.userFacing) throw userError(err.message);
          throw err;
        }
        mp.debugRows.forEach((r) => ledger.add(r));
        model = mp.model;
        motionBuild = mp;
        plan = {
          format: 'motion_graphics', audioMode: 'music', motion: mp.plan,
          caption: mp.plan.caption, hashtags: mp.plan.hashtags,
          // what the calendar post and the reel card read
          concept: `Motion graphics · ${mp.plan.mainFormat.replace(/_/g, ' ')}`,
          hook: { text: (mp.plan.segments.find((x) => x.formatId === 'kinetic_hook')?.props.words || []).join(' ') || story.title || '' },
          cta: { line: mp.plan.segments.find((x) => x.type === 'outro')?.props.cta || '' },
          scenes: [],
        };
        earlyMusic = styleRun.generateMusic({ audio: { mode: 'music', music: mp.music } })
          .catch(() => styleRun.generateMusic({ audio: { mode: 'music', music: mp.music } }))
          .catch((err) => { console.warn(`[captureReel] ${reel._id} music:`, err.message); return { error: err.message }; });
        formatDone = true;
      }
      // music_led / motion_graphics: the Bauhly Reel Director below — the plan rides in the notes
    }
    if (formatDone) {
      // the format director made the cut
    } else if (studioVoice) {
      // the studio's voiceover leads: the director cuts the material to what they said
      if (!noMusic) {
        const { DEFAULT_MUSIC } = require('./reelDirectorDefault');
        earlyMusic = styleRun.generateMusic({ audio: { mode: 'music', music: DEFAULT_MUSIC } })
          .catch((err) => { console.warn(`[captureReel] ${reel._id} music:`, err.message); return { error: err.message }; });
      }
      const voiceDirection = [
        reel.direction,
        `THE STUDIO RECORDED THE VOICEOVER. Set audioMode "voiceover". This is exactly what they say, in order: "${studioVoice.script}". Write each scene's voiceLine as the next consecutive stretch of that transcript, word for word, so the scenes together read the whole transcript once and in order; pick for each scene the asset that shows what its line is about. Talking clips with onCameraSound "good" come first: where the person on camera says something on this story, put that as an on-camera moment (sound "clip", voiceLine "", cut to just those sentences) BETWEEN two stretches of the transcript where it fits the narrative — the recording pauses there and resumes after. Every word of the transcript is still used, in order, across the other scenes.`,
        noGraphics ? 'No motion graphics: no animated graphic devices, words on screen stay plain.' : '',
      ].filter(Boolean).join('\n\n');
      const directed = await directReel({ material, handle, brand: brandForPrompt, direction: voiceDirection, style: null });
      ledger.add(directed.debug);
      model = directed.model;
      ({ plan } = directed);
      plan.audioMode = 'voiceover';
    } else if (!style) {
      // Default: the Bauhly Reel Director brief — a short, text-led cut to the
      // beat of an original track, which is composed while the director plans
      const { directDefaultReel, DEFAULT_MUSIC } = require('./reelDirectorDefault');
      earlyMusic = noMusic ? null : styleRun.generateMusic({ audio: { mode: 'music', music: DEFAULT_MUSIC } })
        .catch((err) => { console.warn(`[captureReel] ${reel._id} music:`, err.message); return { error: err.message }; });
      const profile = handle
        ? await require('../models/InstagramProfile').findOne({ user: reel.user, username: handle }).select('username fullName biography').lean().catch(() => null)
        : null;
      const directed = await directDefaultReel({ material, profile, dna, dcttStage: 'discovery', look: defaultLook });
      directed.debugRows.forEach((r) => ledger.add(r));
      model = directed.model;
      ({ plan, style } = directed);
    } else {
      const directed = await directReel({ material, handle, brand: brandForPrompt, direction: reel.direction, style });
      ledger.add(directed.debug);
      model = directed.model;
      ({ plan } = directed);
    }

    // music-led cut + Include graphics: the explainer agent reads the cut while the music and voice are made
    const drawingJob = !noGraphics && plan.audioMode === 'music' && !motionBuild && !dialogueBuild
      ? commissionDrawings({ plan, material, voice: null })
      : null;
    drawingJob?.catch(() => {}); // awaited (and its failure noted) when the timeline is built

    // the style's music bed is generated while the voice is recorded
    const wantsMusic = style && style.audio?.mode !== 'voiceover' && plan.audioMode !== 'original';
    if (noMusic && earlyMusic) {
      earlyMusic.catch(() => {});
      earlyMusic = null;
      ledger.add({ source: 'Capture reel — music bed', output: 'Skipped: the studio chose No music' });
    }
    const musicJob = noMusic ? null : earlyMusic || (wantsMusic
      ? styleRun.generateMusic(style).catch((err) => { console.warn(`[captureReel] ${reel._id} music:`, err.message); return { error: err.message }; })
      : null);

    let voice = null;
    let voiceUrl = '';
    voiceKey = '';
    if (plan.audioMode === 'voiceover' && studioVoice) {
      // the studio's own recording, already joined and timed
      voice = studioVoice;
      voiceKey = `projects/${reel.user}/reel-${reel._id}-voice.mp3`;
      await uploadBytes(voiceKey, voice.mp3, 'audio/mpeg', { immutable: true });
      voiceUrl = await getMediaUrl(voiceKey);
    } else if (plan.audioMode === 'voiceover') {
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
      // the kit's text + background roles too: the caption agent may colour a key word with them
      fg: colors?.fg || '',
      ground: colors?.ground || '',
      // the kit's three type roles (heading / body / detail) — every word of a talking reel uses them
      fonts: fonts || null,
      headlineFont: fonts?.heading?.family || '',
      bodyFont: fonts?.body?.family || '',
    };
    if (motionBuild) {
      timeline = await require('./motionReelPlanner').compileMotionTimeline(motionBuild.plan, motionBuild.ctx, {
        brand: { ...brand, ground: colors?.ground, fg: colors?.fg }, fps: FPS, width: WIDTH, height: HEIGHT, music,
      });
      ledger.add({ source: 'Capture reel — motion graphics timeline', output: `${motionBuild.plan.mainFormat} · ${(timeline.format.durationInFrames / FPS).toFixed(1)}s · ${timeline.motion.segments.length} segment(s)` });
    } else if (dialogueBuild) {
      const built = await dialogueBuild({ brandKit: brand, music });
      (built.debugRows || []).forEach((r) => ledger.add(r)); // caption + motion graphics agents
      timeline = built.timeline;
      voiceKey = built.voiceKey;
      ledger.add({ source: 'Capture reel — dialogue edit', output: `${built.stats.spokenSec}s spoken · ${built.stats.pieces} cuts · B-roll on ${built.stats.brollShare}% of it`, note: 'dead air cut; one levelled dialogue track; picture muted over it' });
    } else {
      // Capture › Reel › Include graphics: animated explainer drawings where they explain the story
      let drawings = null;
      if (!noGraphics && (plan.audioMode === 'music' || (plan.audioMode === 'voiceover' && voice?.words?.length))) {
        try {
          drawings = await (drawingJob || commissionDrawings({ plan, material, voice }));
          if (drawings?.debug) ledger.add(drawings.debug);
        } catch (err) {
          console.warn(`[captureReel] ${reel._id} explainer drawings:`, err.message);
          ledger.add({ source: 'Capture reel — explainer animation agent', output: `Skipped: ${err.message}`, note: 'reel cut without drawings' });
        }
      }
      timeline = await buildTimeline({ plan, material, voice, voiceUrl, brand, style, music, drawings, onDebug: (r) => ledger.add(r), reelId: String(reel._id) });
      const n = timeline.scenes.filter((x) => x.explainer).length;
      if (drawings) ledger.add({ source: 'Capture reel — explainer drawings', output: n ? `${n} drawing(s): ${timeline.scenes.filter((x) => x.explainer).map((x) => `${x.explainer.scene} "${x.explainer.title}"`).join(' · ')}` : 'none fitted this reel' });
    }
    if (music) {
      // the bed is cut to the finished length, faded, and stored with the reel
      const bed = await styleRun.fitMusic(music.mp3, timeline.format.durationInFrames / FPS);
      const musicKey = `projects/${reel.user}/reel-${reel._id}-music.mp3`;
      await uploadBytes(musicKey, bed, 'audio/mpeg', { immutable: true });
      timeline.audio = { ...(timeline.audio || {}), musicSrc: await getMediaUrl(musicKey), musicVolume: plan.audioMode === 'music' ? 0.9 : plan.audioMode === 'dialogue' ? 0.1 : 0.13 };
      musicKeySaved = musicKey;
    }
    // the finished cut is playable in the browser right away (Remotion Player,
    // same composition) while the server renders the MP4 for download/publish
    // (+ what a retry needs to render it again without paying twice)
    await CaptureReel.updateOne({ _id: reel._id }, {
      $set: { timeline, plan, caption: plan.caption, hashtags: plan.hashtags, previewAt: new Date(), voiceKey, musicKey: musicKeySaved, model },
    });
    } // end: fresh cut
    await stage(reel, 'rendering', clock); // 'cutting' above = choosing + preparing the media
    // the MP4: from the studio's browser when it rendered it, else offered to a
    // watching browser, else rendered here
    let renderInfo = null;
    const fromBrowser = reel.browserRender?.state === 'uploaded' && reel.browserRender.uploadKey
      ? await getObjectBytes(reel.browserRender.uploadKey).catch((err) => {
        console.warn(`[captureReel] ${reel._id} browser upload unreadable (${err.message}) — rendering here`);
        return null;
      })
      : null;
    if (fromBrowser && fromBrowser.buffer.length > 50 * 1024) {
      await fs.promises.writeFile(tmp, fromBrowser.buffer);
      const sec = Number(reel.browserRender.renderSec) || 0;
      renderInfo = { timing: { 'render · browser': Math.round(sec * 1000) } };
      ledger.add({ source: 'Capture reel — rendered in the browser', output: `${(fromBrowser.buffer.length / 1e6).toFixed(1)} MB in ${sec.toFixed(1)}s (studio's browser)` });
    } else if (!handedBack && await browser.offerToBrowser(reel._id, timeline)) {
      handedOff = true;
      // what the cut cost and took so far — the finishing run adds it to its own
      const times = { ...clock.times };
      await CaptureReel.updateOne({ _id: reel._id }, {
        $set: { 'browserRender.cutCostUsd': ledger.total(), 'browserRender.cutTimings': times },
      });
      recordBackgroundDebug(reel.user, 'Capture reel', {
        agents: [...ledger.rows, { source: 'Capture reel — handed to the browser', output: 'The studio\'s browser renders the MP4; the server finishes it after the upload.' }],
        model,
        mode: 'capture reel',
        elapsedMs: Date.now() - started,
        usage: { estimatedCostUsd: Math.round(ledger.total() * 1e6) / 1e6 },
      });
      console.log(`[captureReel] ${reel._id} handed to the studio's browser to render`);
      return;
    } else {
      // the render's own % → the reel (studio + pill progress bars), at most every 5 s
      let pctSaved = -1;
      let pctAt = 0;
      renderInfo = await renderReel(timeline, tmp, {
        onProgress: (pct) => {
          if (pct === pctSaved || (Date.now() - pctAt < 5000 && pct < 100)) return;
          pctSaved = pct;
          pctAt = Date.now();
          CaptureReel.updateOne({ _id: reel._id }, { $set: { renderPct: pct } }).catch(() => {});
        },
      });
    }
    if (renderInfo.timing) Object.assign(clock.times, renderInfo.timing);

    await stage(reel, 'saving', clock);
    const videoKey = `projects/${reel.user}/reel-${reel._id}.mp4`;
    const posterKey = `projects/${reel.user}/reel-${reel._id}-poster.jpg`;
    const coverScene = Number.isInteger(plan.coverShotIndex) ? timeline.scenes[plan.coverShotIndex] : null;
    const hookEnd = timeline.motion ? timeline.motion.coverFrame / FPS : coverScene
      ? (coverScene.from + coverScene.durationInFrames * 0.6) / FPS
      : (timeline.hook ? timeline.hook.durationInFrames / FPS - 0.2 : 0.8);
    await Promise.all([
      // a browser-rendered MP4 is already in S3: copied there, not uploaded again
      fromBrowser
        ? require('./s3Client').copyObject(reel.browserRender.uploadKey, videoKey, 'video/mp4', { immutable: true })
        : fs.promises.readFile(tmp).then((buf) => uploadBytes(videoKey, buf, 'video/mp4', { immutable: true })),
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
        // + the cut's cost and times when the browser rendered it (paid in the run that handed it off)
        costUsd: Math.round((ledger.total() + (fromBrowser ? Number(reel.browserRender.cutCostUsd) || 0 : 0)) * 10000) / 10000,
        timings: fromBrowser && reel.browserRender.cutTimings ? { ...reel.browserRender.cutTimings, ...clock.end() } : clock.end(),
        finishedAt: new Date(),
      },
    });
    // on the calendar like a generated carousel (next empty publishing day)
    // (scripts/test-capture-reel.js sets CAPTURE_REEL_SKIP_CALENDAR: tests stay off the calendar)
    // the browser's upload was copied to the reel's own key: drop the temp file
    if (fromBrowser) require('./s3Client').deleteObjects([reel.browserRender.uploadKey]).catch(() => {});
    if (!process.env.CAPTURE_REEL_SKIP_CALENDAR) try {
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
    console.error(`[captureReel] ${reel._id} failed (try ${attempt}/${MAX_ATTEMPTS}):`, err.stack || err.message, err.detail || '');
    if (!err.userFacing && attempt < MAX_ATTEMPTS) {
      // temporary trouble (a model timeout, bad JSON, S3, the render): queued
      // again; the caller (queue / in-process runner) schedules the next try
      await CaptureReel.updateOne({ _id: reel._id }, {
        $set: { status: 'queued', stage: 'retrying', error: '', errorDetail: `try ${attempt} failed: ${detail}` },
      });
      retryErr = retryError(`try ${attempt} failed: ${err.message}`);
    } else {
      await CaptureReel.updateOne({ _id: reel._id }, {
        $set: {
          status: 'error',
          errorDetail: detail,
          error: err.userFacing ? err.message
            // a rejected key won't fix itself — say so instead of "try again"
            : /\b401\b|invalid(ated)? api key|incorrect api key|API key (has been|was) (invalidated|revoked)|PERMISSION_DENIED|API_KEY_INVALID/i.test(detail)
              ? 'The AI service rejected its API key, so the reel could not be made. An admin needs to update the key.'
              : 'The reel could not be made this time. Try again.',
          finishedAt: new Date(),
          costUsd: Math.round(ledger.total() * 10000) / 10000,
        },
      });
    }
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
    for (const [key, file] of clipFileCache) {
      clipFileCache.delete(key);
      file.then((f) => fs.promises.unlink(f)).catch(() => {});
    }
  }
  // handed to the browser: no summary row yet — the finishing run writes it
  if (handedOff) return;
  {
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
  if (retryErr) throw retryErr;
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
      .then(() => ({}), (err) => {
        if (err.retryable) return { retryInMs: 20000 };
        console.error('[captureReel] runner crashed', err.message);
        return {};
      })
      .then(({ retryInMs }) => {
        active.delete(id);
        if (retryInMs) setTimeout(() => runInProcess(id), retryInMs).unref?.();
        pump();
      }));
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
  // the on-camera sound check, shared with the voiceover script writer (voiceoverScript.js)
  clipWords,
  speechQualityOf,
  MAX_ATTEMPTS,
  FPS,
  // the studio's browser render gets the cut with fresh media URLs
  refreshTimelineUrls,
  // shared with services/reelFormatDirector.js
  _visionParts: visionParts,
  _clipFile: clipFile,
  _ffmpegPath: ffmpegPath,
  _studioVoiceOf: studioVoiceOf,
  _imageSrc: imageSrc,
  _letterboxOf: letterboxOf,
  _videoSizeOf: videoSizeOf,
  _imageSizeOf: imageSizeOf,
  _backdropOf: backdropOf,
  _stillNear: stillNear,
  _luminance: luminance,
  _liftAccent: liftAccent,
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
