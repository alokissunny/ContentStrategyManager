/**
 * Reel Style analyser — turns a reference Instagram Reel URL into a ReelStyle.
 *
 *   1. fetch      — Apify instagram-scraper (directUrls) → video URL + caption
 *   2. measure    — ffmpeg: duration, cut times (scene change), shot stats;
 *                   audioBeats: tempo + how rhythmic; Whisper: speech density
 *   3. look       — one frame per shot (≤16) → vision LLM → style spec
 *   4. keep       — thumbnail to S3, ReelStyle saved
 *
 * Only the PATTERN is kept. The reference's footage, words and audio are not
 * stored or reused (the generated reel gets an original music bed).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');
const { toFile } = require('openai');
const getOpenAIClient = require('./openaiClient');
const getApifyClient = require('./apifyClient');
const ReelStyle = require('../models/ReelStyle');
const { completeToolCall, splitPromptTemplate } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { uploadBytes } = require('./s3Client');
const { beatsOf } = require('./audioBeats');

const run = promisify(execFile);
const PROMPT = path.join(__dirname, '..', '..', 'prompts', 'reel-style-analyze.md');
const MAX_FRAMES = 16;
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;

const ffmpegPath = () => process.env.FFMPEG_PATH || require('ffmpeg-static');
const r2 = (n) => Math.round(n * 100) / 100;

function shortCodeOf(url) {
  const m = /instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})/.exec(String(url || ''));
  return m ? m[1] : '';
}

// ── 1. fetch ─────────────────────────────────────────────────────────────────
async function fetchReel(shortCode) {
  const client = getApifyClient();
  const actor = process.env.APIFY_INSTAGRAM_REEL_ACTOR || 'apify/instagram-scraper';
  const runInfo = await client.actor(actor).call({
    directUrls: [`https://www.instagram.com/reel/${shortCode}/`],
    resultsType: 'posts',
    resultsLimit: 1,
    addParentData: false,
  }, { waitSecs: 240 });
  const { items } = await client.dataset(runInfo.defaultDatasetId).listItems();
  const item = (items || []).find((i) => i.shortCode === shortCode) || (items || [])[0];
  if (!item?.videoUrl) throw new Error('Instagram returned no video for this reel (private, removed or not a reel).');
  return item;
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_VIDEO_BYTES) throw new Error('Reference reel is too large to analyse.');
  await fs.promises.writeFile(file, buf);
  return buf.length;
}

// ── 2. measure ───────────────────────────────────────────────────────────────
async function cutsOf(file) {
  const { stderr } = await run(ffmpegPath(), ['-hide_banner', '-nostdin', '-i', file, '-an',
    '-vf', "select='gt(scene,0.28)',showinfo", '-f', 'null', '-'], { timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const duration = (() => {
    const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  })();
  const size = /Video: [^\n]*?, (\d{2,5})x(\d{2,5})/.exec(stderr);
  const cuts = [...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((m) => r2(Number(m[1])))
    .filter((t, i, a) => t > 0.2 && (i === 0 || t - a[i - 1] > 0.15));
  return { duration: r2(duration), cuts, width: size ? Number(size[1]) : 0, height: size ? Number(size[2]) : 0 };
}

async function speechOf(file) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rstyle-a-'));
  try {
    const mp3 = path.join(dir, 'a.mp3');
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3], { timeout: 120000 });
    const client = getOpenAIClient();
    const res = await client.audio.transcriptions.create({
      file: await toFile(await fs.promises.readFile(mp3), 'a.mp3', { type: 'audio/mpeg' }),
      model: process.env.REEL_TRANSCRIBE_MODEL || 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    const segments = (res.segments || [])
      // whisper hallucinates on music beds: keep segments it is confident speech
      .filter((s) => (s.no_speech_prob ?? 0) < 0.6 && (s.avg_logprob ?? 0) > -1.2)
      .map((s) => ({ start: r2(s.start), end: r2(s.end), text: String(s.text || '').trim() }))
      .filter((s) => s.text);
    const words = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
    return { language: res.language || '', segments, words, durationSec: r2(res.duration || 0) };
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// one frame a little into each shot (and the very start)
async function framesOf(file, cuts, duration) {
  const starts = [0, ...cuts];
  let picks = starts.map((s, i) => {
    const end = i < starts.length - 1 ? starts[i + 1] : duration;
    return r2(Math.min(end - 0.05, s + Math.min(0.6, (end - s) / 2)));
  });
  if (picks.length > MAX_FRAMES) {
    const step = picks.length / MAX_FRAMES;
    picks = Array.from({ length: MAX_FRAMES }, (_, i) => picks[Math.floor(i * step)]);
  }
  const out = [];
  for (const t of picks) {
    // eslint-disable-next-line no-await-in-loop
    const { stdout } = await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
      '-frames:v', '1', '-vf', 'scale=432:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1'],
    { encoding: 'buffer', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (stdout.length) out.push({ t, jpg: stdout });
  }
  return out;
}

// ── 3. look ──────────────────────────────────────────────────────────────────
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const en = (values) => ({ type: 'string', enum: values });
const STYLE_TOOL = {
  name: 'record_reel_style',
  description: 'The reproducible editing style of the reference reel.',
  input_schema: obj({
    name: str,
    summary: str,
    bestFor: str,
    audio: obj({
      mode: en(['music', 'voiceover', 'voiceover+music']),
      music: obj({ mood: str, genre: str, energy: en(['low', 'medium', 'high']), bpm: { type: 'number' }, prompt: str }),
      voice: obj({ tone: str, pace: en(['calm', 'conversational', 'fast']) }),
    }),
    pacing: obj({ hookHoldSec: { type: 'number' }, shotSec: { type: 'number' }, beatSync: { type: 'boolean' }, targetLengthSec: { type: 'number' } }),
    hook: obj({ pattern: str, example: str, treatment: en(['stack-repeat', 'slam', 'serif-center', 'two-weight', 'listicle']) }),
    text: obj({
      overlay: en(['serif-stack', 'serif-center', 'serif-accent', 'two-weight', 'pill', 'bold-sans', 'none']),
      perShot: en(['every-shot', 'some-shots', 'hook-only']),
      textCase: en(['upper', 'lower', 'sentence']),
      font: en(['condensed-serif', 'serif', 'serif-italic', 'sans', 'sans-bold']),
      color: str,
      position: en(['top', 'center', 'lower']),
      wording: str,
    }),
    captions: en(['none', 'subtitle', 'karaoke', 'two-weight']),
    chapters: obj({ numbered: { type: 'boolean' }, card: en(['white-card', 'on-footage', 'none']) }),
    structure: { type: 'array', items: str },
    cta: obj({ pattern: str, example: str, endCard: en(['card', 'text-on-shot', 'none']) }),
    visuals: obj({ footage: str, grade: en(['warm', 'neutral', 'bright', 'cool']), motion: en(['static', 'slow-push', 'handheld']), transitions: { type: 'array', items: en(['cut', 'zoom', 'whip', 'slide', 'flash']) } }),
    directorNotes: { type: 'array', items: str },
  }),
};

async function lookAt({ measured, caption, frames }) {
  const { system, userTemplate } = splitPromptTemplate(fs.readFileSync(PROMPT, 'utf8'));
  const user = userTemplate
    .split('{{MEASURED_JSON}}').join(JSON.stringify(measured, null, 2))
    .split('{{CAPTION}}').join(String(caption || '(none)').slice(0, 1500));
  const parts = [];
  for (const f of frames) {
    parts.push({ type: 'text', text: `Frame @ ${f.t}s` });
    parts.push({ type: 'image', mediaType: 'image/jpeg', data: f.jpg.toString('base64') });
  }
  parts.push({ type: 'text', text: user });
  const llm = resolvePlanAgentLlm('reelStyle');
  const res = await completeToolCall({
    model: llm.model, system, userParts: parts, tool: STYLE_TOOL, maxTokens: 12000,
    kind: 'reelStyle', timeoutMs: 240000,
    retryHint: 'Return ONLY the JSON object for record_reel_style, matching the schema exactly.',
  });
  const u = res.usage || {};
  return {
    style: res.parsed,
    model: res.model,
    costUsd: estimatePlanCostUsd(res.model, Number(u.input_tokens) || 0, Number(u.output_tokens) || 0, Number(u.cached_tokens) || 0),
  };
}

// keep the spec inside what the renderer supports, with measured numbers winning
function normalizeStyle(raw, measured) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);
  const shot = measured.shots.medianSec || num(s.pacing?.shotSec, 0.3, 6, 2);
  const hex = /^#[0-9a-f]{6}$/i.test(String(s.text?.color || '')) ? s.text.color.toUpperCase() : '#FFFFFF';
  return {
    ...s,
    pacing: {
      hookHoldSec: num(measured.shots.firstSec || s.pacing?.hookHoldSec, 0.5, 4, 1.5),
      shotSec: num(shot, 0.3, 6, 2),
      beatSync: Boolean(s.pacing?.beatSync) && measured.music.pulse >= 2.5,
      targetLengthSec: num(s.pacing?.targetLengthSec || measured.durationSec, 6, 60, 20),
    },
    audio: {
      ...(s.audio || {}),
      music: { ...(s.audio?.music || {}), bpm: num(measured.music.bpm || s.audio?.music?.bpm, 70, 180, 110) },
    },
    text: { ...(s.text || {}), color: hex },
  };
}

// ── orchestration ────────────────────────────────────────────────────────────
async function analyzeReelStyle(styleId) {
  const doc = await ReelStyle.findById(styleId);
  if (!doc) return null;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rstyle-'));
  const file = path.join(dir, 'ref.mp4');
  const started = Date.now();
  try {
    const item = await fetchReel(doc.shortCode);
    await download(item.videoUrl, file);
    const [cuts, beats, speech] = await Promise.all([
      cutsOf(file),
      beatsOf(file).catch(() => null),
      speechOf(file).catch((err) => { console.warn('[reelStyle] speech', err.message); return { segments: [], words: 0 }; }),
    ]);
    const bounds = [0, ...cuts.cuts, cuts.duration];
    const lens = bounds.slice(1).map((b, i) => r2(b - bounds[i])).filter((x) => x > 0);
    const sorted = [...lens].sort((a, b) => a - b);
    const measured = {
      durationSec: cuts.duration,
      frame: `${cuts.width}x${cuts.height}`,
      cuts: cuts.cuts,
      shots: {
        count: lens.length,
        firstSec: lens[0] || 0,
        medianSec: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
        minSec: sorted[0] || 0,
        maxSec: sorted[sorted.length - 1] || 0,
      },
      music: beats ? { bpm: beats.bpm, pulse: beats.pulse, loudnessDb: beats.loudnessDb, rhythmic: beats.pulse >= 2.5 } : { bpm: 0, pulse: 0 },
      speech: {
        language: speech.language || '',
        wordsPerSec: cuts.duration ? r2(speech.words / cuts.duration) : 0,
        transcript: speech.segments.slice(0, 40),
      },
      owner: item.ownerUsername || '',
      audioSource: item.musicInfo?.uses_original_audio ? 'original audio' : (item.musicInfo?.song_name || ''),
    };
    const frames = await framesOf(file, cuts.cuts, cuts.duration);
    const looked = await lookAt({ measured, caption: item.caption, frames });
    const style = normalizeStyle(looked.style, measured);

    // a still from the hook as the picker's thumbnail (under the curator's prefix)
    let thumbKey = '';
    if (frames[0] && doc.createdBy) {
      thumbKey = `projects/${doc.createdBy}/reelstyle-${doc.shortCode}.jpg`;
      const { stdout } = await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.min(1, cuts.duration / 3)), '-i', file,
        '-frames:v', '1', '-vf', 'scale=540:-2', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '4', 'pipe:1'], { encoding: 'buffer', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      await uploadBytes(thumbKey, await sharp(stdout).jpeg({ quality: 82 }).toBuffer(), 'image/jpeg', { immutable: true });
    }
    await ReelStyle.updateOne({ _id: doc._id }, {
      $set: {
        status: 'ready', error: '', name: style.name || doc.shortCode, summary: style.summary || '',
        ownerUsername: item.ownerUsername || '', durationSec: cuts.duration, measured, style,
        thumbKey, model: looked.model, costUsd: r2(looked.costUsd * 100) / 100,
      },
    });
    console.log(`[reelStyle] ${doc.shortCode} ready · ${style.name} · ${Math.round((Date.now() - started) / 1000)}s`);
    return ReelStyle.findById(doc._id);
  } catch (err) {
    console.error(`[reelStyle] ${doc.shortCode} failed:`, err.message);
    await ReelStyle.updateOne({ _id: doc._id }, { $set: { status: 'error', error: err.message } });
    return null;
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Create (or re-run) a SHARED style from a reel URL (curation: scripts/seed-reel-styles.js). */
async function addReelStyle(url, { userId = null, order = 0 } = {}) {
  const shortCode = shortCodeOf(url);
  if (!shortCode) throw Object.assign(new Error('That is not an Instagram reel link.'), { statusCode: 400 });
  const doc = await ReelStyle.findOneAndUpdate(
    { shortCode },
    { $set: { sourceUrl: `https://www.instagram.com/reel/${shortCode}/`, status: 'analyzing', error: '', shared: true, ...(userId ? { createdBy: userId } : {}) }, $setOnInsert: { order } },
    { upsert: true, new: true },
  );
  return doc;
}

module.exports = { addReelStyle, analyzeReelStyle, shortCodeOf, normalizeStyle };
