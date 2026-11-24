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

/*
 * Pacing (studio, 2026-11-24: "bring in pauses where appropriate so the flow doesn't break and the whole
 * reel feels seamless"). Snapped cuts sit tight against the words; a talk cut that tight runs sentences
 * and points into each other. So the edit breathes where a good editor would let it:
 *   end of a sentence      → ~0.22 s of quiet before the next one
 *   a new point (beat)     → ~0.42 s
 *   before the closing line→ ~0.5 s
 *   mid-sentence joins stay tight (that's where hesitations were cut out).
 * The pause is REAL: the piece runs on into the take's own quiet after the voice stops, and the next one
 * starts a little earlier in its own quiet lead-in — the speaker is genuinely silent on camera, no frozen
 * frame, no synthetic silence. A pause is only as long as the takes' quiet allows.
 */
const BREATH = { sentence: 0.22, point: 0.42, closing: 0.5 };
const SENTENCE_END = /[.?!…]["”')]?$/;

/* seconds of quiet (voice below threshold) from t forward (dir 1) or backward (dir −1), up to limit */
function quietRun(e, t, dir, limit) {
  const { env, thr } = e;
  let k = idx(t, env.length);
  let n = 0;
  const max = Math.round(limit / HOP);
  while (n < max && k >= 0 && k < env.length && env[k] < thr) { n += 1; k += dir; }
  return n * HOP;
}

async function breatheCuts(beats, { fps, helpers }) {
  const flat = beats.flatMap((b, bi) => b.cut.map((c, ci) => ({ c, bi, lastInBeat: ci === b.cut.length - 1 })));
  const summary = { joins: 0, breathed: 0, addedSec: 0, short: 0 };
  for (let k = 0; k < flat.length - 1; k += 1) {
    const { c, bi, lastInBeat } = flat[k];
    const n = flat[k + 1].c;
    const lastWord = c.words?.[c.words.length - 1];
    const firstWord = n.words?.[0];
    if (!lastWord || !firstWord) continue;
    summary.joins += 1;
    let target = 0;
    if (lastInBeat) target = bi === beats.length - 2 ? BREATH.closing : BREATH.point;
    else if (
      SENTENCE_END.test(lastWord.text || '')
      // the transcript often drops the full stop: a capitalised next word (not "I") or a different take
      // is a new sentence too
      || (/^[A-Z]/.test(firstWord.text || '') && !/^I\b|^I'/.test(firstWord.text || ''))
      || n.clip.key !== c.clip.key
    ) target = BREATH.sentence;
    if (!target) continue;
    // eslint-disable-next-line no-await-in-loop
    const [eC, eN] = await Promise.all([envelopeOf(c.clip.key, helpers), envelopeOf(n.clip.key, helpers)]);
    if (!eC || !eN) continue;
    const cEnd = c.start + c.frames / fps;
    // the quiet already heard: after the voice stops in c, before it starts in n
    const voiceEnd = trueEnd(eC, lastWord.end, cEnd) ?? lastWord.end;
    const voiceStart = trueStart(eN, firstWord.start, n.start) ?? firstWord.start;
    const have = Math.max(0, cEnd - voiceEnd) + Math.max(0, voiceStart - n.start);
    let need = target - have;
    if (need <= 0.02) continue;
    const before = need;
    // run c on into its own quiet (never into its next word)
    const cWords = (c.clip.words || []).filter((w) => w.end > w.start);
    const nextInTake = cWords.find((w) => w.start >= lastWord.end + 0.01);
    const tailLimit = Math.max(0, (nextInTake ? nextInTake.start - 0.08 : (c.clip.durationSec || 1e9) - 0.05) - cEnd);
    const tail = Math.min(need * 0.6, quietRun(eC, cEnd, 1, tailLimit));
    if (tail > 0.01) { c.frames += Math.round(tail * fps); need -= tail; }
    // start n earlier in its own quiet lead-in (never into its previous word)
    const nWords = (n.clip.words || []).filter((w) => w.end > w.start);
    const prevInTake = [...nWords].reverse().find((w) => w.end <= firstWord.start - 0.01);
    const leadLimit = Math.max(0, n.start - (prevInTake ? prevInTake.end + 0.08 : 0));
    const lead = Math.min(need, quietRun(eN, n.start - HOP, -1, leadLimit));
    if (lead > 0.01) { const f = Math.round(lead * fps); n.start -= f / fps; n.frames += f; need -= f / fps; }
    // whatever is left: more of c's tail, if its quiet allows
    if (need > 0.02) {
      const more = Math.min(need, Math.max(0, quietRun(eC, c.start + c.frames / fps, 1, tailLimit - tail)));
      if (more > 0.01) { c.frames += Math.round(more * fps); need -= more; }
    }
    const added = before - Math.max(0, need);
    if (added > 0.02) { summary.breathed += 1; summary.addedSec += added; }
    if (need > 0.08) summary.short += 1;
  }
  summary.addedSec = Math.round(summary.addedSec * 100) / 100;
  return summary;
}

module.exports = { snapCuts, breatheCuts, envelopeOf, trueEnd, trueStart, deepestDip, BREATH };
