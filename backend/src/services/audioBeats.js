/*
 * Tempo + beat grid of an audio/video file, in plain JS over ffmpeg-decoded
 * PCM — no native deps. Good enough to (a) describe a reference reel's music
 * ("~122 BPM, high energy") and (b) snap a reel's cuts onto the beats of the
 * music bed we generate for it.
 *
 *   onset envelope = positive change of log energy, 11.6 ms hop
 *   tempo          = autocorrelation peak in 70–180 BPM (mild prior at 120)
 *   phase          = offset whose beat comb collects the most onset energy
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);
const SR = 11025;
const HOP = 128; // ~11.6 ms
const WIN = 512;

async function decodeMono(file) {
  const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const { stdout } = await run(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file,
    '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-t', '240', 'pipe:1'],
  { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4));
}

function analyzePcm(pcm) {
  const n = Math.max(0, Math.floor((pcm.length - WIN) / HOP));
  if (n < 50) return null;
  const energy = new Float32Array(n);
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    let e = 0;
    const o = i * HOP;
    for (let j = 0; j < WIN; j += 1) e += pcm[o + j] * pcm[o + j];
    energy[i] = Math.log10(1e-9 + e / WIN);
    total += e / WIN;
  }
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i += 1) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  // de-mean
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += onset[i];
  mean /= n;
  for (let i = 0; i < n; i += 1) onset[i] = Math.max(0, onset[i] - mean);

  const fps = SR / HOP;
  const minLag = Math.floor((60 / 180) * fps);
  const maxLag = Math.ceil((60 / 70) * fps);
  let best = { lag: 0, score: -1 };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let i = lag; i < n; i += 1) s += onset[i] * onset[i - lag];
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = s * prior;
    if (score > best.score) best = { lag, score };
  }
  const lag = best.lag || Math.round(fps / 2);
  let phase = { off: 0, s: -1 };
  for (let off = 0; off < lag; off += 1) {
    let s = 0;
    for (let i = off; i < n; i += lag) s += onset[i];
    if (s > phase.s) phase = { off, s };
  }
  const beats = [];
  for (let i = phase.off; i < n; i += lag) beats.push(Math.round((i / fps) * 1000) / 1000);
  // how clearly rhythmic: comb energy vs average energy
  const pulse = phase.s / Math.max(1e-9, (onset.reduce((a, b) => a + b, 0) / lag));
  const rmsDb = 10 * Math.log10(1e-12 + total / n);
  return {
    bpm: Math.round(((60 * fps) / lag) * 10) / 10,
    beats,
    pulse: Math.round(pulse * 100) / 100, // > ~1.5 = a clear beat
    loudnessDb: Math.round(rmsDb * 10) / 10,
    durationSec: Math.round((pcm.length / SR) * 100) / 100,
  };
}

/** { bpm, beats[sec], pulse, loudnessDb, durationSec } or null (silent / too short). */
async function beatsOf(fileOrBuffer) {
  let file = fileOrBuffer;
  let tmp = null;
  if (Buffer.isBuffer(fileOrBuffer)) {
    tmp = path.join(os.tmpdir(), `beats-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.promises.writeFile(tmp, fileOrBuffer);
    file = tmp;
  }
  try {
    return analyzePcm(await decodeMono(file));
  } finally {
    if (tmp) fs.promises.unlink(tmp).catch(() => {});
  }
}

module.exports = { beatsOf, analyzePcm };
