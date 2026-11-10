/*
 * Video analysis — the video counterpart of imageAnalysis. A capture's clip is
 * read once and turned into what planning can use:
 *
 *   1. ffmpeg picks a handful of candidate stills spread over the clip (the
 *      `thumbnail` filter chooses the most representative frame of each spot,
 *      so motion-blurred frames are rarely picked);
 *   2. the soundtrack is transcribed (what the studio said while filming);
 *   3. ONE vision call sees every still in order + the transcript and returns
 *      the clip's summary plus a per-still analysis (subjects with boxes, the
 *      same shape as a photo's) and whether the still is good enough to stand
 *      on a slide;
 *   4. the kept stills are written to S3 as JPEGs beside the clip.
 *
 * Each kept still has its own S3 key, so the Strategist can allocate it and the
 * carousel can place it exactly like a photo — the rest of the pipeline (vision
 * input, Photo Focus, display copies, export) needs no video special case.
 *
 * analyzeVideoAsset() is memoised per key while it runs, so the capture chat
 * (which reads the clip to ask its question) and the capture save share one run.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { completeToolCall } = require('./llmComplete');
const { getObjectBytes, headObject, uploadBytes, isS3Configured } = require('./s3Client');
const { normalizeSubjects } = require('./subjectBox');
const { toVisionImage } = require('./visionImage');

const execute = promisify(execFile);

const MAX_VIDEO_MB = Number(process.env.VIDEO_ANALYZE_MAX_MB) || 400;
const MAX_CANDIDATES = Number(process.env.VIDEO_STILL_CANDIDATES) || 8;
const MAX_STILLS = Number(process.env.VIDEO_STILLS_MAX) || 6;
const MAX_AUDIO_SEC = Number(process.env.VIDEO_TRANSCRIBE_MAX_SEC) || 1200;

const EXT_OF = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
};

const VIDEO_TOOL = {
  name: 'record_video_analysis',
  description: 'Record what this video shows and says, and which stills are usable as photos.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One short sentence: what the clip shows' },
      description: { type: 'string', description: '3-5 sentences: the setting, what happens over the clip, what is shown or demonstrated, and what is said' },
      tags: { type: 'array', items: { type: 'string' }, description: '6-12 short lowercase keywords' },
      colors: { type: 'array', items: { type: 'string' }, description: 'Dominant colours' },
      mood: { type: 'string', description: 'A few words on the feeling / tone' },
      text: { type: 'string', description: 'Legible on-screen text, verbatim, or empty' },
      stills: {
        type: 'array',
        description: 'One entry per attached still, in the same order',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '1-based still number' },
            summary: { type: 'string', description: 'One short sentence describing this still' },
            description: { type: 'string', description: '1-3 sentences: what is visible, the stage of the work if any' },
            tags: { type: 'array', items: { type: 'string' } },
            subjects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  box: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
                  },
                  point: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
                },
                required: ['name', 'box', 'point'],
              },
            },
            text: { type: 'string', description: 'Legible text in this still, or empty' },
            keep: { type: 'boolean', description: 'true when this still is sharp, well framed and shows something worth a slide; false for blur, transitions, a black frame or a near-duplicate of an earlier kept still' },
          },
          required: ['index', 'summary', 'description', 'tags', 'subjects', 'text', 'keep'],
        },
      },
    },
    required: ['summary', 'description', 'tags', 'colors', 'mood', 'text', 'stills'],
  },
};

const SYSTEM_PROMPT = `You are a visual analyst for a studio's content library. You are given stills taken in order from ONE video the studio filmed, each labelled with its time, plus the transcript of what was said in it. Describe what the video actually shows and says — concretely, so a strategist can build a post from it without watching it. Never invent details that neither the stills nor the transcript support.

Call record_video_analysis.
- summary / description: the clip as a whole. Use the transcript for what is explained or claimed; use the stills for what is visible. Say plainly when the clip is someone talking to camera.
- stills: one entry per attached still, same order. Describe each still like a photograph.
- subjects (per still): the 3–8 most important things in that frame, each with a TIGHT box (percent of the frame, origin top-left, x,y = top-left corner; typical w/h 6–18) and a point at the centre of the thing. Never wrap a person and the object they handle in one box. Name objects, not actions.
- keep: true only for stills that could stand on a slide as a photo — sharp, clearly framed, showing something meaningful. Mark motion blur, transitions, black or washed-out frames, and near-duplicates of an earlier kept still as false. Keep at least one still when any is usable.`;

const str = (v) => String(v == null ? '' : v).trim();
const asStrings = (v, max = 12) => (Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, max) : []);

function ffmpegBin() {
  return process.env.FFMPEG_PATH || require('ffmpeg-static');
}

function ffmpeg(args, timeout = 120000) {
  return execute(ffmpegBin(), ['-nostdin', '-hide_banner', '-y', ...args], {
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function visionModel() {
  return process.env.VIDEO_VISION_MODEL || process.env.VISION_MODEL || process.env.OPENAI_VISION_MODEL || 'gpt-5.6-terra';
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Duration + whether it has sound, from ffmpeg's own probe output. */
async function probe(file) {
  let stderr = '';
  try {
    ({ stderr } = await ffmpeg(['-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-']));
  } catch (err) {
    stderr = String(err.stderr || '');
    if (!/Stream #\d+:\d+.*Video:/.test(stderr)) {
      const e = new Error('This video could not be decoded');
      e.code = 'UNDECODABLE';
      throw e;
    }
  }
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return { durationSec, hasAudio: /Stream #\d+:\d+.*Audio:/.test(stderr) };
}

/** Candidate still times, spread evenly over the clip. */
function candidateTimes(durationSec) {
  if (!durationSec || durationSec < 1.5) return [0];
  const n = Math.max(2, Math.min(MAX_CANDIDATES, Math.round(durationSec / 5)));
  return Array.from({ length: n }, (_, i) => Math.min(durationSec - 0.5, (durationSec * (i + 0.5)) / n));
}

async function extractStills(file, durationSec, folder) {
  const out = [];
  for (const [i, t] of candidateTimes(durationSec).entries()) {
    const target = path.join(folder, `still-${i}.jpg`);
    try {
      // thumbnail=20 → the most representative of the next ~20 frames (skips
      // the blurred one a plain seek often lands on). ffmpeg auto-rotates.
      // eslint-disable-next-line no-await-in-loop
      await ffmpeg([
        '-ss', t.toFixed(2), '-i', file,
        '-vf', 'thumbnail=20,scale=1600:1600:force_original_aspect_ratio=decrease',
        '-frames:v', '1', '-q:v', '3', target,
      ]);
      // eslint-disable-next-line no-await-in-loop
      const buffer = await fs.readFile(target);
      if (buffer.length > 2000) out.push({ t, buffer });
    } catch (err) {
      console.warn('[video] still at', t.toFixed(1), 's failed:', err.message);
    }
  }
  return out;
}

async function transcribeClip(file, hasAudio, folder) {
  if (!hasAudio || !process.env.OPENAI_API_KEY) return '';
  const audio = path.join(folder, 'audio.m4a');
  try {
    await ffmpeg([
      '-i', file, '-map', '0:a:0', '-vn', '-t', String(MAX_AUDIO_SEC),
      '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '48k', audio,
    ], 180000);
    const buffer = await fs.readFile(audio);
    if (buffer.length < 4000) return '';
    // lazy: transcribeAudio pulls in the OpenAI client
    const { transcribeAudio } = require('./transcribeAudio');
    const result = await transcribeAudio(buffer, 'audio/mp4');
    return str(result.text);
  } catch (err) {
    console.warn('[video] transcription failed:', err.message);
    return '';
  }
}

function estimateCost(model, inputTokens, outputTokens) {
  const { estimatePlanCostUsd } = require('./weeklyPlan');
  return estimatePlanCostUsd(model, inputTokens, outputTokens);
}

function stillKeyOf(videoKey, i) {
  const base = String(videoKey).replace(/\.[a-z0-9]+$/i, '');
  return `${base}.still-${i + 1}.jpg`;
}

async function runAnalysis(key) {
  const head = await headObject(key).catch(() => null);
  if (head && head.size > MAX_VIDEO_MB * 1024 * 1024) {
    const e = new Error(`Video is larger than ${MAX_VIDEO_MB} MB`);
    e.code = 'TOO_LARGE';
    throw e;
  }
  const { buffer, contentType } = await getObjectBytes(key);
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'bauhly-video-'));
  try {
    const ext = EXT_OF[String(contentType || '').toLowerCase()] || (String(key).split('.').pop() || 'mp4');
    const file = path.join(folder, `clip.${ext}`);
    await fs.writeFile(file, buffer);

    const { durationSec, hasAudio } = await probe(file);
    const [stills, transcript] = await Promise.all([
      extractStills(file, durationSec, folder),
      transcribeClip(file, hasAudio, folder),
    ]);
    if (!stills.length) throw new Error('No frames could be read from this video');

    const userParts = [];
    for (const [i, s] of stills.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const v = await toVisionImage(s.buffer, 'image/jpeg', `still-${i}.jpg`);
      userParts.push({ type: 'text', text: `Still ${i + 1} — at ${fmtTime(s.t)}` });
      userParts.push({ type: 'image', mediaType: v.mediaType, data: v.buffer.toString('base64') });
    }
    userParts.push({
      type: 'text',
      text: [
        `Video length: ${fmtTime(durationSec)}. ${stills.length} still(s) attached above, in order.`,
        transcript ? `Transcript of what is said:\n"""\n${transcript.slice(0, 12000)}\n"""` : 'No speech in this clip (or no soundtrack).',
        'Analyse the video. One `stills` entry per still, same order.',
      ].join('\n\n'),
    });

    const model = visionModel();
    const done = await completeToolCall({
      model,
      system: SYSTEM_PROMPT,
      userParts,
      tool: VIDEO_TOOL,
      maxTokens: 8000,
      retryHint: 'Call record_video_analysis with valid JSON — one stills entry per attached still.',
    });
    const parsed = (done.parsed && typeof done.parsed === 'object') ? done.parsed : {};
    const rows = Array.isArray(parsed.stills) ? parsed.stills : [];
    const rowFor = (i) => rows.find((r) => Number(r?.index) === i + 1) || rows[i] || {};

    // Keep what the model marked usable; never zero when any still exists.
    let keep = stills.map((_, i) => rowFor(i).keep !== false);
    if (!keep.some(Boolean)) keep = stills.map((_, i) => i === Math.floor(stills.length / 2));
    const kept = stills.map((s, i) => ({ s, i })).filter(({ i }) => keep[i]).slice(0, MAX_STILLS);

    const frames = [];
    for (const [n, { s, i }] of kept.entries()) {
      const r = rowFor(i);
      const stillKey = stillKeyOf(key, n);
      // eslint-disable-next-line no-await-in-loop
      await uploadBytes(stillKey, s.buffer, 'image/jpeg', { immutable: true });
      frames.push({
        key: stillKey,
        t: Math.round(s.t * 10) / 10,
        summary: str(r.summary),
        description: str(r.description),
        tags: asStrings(r.tags, 10),
        subjects: normalizeSubjects(r.subjects),
        text: str(r.text),
      });
    }

    const inputTokens = Number(done.usage?.input_tokens) || 0;
    const outputTokens = Number(done.usage?.output_tokens) || 0;
    return {
      summary: str(parsed.summary),
      description: str(parsed.description),
      tags: asStrings(parsed.tags),
      colors: asStrings(parsed.colors, 8),
      mood: str(parsed.mood),
      subjects: [],
      text: str(parsed.text),
      transcript,
      durationSec: Math.round(durationSec * 10) / 10,
      frames,
      model,
      inputTokens,
      outputTokens,
      costUsd: estimateCost(model, inputTokens, outputTokens),
    };
  } finally {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

// One run per key at a time (the capture chat and the capture save share it);
// finished results stay briefly so a save right after the chat reuses them.
const inflight = new Map();
const RESULT_TTL_MS = 30 * 60 * 1000;

function analyzeVideoAsset(key) {
  if (!isS3Configured()) return Promise.reject(new Error('Storage is not configured'));
  const hit = inflight.get(key);
  if (hit && (!hit.doneAt || Date.now() - hit.doneAt < RESULT_TTL_MS)) return hit.promise;
  const entry = { promise: null, doneAt: 0 };
  entry.promise = runAnalysis(key).then(
    (r) => { entry.doneAt = Date.now(); return r; },
    (err) => { inflight.delete(key); throw err; },
  );
  inflight.set(key, entry);
  if (inflight.size > 64) {
    const oldest = [...inflight.entries()].find(([, v]) => v.doneAt);
    if (oldest) inflight.delete(oldest[0]);
  }
  return entry.promise;
}

/** The finished analysis if ready within `ms`, else null (never throws). */
async function videoAnalysisWithin(key, ms) {
  let timer;
  try {
    return await Promise.race([
      analyzeVideoAsset(key),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } catch (err) {
    console.warn('[video] analysis unavailable for', key, err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** S3 keys of the stills made from a video attachment (for cleanup). */
function stillKeysOf(attachment) {
  return ((attachment && attachment.analysis && attachment.analysis.frames) || [])
    .map((f) => f && f.key).filter(Boolean);
}

module.exports = { analyzeVideoAsset, videoAnalysisWithin, stillKeysOf, fmtTime };
