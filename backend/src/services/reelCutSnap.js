/*
 * Cut accuracy (studio, 2026-11-23): "the video is sometimes cut before the word is finished".
 *
 * Every cut of a talking reel was placed on Whisper's word timings (start − 0.07 s, end + 0.1 s). Measured
 * on the studio's takes, those timings drift: the voice often starts 0.1–0.4 s before the transcribed
 * start (first syllable clipped) and runs on 0.3–1.2 s past the transcribed end of a phrase (last word
 * cut off). So every piece's in and out points are snapped to the SOUND of its own recording:
 *
 *   out — from the transcribed end, forward to where the voice really falls silent (60 ms below the
 *         take's speech threshold), + a short tail; never into the next spoken word. When the voice
 *         does not stop within 0.7 s (a word Whisper missed, or continuous speech), the cut goes on the
 *         deepest dip of the envelope in that window — between syllables, not through one.
 *   in  — from the transcribed start, back to where the voice really begins, − a short lead; never
 *         into the previous word.
 *
 * The take's envelope: 10 ms RMS (dB) of the mono 16 kHz audio; speech threshold = max(noise floor
 * + 8 dB, speech level − 28 dB), from the take's own 10th / 90th percentiles.
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);
const HOP = 0.01; // s per envelope step
const QUIET_RUN = 6; // steps (60 ms) below the threshold = silence
const OUT_SEARCH = 0.7; // s past the transcribed end
const IN_SEARCH = 0.45; // s before the transcribed start
const OUT_TAIL = 0.06; // s kept after the voice stops (breath/decay)
const IN_LEAD = 0.05; // s kept before the voice starts

const envCache = new Map();
async function envelopeOf(key, { clipFile, ffmpegPath }) {
  if (!envCache.has(key)) {
    envCache.set(key, (async () => {
      const file = await clipFile(key);
      const { stdout } = await run(ffmpegPath(), ['-nostdin', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
        { encoding: 'buffer', maxBuffer: 1 << 28, timeout: 120000 });
      const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2));
      const hop = 160;
      const env = new Float32Array(Math.floor(pcm.length / hop));
      for (let f = 0; f < env.length; f += 1) {
        let s = 0;
        for (let j = f * hop; j < (f + 1) * hop; j += 1) s += pcm[j] * pcm[j];
        env[f] = 20 * Math.log10(Math.sqrt(s / hop) / 32768 + 1e-9);
      }
      const sorted = Array.from(env).sort((x, y) => x - y);
      const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
      const speech = sorted[Math.floor(sorted.length * 0.9)] ?? -20;
      return { env, thr: Math.max(floor + 8, speech - 28) };
    })().catch(() => null));
    if (envCache.size > 60) envCache.delete(envCache.keys().next().value);
  }
  return envCache.get(key);
}

const idx = (t, n) => Math.max(0, Math.min(n - 1, Math.round(t / HOP)));

/* where the voice really stops after `end` (bounded by `limit`), or null */
function trueEnd(e, end, limit) {
  const { env, thr } = e;
  const a = idx(end - 0.12, env.length);
  const b = idx(Math.min(limit, end + OUT_SEARCH), env.length);
  let quiet = 0;
  for (let k = a; k <= b; k += 1) {
    quiet = env[k] < thr ? quiet + 1 : 0;
    if (quiet >= QUIET_RUN) return (k - QUIET_RUN + 1) * HOP;
  }
  return null;
}
/* the deepest dip of the envelope in [a, b] (a cut between syllables) */
function deepestDip(e, a, b) {
  const { env } = e;
  let best = idx(a, env.length);
  for (let k = idx(a, env.length); k <= idx(b, env.length); k += 1) {
    // a 30 ms average, so one quiet sample inside a vowel is not a "dip"
    const v = (env[k - 1] ?? env[k]) + env[k] + (env[k + 1] ?? env[k]);
    const w = (env[best - 1] ?? env[best]) + env[best] + (env[best + 1] ?? env[best]);
    if (v < w) best = k;
  }
  return best * HOP;
}
/* where the voice really begins before `start` (bounded by `limit`) */
function trueStart(e, start, limit) {
  const { env, thr } = e;
  const a = idx(start + 0.12, env.length);
  const b = idx(Math.max(limit, start - IN_SEARCH, 0), env.length);
  let quiet = 0;
  for (let k = a; k >= b; k -= 1) {
    quiet = env[k] < thr ? quiet + 1 : 0;
    if (quiet >= QUIET_RUN) return (k + QUIET_RUN) * HOP;
  }
  return null;
}

/**
 * beats: [{ cut: [{ clip, start, frames, words }] }] — pieces are re-timed in place.
 * Returns a summary of what moved.
 */
async function snapCuts(beats, { fps, helpers }) {
  const summary = { pieces: 0, endsExtended: 0, startsEarlier: 0, dipCuts: 0, maxExtendSec: 0 };
  for (const b of beats) {
    for (const c of b.cut) {
      // eslint-disable-next-line no-await-in-loop
      const e = await envelopeOf(c.clip.key, helpers);
      if (!e || !c.words?.length) continue;
      summary.pieces += 1;
      const all = (c.clip.words || []).filter((w) => w.end > w.start);
      const first = c.words[0];
      const last = c.words[c.words.length - 1];
      const prevWord = [...all].reverse().find((w) => w.end <= first.start - 0.01);
      const nextWord = all.find((w) => w.start >= last.end + 0.01);
      const dur = c.clip.durationSec || e.env.length * HOP;
      // out point
      const outLimit = nextWord ? nextWord.start - 0.04 : dur - 0.02;
      let end = trueEnd(e, last.end, outLimit);
      if (end != null) end = Math.min(end + OUT_TAIL, outLimit);
      else {
        end = deepestDip(e, last.end - 0.05, Math.min(outLimit, last.end + OUT_SEARCH));
        summary.dipCuts += 1;
      }
      end = Math.max(end, last.end + 0.03);
      // in point
      const inLimit = prevWord ? prevWord.end + 0.04 : 0;
      let start = trueStart(e, first.start, inLimit);
      start = start != null ? Math.max(inLimit, start - IN_LEAD) : Math.max(inLimit, first.start - 0.12);
      start = Math.min(start, first.start - 0.02);
      const oldStart = c.start;
      const oldEnd = c.start + c.frames / fps;
      if (start < oldStart - 0.02) summary.startsEarlier += 1;
      if (end > oldEnd + 0.02) {
        summary.endsExtended += 1;
        summary.maxExtendSec = Math.max(summary.maxExtendSec, Math.round((end - oldEnd) * 100) / 100);
      }
      c.start = Math.max(0, start);
      c.frames = Math.max(4, Math.round((end - c.start) * fps));
    }
  }
  return summary;
}

module.exports = { snapCuts, envelopeOf, trueEnd, trueStart, deepestDip };
