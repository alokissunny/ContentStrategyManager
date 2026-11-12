/*
 * Generating a capture reel IN a reference reel's style (ReelStyle).
 *
 *   styleBriefOf()   the style as the director reads it
 *   lookOf()         the style as the CaptureReel composition draws it (reel.look)
 *   generateMusic()  an ORIGINAL instrumental bed in the style's spirit (Lyria);
 *                    the reference's own audio is never used
 *   fitMusic()       trimmed + faded to the reel, uploaded
 *   snapToBeats()    music-led cuts land on the beat
 *   splitFastShots() fast styles: a long narrated shot becomes several quick ones
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { beatsOf } = require('./audioBeats');

const run = promisify(execFile);
const ffmpegPath = () => process.env.FFMPEG_PATH || require('ffmpeg-static');
const LYRIA_MODEL = () => process.env.REEL_MUSIC_MODEL || 'lyria-3.5';
// Lyria pricing is per generated track; keep the estimate configurable
const LYRIA_USD_PER_TRACK = () => Number(process.env.REEL_MUSIC_USD_PER_TRACK) || 0.06;

function styleBriefOf(style) {
  const s = style || {};
  return {
    name: s.name,
    summary: s.summary,
    audio: s.audio,
    pacing: s.pacing,
    hook: s.hook,
    text: s.text,
    captions: s.captions,
    chapters: s.chapters,
    structure: s.structure,
    cta: s.cta,
    visuals: s.visuals,
    directorNotes: s.directorNotes,
  };
}

const pick = (v, list, d) => (list.includes(v) ? v : d);

function lookOf(style) {
  const s = style || {};
  const t = s.text || {};
  const music = s.audio?.mode === 'music';
  return {
    overlay: pick(t.overlay, ['serif-stack', 'serif-center', 'serif-accent', 'two-weight', 'bold-sans', 'pill', 'none'], 'serif-center'),
    hook: pick(s.hook?.treatment, ['stack-repeat', 'serif-center', 'listicle', 'two-weight', 'slam'], 'serif-center'),
    captions: music ? 'none' : pick(s.captions, ['subtitle', 'two-weight', 'karaoke', 'none'], 'subtitle'),
    font: pick(t.font, ['condensed-serif', 'serif', 'serif-italic', 'sans', 'sans-bold'], 'serif'),
    textCase: pick(t.textCase, ['upper', 'lower', 'sentence'], 'sentence'),
    captionCase: t.textCase === 'lower' ? 'lower' : 'sentence',
    color: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#FFFFFF',
    captionColor: /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '#FFFFFF',
    position: pick(t.position, ['top', 'center', 'lower'], 'center'),
    grade: pick(s.visuals?.grade, ['warm', 'neutral', 'bright', 'cool'], 'neutral'),
    endCard: pick(s.cta?.endCard, ['card', 'text-on-shot', 'none'], 'text-on-shot'),
    progress: false,
  };
}

/** An original instrumental for the style (Lyria via the Gemini API). */
async function generateMusic(style) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set — no music bed');
  const m = style?.audio?.music || {};
  const bpm = Math.round(Number(m.bpm) || 110);
  const underVoice = style?.audio?.mode !== 'music';
  const prompt = [
    m.prompt || `${m.mood || 'warm'} ${m.genre || 'instrumental'} track`,
    `Tempo ${bpm} BPM, steady and clear.`,
    'Instrumental only, no vocals, no spoken words.',
    underVoice ? 'Sparse and quiet enough to sit under a voiceover.' : 'Strong, clean beat a video can cut to; energetic from the first second.',
    'For an Instagram Reel about interior design and architecture. 45 seconds.',
  ].join(' ');
  const started = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${LYRIA_MODEL()}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(150000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Music generation failed (${res.status}): ${json.error?.message || ''}`.trim());
  const part = (json.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) throw new Error('Music generation returned no audio');
  const mp3 = Buffer.from(part.inlineData.data, 'base64');
  const beats = await beatsOf(mp3).catch(() => null);
  return {
    mp3, beats, prompt, model: LYRIA_MODEL(), elapsedMs: Date.now() - started, costUsd: LYRIA_USD_PER_TRACK(),
  };
}

/** The bed cut to the reel's length with a short fade in/out, as an mp3 buffer. */
async function fitMusic(mp3, totalSec) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reelmusic-'));
  try {
    const src = path.join(dir, 'in.mp3');
    const out = path.join(dir, 'out.mp3');
    await fs.promises.writeFile(src, mp3);
    const fadeOut = Math.min(1.5, totalSec / 4);
    await run(ffmpegPath(), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-t', String(totalSec),
      '-af', `afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, totalSec - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`,
      '-b:a', '192k', out], { timeout: 60000 });
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Music-led reels: move each cut to the nearest beat (or half-beat for quick
 * styles) so the picture changes on the music. `shots` = [{start, dur}],
 * sequential; returns new [{start, dur}] keeping order and a minimum length.
 */
function snapToBeats(shots, beats, { shotSec = 1, minSec = 0.35 } = {}) {
  if (!beats?.beats?.length || shots.length < 2) return shots;
  const period = 60 / (beats.bpm || 120);
  const step = shotSec < period * 0.8 ? period / 2 : period;
  const grid = [];
  for (let t = beats.beats[0]; t < (shots[shots.length - 1].start + shots[shots.length - 1].dur) + period; t += step) grid.push(t);
  const bounds = shots.map((s) => s.start + s.dur);
  const out = [];
  let prev = 0;
  bounds.forEach((b, i) => {
    let at = b;
    if (i < bounds.length - 1) {
      const near = grid.reduce((best, g) => (Math.abs(g - b) < Math.abs(best - b) ? g : best), grid[0]);
      at = Math.max(prev + minSec, near);
    }
    out.push({ start: prev, dur: at - prev });
    prev = at;
  });
  return out;
}

/**
 * Fast narrated styles (~1 s cuts): a shot whose line runs much longer than
 * the style's shot length is split into several, alternating its own asset
 * with others from the capture (each with its own crop and move). Only the
 * first piece keeps the shot's on-screen words, unless the style puts words
 * on every shot.
 */
function splitFastShots(shots, { shotSec, assets, hookHoldSec = 0, everyShot = false }) {
  if (!(shotSec > 0 && shotSec < 1.5)) return shots;
  const pool = assets.filter((a) => a.kind === 'image' || a.kind === 'video');
  if (!pool.length) return shots;
  let rot = 0;
  const moves = ['push-in', 'pan-left', 'pull-out', 'pan-right', 'pan-up'];
  const out = [];
  shots.forEach((sh, idx) => {
    // the opener is held while the hook lands (pacing.hookHoldSec) — only the
    // time past that hold is cut up
    if (idx === 0 && hookHoldSec > 0 && sh.dur > hookHoldSec + shotSec * 1.8) {
      out.push({ ...sh, dur: hookHoldSec });
      sh = { ...sh, start: sh.start + hookHoldSec, dur: sh.dur - hookHoldSec, scene: { ...sh.scene, overlayText: everyShot ? sh.scene.overlayText : '', transition: 'cut' } };
    } else if (idx === 0) { out.push(sh); return; }
    if (sh.scene.card || sh.dur < shotSec * 1.8) { out.push(sh); return; }
    const n = Math.min(6, Math.max(2, Math.round(sh.dur / shotSec)));
    const len = sh.dur / n;
    for (let i = 0; i < n; i += 1) {
      let scene = sh.scene;
      if (i > 0) {
        const other = i % 2 === 1 ? pool[(rot++) % pool.length] : null;
        const a = other && other.id !== sh.scene.assetId ? other : null;
        scene = {
          ...sh.scene,
          ...(a ? { assetId: a.id, startSec: 0 } : { startSec: sh.scene.startSec + i * len }),
          // a style with words on every shot (e.g. one repeated word) keeps them
          overlayText: everyShot ? sh.scene.overlayText : '',
          motion: moves[(i + rot) % moves.length],
          transition: 'cut',
          focusX: 30 + ((i * 37) % 40),
          focusY: 35 + ((i * 23) % 30),
        };
      }
      out.push({ ...sh, scene, start: sh.start + i * len, dur: len });
    }
  });
  return out;
}

module.exports = { styleBriefOf, lookOf, generateMusic, fitMusic, snapToBeats, splitFastShots };
