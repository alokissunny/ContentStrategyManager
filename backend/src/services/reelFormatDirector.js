/*
 * Reel format directors — one editor per recommended-reel format (ReelPlanner
 * / services/ideaReelPlan.js), chosen in captureReelAgent.runCaptureReel when a
 * reel carries a story plan:
 *
 *   talking_head_broll   ┐ the DIALOGUE engine: an LLM edit decision list over
 *   talking_head         │ the studio's spoken takes (phrase ids from Whisper
 *   faceless_voiceover   ┘ word timings) + B-roll cutaways; code cuts dead air,
 *                          builds ONE continuous dialogue track (ffmpeg), lays
 *                          muted picture over it (speaker in sync, or B-roll as
 *                          L-cuts), alternates punch-in framing, word-timed
 *                          captions, slam hook, chapter labels, a quiet music
 *                          bed and an end card on the best finished shot.
 *   faceless_text          the story told in on-screen lines over footage, cut
 *                          to an original track (directReel + a text-led style).
 *   music_led              the existing Bauhly Reel Director (default teaser).
 *
 * Prompts: prompts/reel-formats/*.md (dialogue-base + one file per format).
 * Why (2026-11-18): a Talking head + B-roll reel came out as four takes played
 * back to back with captions — no cutaways, no music, no trimming.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { completeToolCall } = require('./llmComplete');
const { resolvePlanAgentLlm } = require('./planAgentLlm');
const { estimatePlanCostUsd } = require('./weeklyPlan');
const { uploadBytes, getMediaUrl } = require('./s3Client');

const run = promisify(execFile);
const DIR = path.join(__dirname, '..', '..', 'prompts', 'reel-formats');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');

const DIALOGUE_FORMATS = new Set(['talking_head_broll', 'talking_head', 'faceless_voiceover']);
const FORMAT_FILE = {
  talking_head_broll: 'talking-head-broll.md',
  talking_head: 'talking-head.md',
  faceless_voiceover: 'faceless-voiceover.md',
};
const ZOOM = { wide: 1, medium: 1.14, close: 1.3 };
const MOTIONS = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'none'];
const GAP_SPLIT = 0.42; // a pause longer than this inside a beat is cut out (jump cut)
const LEAD = 0.07; // breath before the first word of a piece
const TAIL = 0.14; // after the last word
const MAX_SPOKEN = 58; // seconds — Instagram's sweet spot is well under a minute
const END_SEC = 2.2;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const str = (v, max = 400) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

const agent = () => require('./captureReelAgent');

// ── phrases: a spoken take broken where the speaker breathes or ends a clause ──
function phrasesOf(asset) {
  const ws = (asset.words || []).filter((w) => w.end > w.start || w.text);
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  ws.forEach((w, i) => {
    cur.push(w);
    const next = ws[i + 1];
    const gap = next ? next.start - w.end : 99;
    const stop = /[.?!;:,]$/.test(w.text);
    if (gap >= 0.28 || (stop && cur.length >= 3) || cur.length >= 12) flush();
  });
  flush();
  return out.map((p, i) => ({
    id: `${asset.id}.p${i}`,
    index: i,
    words: p,
    text: p.map((w) => w.text).join(' '),
    start: p[0].start,
    end: p[p.length - 1].end,
  }));
}

// ── the edit decision tool ─────────────────────────────────────────────────
const o = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const EDIT_TOOL = {
  name: 'edit_talking_reel',
  description: 'The edit of a talking reel: ordered beats over the spoken takes, B-roll cutaways, hook, end card.',
  input_schema: o({
    concept: { type: 'string' },
    hook: o({ text: { type: 'string' }, emphasis: { type: 'string' } }),
    beats: {
      type: 'array',
      minItems: 1,
      maxItems: 24,
      items: o({
        clip: { type: 'string' },
        from: { type: 'integer' },
        to: { type: 'integer' },
        show: { type: 'string', enum: ['speaker', 'broll'] },
        zoom: { type: 'string', enum: ['wide', 'medium', 'close'] },
        brollFrom: { type: 'string', enum: ['start', 'middle'] },
        broll: {
          type: 'array',
          maxItems: 3,
          items: o({
            assetId: { type: 'string' },
            startSec: { type: 'number' },
            motion: { type: 'string', enum: MOTIONS },
            focusX: { type: 'number' },
            focusY: { type: 'number' },
          }),
        },
        label: { type: 'string' },
      }),
    },
    endAssetId: { type: 'string' },
    cta: o({ line: { type: 'string' }, sub: { type: 'string' } }),
    music: o({ mood: { type: 'string' }, genre: { type: 'string' }, bpm: { type: 'number' } }),
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  }),
};

function materialForPrompt(material, phrasesByClip) {
  return material.assets.map((a) => {
    const base = {
      id: a.id,
      type: a.kind === 'image' ? 'photo' : 'clip',
      ...(a.take ? { take: a.take } : {}),
      ...(a.pool ? { pool: a.pool } : {}),
      summary: a.summary,
      ...(a.kind === 'image' && a.subjects?.length ? { subjects: a.subjects } : {}),
      ...(a.kind === 'video' ? { durationSec: Math.round(a.durationSec * 10) / 10 } : {}),
    };
    const ph = phrasesByClip.get(a.id);
    if (ph?.length) {
      base.phrases = ph.map((p) => ({ id: p.id, sec: Math.round((p.end - p.start) * 10) / 10, words: p.text }));
    } else if (a.kind === 'video') {
      base.stills = (a.stills || []).slice(0, 4).map((s) => ({ t: s.t, summary: s.summary }));
    }
    return base;
  });
}

async function callEditor({ format, story, material, phrasesByClip, brand, handle, extra = '' }) {
  const system = `${read('dialogue-base.md')}\n\n${read(FORMAT_FILE[format])}`;
  const user = [
    `STUDIO: ${handle ? `@${handle}` : '(no handle)'}`,
    `BRAND: ${JSON.stringify(brand || {})}`,
    `STORY PLAN:\n${JSON.stringify({
      title: story.title, format: story.format,
      sequences: story.sequences.map((s, i) => ({ n: i + 1, title: s.title, role: s.role, shot: s.shot, say: s.say, onScreenText: s.onScreenText, brollToShow: s.broll || '', seconds: s.targetSec })),
    }, null, 2)}`,
    `MATERIAL (TAKES with phrases, B-ROLL):\n${JSON.stringify(materialForPrompt(material, phrasesByClip), null, 2)}`,
    extra,
  ].filter(Boolean).join('\n\n');
  const images = await agent()._visionParts(material.assets);
  const llm = resolvePlanAgentLlm('captureReel');
  const started = Date.now();
  const res = await completeToolCall({
    model: llm.model,
    system,
    userParts: [...images, { type: 'text', text: user }],
    tool: EDIT_TOOL,
    maxTokens: 12000,
    kind: 'captureReel',
    timeoutMs: 240000,
    retryHint: 'Return ONLY the JSON object for edit_talking_reel, matching the schema exactly.',
  });
  const u = res.usage || {};
  const costUsd = estimatePlanCostUsd(res.model, num(u.input_tokens), num(u.output_tokens), num(u.cached_tokens));
  return {
    raw: res.parsed,
    model: res.model,
    debug: {
      source: `Capture reel — ${format} editor`,
      model: res.model,
      prompt: `${system}\n\n---\n\n${user}\n\n[${images.filter((x) => x.type === 'image').length} image(s) attached]`,
      output: JSON.stringify(res.parsed, null, 2),
      elapsedMs: Date.now() - started,
      inputTokens: num(u.input_tokens),
      outputTokens: num(u.output_tokens),
      costUsd,
    },
  };
}

// ── validate the edit into pieces on an output clock ──────────────────────
function cutEdit({ raw, format, material, phrasesByClip, fps }) {
  const byId = new Map(material.assets.map((a) => [a.id, a]));
  const frames = (s) => Math.max(0, Math.round(s * fps));
  const used = new Set();
  const warnings = [];
  const isFace = (a) => a?.take?.role === 'speaking' || (a?.kind === 'video' && phrasesByClip.get(a.id)?.length);
  // what may be cut away to: photos, B-roll takes, library media, clips without speech
  const brollOk = (a) => a && !(a.take?.role === 'speaking') && !(phrasesByClip.get(a.id)?.length && !a.take);
  const pool = material.assets.filter(brollOk);

  const beats = [];
  let spoken = 0;
  for (const b of Array.isArray(raw?.beats) ? raw.beats : []) {
    const clip = byId.get(str(b?.clip, 12));
    const ph = clip ? phrasesByClip.get(clip.id) : null;
    if (!ph?.length) continue;
    let from = clampN(Math.round(num(b.from)), 0, ph.length - 1);
    let to = clampN(Math.round(num(b.to, from)), 0, ph.length - 1);
    if (to < from) [from, to] = [to, from];
    const chosen = ph.slice(from, to + 1).filter((p) => !used.has(p.id));
    if (!chosen.length) continue;
    chosen.forEach((p) => used.add(p.id));
    // pieces = contiguous runs of words: a new piece at a long pause, or where
    // a phrase in between was dropped (already used / skipped by the editor)
    const pieces = [];
    let cur = [];
    let prevIndex = -2;
    chosen.forEach((p) => {
      p.words.forEach((w, wi) => {
        const last = cur[cur.length - 1];
        const jump = wi === 0 && p.index !== prevIndex + 1;
        if (last && (jump || w.start - last.end > GAP_SPLIT)) { pieces.push(cur); cur = []; }
        cur.push(w);
      });
      prevIndex = p.index;
    });
    if (cur.length) pieces.push(cur);
    const cut = pieces.map((pw) => {
      const start = Math.max(0, pw[0].start - LEAD);
      const end = Math.min(clip.durationSec - 0.02, pw[pw.length - 1].end + TAIL);
      const len = frames(end - start);
      return len >= 4 ? { clip, start, frames: len, words: pw } : null;
    }).filter(Boolean);
    if (!cut.length) continue;
    const beatSec = cut.reduce((n, c) => n + c.frames / fps, 0);
    if (spoken + beatSec > MAX_SPOKEN && beats.length >= 2) { warnings.push('trimmed to under a minute'); break; }
    spoken += beatSec;
    const broll = (Array.isArray(b.broll) ? b.broll : []).map((x) => {
      const a = byId.get(str(x?.assetId, 12));
      if (!brollOk(a)) return null;
      return {
        asset: a,
        startSec: a.kind === 'video' ? clampN(num(x.startSec), 0, Math.max(0, a.durationSec - 0.5)) : 0,
        motion: MOTIONS.includes(x.motion) ? x.motion : (a.kind === 'video' ? 'none' : 'push-in'),
        focusX: Math.round(clampN(num(x.focusX, 50), 0, 100)),
        focusY: Math.round(clampN(num(x.focusY, 45), 0, 100)),
      };
    }).filter(Boolean).slice(0, 3);
    let show = b.show === 'broll' ? 'broll' : 'speaker';
    // a face never shows in a faceless reel; a speaker shot with no B-roll is filled from the pool
    if (format === 'faceless_voiceover' && show === 'speaker' && isFace(clip) && !/room|space|kitchen|bath|interior|floor|wall|ceiling/i.test(`${clip.summary} ${clip.description}`)) {
      show = 'broll';
    }
    beats.push({
      cut,
      show,
      zoom: ZOOM[b.zoom] || 1,
      brollFrom: b.brollFrom === 'start' ? 'start' : 'middle',
      broll,
      label: str(b.label, 28).split(' ').slice(0, 3).join(' '),
    });
  }
  if (!beats.length) throw new Error('The editor returned no usable spoken beats.');

  // the hook is a face (talking formats): no cutaway in its first 1.5 s
  if (format !== 'faceless_voiceover') {
    beats[0].show = 'speaker';
    beats[0].brollFrom = 'middle';
    beats[0].label = '';
  }
  return { beats, pool, warnings, byId };
}

/* Fill any beat that must show B-roll but got none, and lift B-roll coverage
   for Talking head + B-roll to the format's floor, from the unused pool. */
function ensureBroll({ beats, pool, format, fps }) {
  if (!pool.length || format === 'talking_head') return;
  const usage = new Map(pool.map((a) => [a.id, 0]));
  beats.forEach((b) => b.broll.forEach((x) => usage.set(x.asset.id, (usage.get(x.asset.id) || 0) + 1)));
  const nextAsset = (avoid) => pool.slice().sort((a, b) => (usage.get(a.id) - usage.get(b.id)) || (a.pool === 'library') - (b.pool === 'library'))
    .find((a) => a.id !== avoid) || pool[0];
  const take = (avoid) => {
    const a = nextAsset(avoid);
    usage.set(a.id, (usage.get(a.id) || 0) + 1);
    return { asset: a, startSec: 0, motion: a.kind === 'video' ? 'none' : ['push-in', 'pan-left', 'pull-out', 'pan-right'][usage.get(a.id) % 4], focusX: 50, focusY: 45 };
  };
  const secOf = (b) => b.cut.reduce((n, c) => n + c.frames / fps, 0);
  beats.forEach((b) => {
    if (b.show === 'broll' && !b.broll.length) {
      const n = Math.max(1, Math.min(3, Math.round(secOf(b) / 2.5)));
      for (let i = 0; i < n; i += 1) b.broll.push(take(b.broll[i - 1]?.asset.id));
    }
  });
  if (format !== 'talking_head_broll') return;
  const total = beats.reduce((n, b) => n + secOf(b), 0);
  const covered = () => beats.reduce((n, b, i) => {
    if (!b.broll.length) return n;
    const s = secOf(b);
    return n + (b.show === 'broll' || b.brollFrom === 'start' ? s : Math.max(0, s - Math.max(1.2, s * 0.4)) - (i === 0 ? 0.3 : 0));
  }, 0);
  // longest speaker-only beats after the hook get a cutaway on their second half
  const candidates = beats.map((b, i) => ({ b, i, s: secOf(b) }))
    .filter(({ b, i, s }) => i > 0 && b.show === 'speaker' && !b.broll.length && s >= 2.2)
    .sort((x, y) => y.s - x.s);
  for (const { b, s } of candidates) {
    if (covered() / total >= 0.45) break;
    b.brollFrom = 'middle';
    const n = s > 6 ? 2 : 1;
    for (let k = 0; k < n; k += 1) b.broll.push(take(b.broll[k - 1]?.asset.id));
  }
  // the hook beat itself may cut away only after 1.5 s, and only if long
  if (covered() / total < 0.3 && beats[0] && !beats[0].broll.length && secOf(beats[0]) > 4) beats[0].broll.push(take());
}

// ── dialogue track: the chosen pieces, back to back, levelled ─────────────
async function buildDialogueAudio(pieces, fps) {
  const { _clipFile, _ffmpegPath } = agent();
  const files = [];
  const index = new Map();
  for (const p of pieces) {
    if (!index.has(p.clip.key)) {
      // eslint-disable-next-line no-await-in-loop
      files.push(await _clipFile(p.clip.key));
      index.set(p.clip.key, files.length - 1);
    }
  }
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reeldlg-'));
  const out = path.join(dir, 'dialogue.m4a');
  const parts = pieces.map((p, i) => {
    const dur = p.frames / fps;
    const fade = Math.min(0.03, dur / 4).toFixed(3);
    return `[${index.get(p.clip.key)}:a]atrim=start=${p.start.toFixed(3)}:duration=${dur.toFixed(4)},asetpts=PTS-STARTPTS,`
      + `aresample=48000,aformat=channel_layouts=mono,afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, dur - Number(fade)).toFixed(4)}:d=${fade},apad=whole_dur=${dur.toFixed(4)}[a${i}]`;
  });
  const filter = `${parts.join(';')};${pieces.map((_, i) => `[a${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1,`
    + 'highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=8:release=120,loudnorm=I=-15:TP=-1.5:LRA=9,aresample=48000[out]';
  try {
    await run(_ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      ...files.flatMap((f) => ['-i', f]), '-filter_complex', filter, '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', out],
    { maxBuffer: 1 << 24, timeout: 180000 });
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * A talking reel's director: the edit (one model call) → plan + a timeline
 * builder the pipeline calls once the music bed is ready.
 */
async function directDialogueReel({ reel, material, story, brand, handle }) {
  const fps = agent().FPS;
  const format = story.format;
  const phrasesByClip = new Map();
  material.assets.forEach((a) => {
    if (a.kind === 'video' && a.words?.length) phrasesByClip.set(a.id, phrasesOf(a));
  });
  if (!phrasesByClip.size) return null;

  let edit = await callEditor({ format, story, material, phrasesByClip, brand, handle });
  const debugRows = [edit.debug];
  let cut;
  try {
    cut = cutEdit({ raw: edit.raw, format, material, phrasesByClip, fps });
  } catch (err) {
    // one repair round with the reason
    edit = await callEditor({
      format, story, material, phrasesByClip, brand, handle,
      extra: `Your previous edit could not be used: ${err.message} Use only clip ids that have phrases, and phrase indices that exist.`,
    });
    debugRows.push(edit.debug);
    cut = cutEdit({ raw: edit.raw, format, material, phrasesByClip, fps });
  }
  ensureBroll({ beats: cut.beats, pool: cut.pool, format, fps });

  const raw = edit.raw || {};
  const hookText = words(str(raw.hook?.text, 80)).slice(0, 7).join(' ');
  const emph = str(raw.hook?.emphasis, 30);
  const hashtags = [...new Set((Array.isArray(raw.hashtags) ? raw.hashtags : [])
    .map((h) => str(h, 40).replace(/\s+/g, '')).map((h) => (h.startsWith('#') ? h : `#${h}`))
    .filter((h) => /^#[\p{L}\p{N}_]{2,}$/u.test(h)))].slice(0, 8);
  const endAsset = cut.byId.get(str(raw.endAssetId, 12));
  const m = raw.music || {};
  const plan = {
    concept: str(raw.concept, 400),
    format,
    audioMode: 'dialogue',
    hook: { text: hookText, emphasis: words(hookText).some((w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') === emph.toLowerCase()) ? emph : '' },
    beats: cut.beats.map((b) => ({
      clip: b.cut[0].clip.id,
      show: b.show,
      zoom: b.zoom,
      label: b.label,
      seconds: Math.round(b.cut.reduce((n, c) => n + c.frames / fps, 0) * 10) / 10,
      said: b.cut.flatMap((c) => c.words.map((w) => w.text)).join(' '),
      broll: b.broll.map((x) => x.asset.id),
    })),
    cta: { line: words(str(raw.cta?.line, 60)).slice(0, 8).join(' '), sub: str(raw.cta?.sub, 30) },
    caption: str(raw.caption, 2200) || story.caption || '',
    hashtags,
    warnings: cut.warnings,
    // the poster: the hook beat's face
    coverShotIndex: 0,
  };
  // the look: a styled reel (slam hook, karaoke captions, pill labels, end card)
  const style = {
    name: format,
    audio: {
      mode: 'voiceover',
      music: {
        mood: str(m.mood, 40) || 'warm, understated',
        genre: str(m.genre, 60) || 'soft modern instrumental',
        bpm: clampN(Math.round(num(m.bpm, 92)), 70, 110),
      },
    },
    hook: { treatment: 'slam' },
    text: { overlay: 'pill', textCase: 'sentence', font: 'sans-bold', color: '#FFFFFF', position: 'top' },
    captions: 'karaoke',
    cta: { endCard: 'card' },
    visuals: { grade: 'clean' },
  };

  const build = async ({ brandKit, music }) => {
    const { _imageSrc, _letterboxOf, _stillNear, captionCues, liftAccent, _luminance } = agent();
    const frames = (s) => Math.max(0, Math.round(s * fps));
    const pieces = cut.beats.flatMap((b) => b.cut);
    const audio = await buildDialogueAudio(pieces, fps);
    const voiceKey = `projects/${reel.user}/reel-${reel._id}-dialogue.m4a`;
    await uploadBytes(voiceKey, audio, 'audio/mp4', { immutable: true });
    const voiceUrl = await getMediaUrl(voiceKey);

    const speaker = [];
    const cutaways = [];
    const captionWords = [];
    let at = 0; // output frame
    let lastZoom = 0;
    for (let bi = 0; bi < cut.beats.length; bi += 1) {
      const b = cut.beats[bi];
      const b0 = at;
      for (let pi = 0; pi < b.cut.length; pi += 1) {
        const p = b.cut[pi];
        // consecutive pieces of one take alternate framing: a jump cut reads as a new angle
        let zoom = pi % 2 === 0 ? b.zoom : (b.zoom >= ZOOM.medium ? ZOOM.wide : ZOOM.medium);
        if (pi === 0 && zoom === lastZoom && bi > 0) zoom = zoom === ZOOM.wide ? ZOOM.medium : ZOOM.wide;
        lastZoom = zoom;
        // eslint-disable-next-line no-await-in-loop
        const crop = p.clip.take?.role === 'speaking' ? null : await _letterboxOf(p.clip.key, p.start, p.frames / fps).catch(() => null);
        speaker.push({
          from: at,
          durationInFrames: p.frames,
          kind: 'video',
          src: await getMediaUrl(p.clip.key), // eslint-disable-line no-await-in-loop
          sourceStartSec: Math.round(p.start * 1000) / 1000,
          volume: 0, // the sound is the dialogue track
          motion: 'none',
          transition: 'cut',
          focusX: 50,
          focusY: 38,
          zoom,
          ...(pi === 0 && b.label ? { overlayText: b.label } : {}),
          ...(crop ? { crop } : {}),
        });
        p.words.forEach((w) => captionWords.push({ text: w.text, start: at / fps + (w.start - p.start), end: at / fps + (w.end - p.start) }));
        at += p.frames;
      }
      // B-roll over this beat (picture only — the voice runs on)
      if (b.broll.length) {
        const len = at - b0;
        // talking formats open on the face; a faceless reel never shows it
        const hookHold = bi === 0 && format !== 'faceless_voiceover' ? frames(1.5) : 0;
        const startOff = b.show === 'broll' || b.brollFrom === 'start' ? hookHold : Math.max(hookHold, frames(Math.max(1.0, (len / fps) * 0.4)));
        const span = len - startOff;
        if (span >= frames(0.8)) {
          const each = Math.floor(span / b.broll.length);
          for (let k = 0; k < b.broll.length; k += 1) {
            const x = b.broll[k];
            const from = b0 + startOff + k * each;
            const dur = k === b.broll.length - 1 ? b0 + len - from : each;
            const base = {
              from, durationInFrames: dur, motion: x.motion, transition: k === 0 ? 'cut' : 'cut',
              focusX: x.focusX, focusY: x.focusY,
              ...(x.asset.width && x.asset.height ? { srcW: x.asset.width, srcH: x.asset.height } : {}),
            };
            if (x.asset.kind === 'image') {
              // eslint-disable-next-line no-await-in-loop
              cutaways.push({ ...base, kind: 'image', src: await _imageSrc(x.asset.key, 'clean'), graded: true, motion: x.motion === 'none' ? 'push-in' : x.motion });
            } else {
              const need = dur / fps;
              let start = x.startSec;
              let rate = 1;
              if (x.asset.durationSec - start < need) start = Math.max(0, x.asset.durationSec - need);
              if (x.asset.durationSec < need) rate = clampN(x.asset.durationSec / need, 0.6, 1); // gentle slow-mo to fill
              if (x.asset.durationSec / rate < need - 0.05) {
                const near = _stillNear(x.asset, start);
                // eslint-disable-next-line no-await-in-loop
                if (near) cutaways.push({ ...base, kind: 'image', src: await _imageSrc(near.key, 'clean'), graded: true, motion: 'push-in' });
                continue;
              }
              // eslint-disable-next-line no-await-in-loop
              const crop = await _letterboxOf(x.asset.key, start, need).catch(() => null);
              cutaways.push({
                ...base, kind: 'video', src: await getMediaUrl(x.asset.key), // eslint-disable-line no-await-in-loop
                sourceStartSec: Math.round(start * 1000) / 1000, volume: 0, ...(rate < 1 ? { playbackRate: Math.round(rate * 100) / 100 } : {}),
                ...(crop ? { crop } : {}),
              });
            }
          }
        }
      }
    }
    const spokenEnd = at;
    // end card: the best finished shot (or the last face, held) behind the CTA
    const hasCta = Boolean(plan.cta.line);
    const endFrames = hasCta ? frames(END_SEC) : frames(0.4);
    // not the photo the last cutaway just showed (the end card would look like a freeze)
    const lastShown = cut.beats[cut.beats.length - 1]?.broll.slice(-1)[0]?.asset.key || '';
    const images = cut.pool.filter((a) => a.kind === 'image');
    const endKey = (endAsset?.kind === 'image' && endAsset.key !== lastShown ? endAsset.key : '')
      || (images.find((a) => a.key !== lastShown && a.pool !== 'library') || images.find((a) => a.key !== lastShown) || images[0])?.key || '';
    if (endKey) {
      cutaways.push({ from: spokenEnd, durationInFrames: endFrames, kind: 'image', src: await _imageSrc(endKey, 'clean'), graded: true, motion: 'pull-out', transition: 'zoom', focusX: 50, focusY: 45 });
    } else if (speaker.length) {
      speaker[speaker.length - 1].durationInFrames += endFrames;
    }
    const total = spokenEnd + endFrames;
    const accent = liftAccent(brandKit.accent || '#FFFFFF');
    const hookFrames = frames(clampN(0.6 + words(plan.hook.text).length * 0.22, 1.3, 2.2));
    const look = { ...require('./reelStyleRun').lookOf(style), progress: true };
    return {
      voiceKey,
      timeline: {
        format: { width: 1080, height: 1920, fps, durationInFrames: total },
        brand: {
          accent,
          accentInk: _luminance(accent) > 0.45 ? '#111111' : '#FFFFFF',
          headlineFont: brandKit.headlineFont || '',
          bodyFont: brandKit.bodyFont || '',
        },
        ...(plan.hook.text ? { hook: { text: plan.hook.text, emphasis: plan.hook.emphasis, durationInFrames: hookFrames } } : {}),
        // speaker shots first, cutaways after: later scenes draw on top
        scenes: [...speaker, ...cutaways],
        captions: captionCues(captionWords.filter((w) => w.start < spokenEnd / fps)),
        ...(hasCta ? { cta: { line: plan.cta.line, sub: plan.cta.sub, fromFrame: spokenEnd, durationInFrames: endFrames } } : {}),
        audio: { voiceoverSrc: voiceUrl, voiceVolume: 1, startFrame: 0 },
        look,
      },
      stats: {
        spokenSec: Math.round((spokenEnd / fps) * 10) / 10,
        brollShare: Math.round((cutaways.filter((c) => c.from < spokenEnd).reduce((n, c) => n + Math.min(c.durationInFrames, spokenEnd - c.from), 0) / Math.max(1, spokenEnd)) * 100),
        pieces: pieces.length,
      },
    };
  };

  return { plan, style, model: edit.model, debugRows, build };
}

// ── Faceless · Text: a story told in lines over footage, cut to music ──────
async function directFacelessText({ material, story, brand, handle, directReel }) {
  const style = {
    name: 'Faceless · Text',
    summary: 'Story reel: one short readable line per shot over project footage, original music bed, cuts on the beat.',
    audio: { mode: 'music', music: { mood: 'warm, confident', genre: 'modern minimal instrumental with a soft pulse', bpm: 100 } },
    pacing: { hookHoldSec: 1.9, shotSec: 2.2, beatSync: true, targetLengthSec: clampN((story.estimatedSec?.[1] || 20), 12, 30) },
    hook: { treatment: 'slam' },
    text: { overlay: 'bold-sans', perShot: 'every-shot', textCase: 'sentence', font: 'sans-bold', color: '#FFFFFF', position: 'center', kinetic: true },
    captions: 'none',
    chapters: { numbered: false, card: 'none' },
    cta: { endCard: 'card' },
    visuals: { grade: 'clean' },
    directorNotes: 'Every shot carries one line of the story plan. Readable, not decorative.',
  };
  const direction = `STORY PLAN (tell exactly this story, in this order):\n${JSON.stringify(story.sequences.map((s, i) => ({
    n: i + 1, role: s.role, line: s.onScreenText || s.say, seconds: s.targetSec,
  })), null, 2)}`;
  const directed = await directReel({ material, handle, brand, direction, style, extraRules: read('faceless-text.md') });
  // reading time: N words need ≥ 0.9 s + 0.3 s each
  directed.plan.scenes.forEach((s, i) => {
    const n = words(String(s.overlayText || '').replace(/\|/g, ' ')).length;
    if (n) s.durationSec = Math.max(s.durationSec, Math.min(5.5, 0.9 + 0.3 * n + (i === 0 ? 0.4 : 0)));
  });
  directed.plan.format = 'faceless_text';
  return { ...directed, style };
}

module.exports = {
  DIALOGUE_FORMATS,
  directDialogueReel,
  directFacelessText,
  // exported for tests
  phrasesOf,
  cutEdit,
  ensureBroll,
  buildDialogueAudio,
  EDIT_TOOL,
};
