#!/usr/bin/env node
/**
 * Synthesises the reels' sound effects — procedural foley, no downloads, no
 * licences to track (the approach of lemo-opuscar's core/audio/sfx.py).
 *
 *   node scripts/make-sfx.mjs        → public/sfx/*.wav + src/sfxManifest.ts
 *
 * The vocabulary follows video-shotcraft's sound-design rules: whoosh (a move
 * or transition), impact (a landing), riser (a build), plus real-world foley for
 * actions you can see — a mechanical tick, a key tap, paper sliding, a felt
 * marker stroke, a rubber stamp. No game-style bleeps or cartoon pops.
 *
 * Every sound comes in two takes (a / b) so a run of the same action never
 * sounds like a machine gun. Deterministic: a seeded RNG, the same files on
 * every run. The manifest records each file's energy peak (10 ms RMS window):
 * the renderer lands the PEAK on the frame of the action, not the file start.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/sfx');
const MANIFEST = resolve(HERE, '../src/sfxManifest.ts');
const SR = 48000;

// ── tiny DSP kit ─────────────────────────────────────────────────────────────
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const buf = (sec) => new Float64Array(Math.round(sec * SR));
const noise = (n, rnd) => Float64Array.from({ length: n }, () => rnd() * 2 - 1);

// state-variable filter with a per-sample cutoff (Hz) and resonance q (0.5 = gentle)
function svf(x, cutoff, q, mode) {
  const y = new Float64Array(x.length);
  let low = 0; let band = 0;
  for (let i = 0; i < x.length; i++) {
    const fc = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff;
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR);
    const damp = 1 / Math.max(0.5, q);
    low += f * band;
    const high = x[i] - low - damp * band;
    band += f * high;
    y[i] = mode === 'low' ? low : mode === 'high' ? high : band;
  }
  return y;
}
const env = (n, fn) => Float64Array.from({ length: n }, (_, i) => fn(i / SR));
const mul = (a, b) => a.map((v, i) => v * (typeof b === 'function' ? b(i / SR) : typeof b === 'number' ? b : b[i]));
function mix(...parts) {
  const n = Math.max(...parts.map(([p]) => p.length));
  const y = new Float64Array(n);
  for (const [p, g = 1, at = 0] of parts) {
    const o = Math.round(at * SR);
    for (let i = 0; i < p.length && i + o < n; i++) y[i + o] += p[i] * g;
  }
  return y;
}
// sine with a pitch that follows hz(t); h = extra harmonics [2nd, 3rd] so low notes speak on phone speakers
function tone(sec, hz, h = [0, 0]) {
  const y = buf(sec);
  let ph = 0;
  for (let i = 0; i < y.length; i++) {
    ph += (2 * Math.PI * hz(i / SR)) / SR;
    y[i] = Math.sin(ph) + h[0] * Math.sin(2 * ph) + h[1] * Math.sin(3 * ph);
  }
  return y;
}
const attackDecay = (a, d) => (t) => (t < a ? t / a : Math.exp(-(t - a) / d));
// fade the last ms so no file ends on a click
function tail(x, ms = 6) {
  const n = Math.round((ms / 1000) * SR);
  for (let i = 0; i < n && i < x.length; i++) x[x.length - 1 - i] *= i / n;
  return x;
}
function normalize(x, peakDb = -3) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  const g = m > 0 ? 10 ** (peakDb / 20) / m : 1;
  return x.map((v) => v * g);
}
// where the energy peaks (10 ms RMS window), in seconds
function peakSec(x) {
  const w = Math.round(0.01 * SR);
  let best = 0; let at = 0; let acc = 0;
  for (let i = 0; i < x.length; i++) {
    acc += x[i] * x[i];
    if (i >= w) acc -= x[i - w] * x[i - w];
    if (i >= w - 1 && acc > best) { best = acc; at = i - w / 2; }
  }
  return at / SR;
}
function wav(path, x) {
  const n = x.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}

// ── the sounds ───────────────────────────────────────────────────────────────
// each recipe takes a seeded rng and a take index (0 = a, 1 = b) for small variations
const RECIPES = {
  // air moving past: band-passed noise whose centre sweeps up then down — a cut, a wipe, a push
  whoosh(rnd, k) {
    const sec = 0.46 + k * 0.05;
    const peak = 0.24 + k * 0.03;
    const n = buf(sec).length;
    const centre = (t) => 260 + 2600 * Math.exp(-(((t - peak) / 0.11) ** 2));
    const air = svf(noise(n, rnd), centre, 1.6, 'band');
    const body = svf(noise(n, rnd), (t) => centre(t) * 0.45, 0.9, 'low');
    const shape = (t) => (t < peak ? (t / peak) ** 2.2 : Math.exp(-(t - peak) / 0.07));
    return tail(mix([mul(air, shape), 1], [mul(body, shape), 0.5]));
  },
  // a mechanical switch / pen click: a 4 ms burst + a short body ring — ticks, chapter labels
  tick(rnd, k) {
    const sec = 0.09;
    const n = buf(sec).length;
    const snap = mul(svf(noise(n, rnd), 5200 + k * 900, 0.8, 'high'), attackDecay(0.0004, 0.0035));
    const body = mul(tone(sec, () => 1900 + k * 260), attackDecay(0.0005, 0.012));
    const thock = mul(tone(sec, () => 420 + k * 40), attackDecay(0.001, 0.01));
    return tail(mix([snap, 1], [body, 0.22], [thock, 0.35]));
  },
  // a keyboard key: click + a muffled bottom-out — prompt typing
  key(rnd, k) {
    const sec = 0.07;
    const n = buf(sec).length;
    const click = mul(svf(noise(n, rnd), 3600 + k * 500, 1.1, 'band'), attackDecay(0.0006, 0.006));
    const bottom = mul(svf(noise(n, rnd), 700, 0.7, 'low'), attackDecay(0.002, 0.012));
    return tail(mix([click, 1], [bottom, 0.8, 0.008]));
  },
  // a card or print sliding over paper: grainy high noise with a crackle — cards, prints, drawings arriving
  paper(rnd, k) {
    const sec = 0.32 + k * 0.04;
    const n = buf(sec).length;
    const grain = noise(n, rnd).map((v) => v * (0.55 + 0.45 * (rnd() < 0.08 ? 1 : rnd())));
    const hiss = svf(grain, (t) => 2600 + 2400 * (t / sec), 0.9, 'band');
    const shape = (t) => (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / (0.09 + k * 0.02)));
    const settle = mul(svf(noise(n, rnd), 1500, 0.7, 'low'), (t) => Math.exp(-(((t - 0.17 - k * 0.02) / 0.02) ** 2)));
    return tail(mix([mul(hiss, shape), 1], [settle, 0.7]));
  },
  // a felt marker stroke: a dry squeaky band, steady then lifted — strikes, highlighters, rings
  marker(rnd, k) {
    const sec = 0.38 + k * 0.06;
    const n = buf(sec).length;
    const felt = svf(noise(n, rnd), (t) => 3400 + 500 * Math.sin(t * 38 + k), 2.4, 'band');
    const squeak = mul(tone(sec, (t) => 2300 + 180 * Math.sin(t * 9) + k * 120), 0.08);
    const shape = (t) => (t < 0.03 ? t / 0.03 : t > sec - 0.08 ? Math.max(0, (sec - t) / 0.08) : 0.85 + 0.15 * Math.sin(t * 21));
    return tail(mul(mix([felt, 1], [squeak, 1]), shape));
  },
  // something heavy landing: a falling sine with harmonics + a short transient — slams, the hook, verdicts (rare)
  impact(rnd, k) {
    const sec = 0.85;
    const n = buf(sec).length;
    const boom = mul(tone(sec, (t) => 46 + 70 * Math.exp(-t / 0.05) - k * 4, [0.35, 0.18]), attackDecay(0.003, 0.22));
    const hit = mul(svf(noise(n, rnd), 1800, 0.7, 'low'), attackDecay(0.001, 0.025));
    const room = mul(svf(noise(n, rnd), 600, 0.6, 'low'), attackDecay(0.01, 0.3));
    return tail(mix([boom, 1], [hit, 0.9], [room, 0.25]), 30);
  },
  // a rubber stamp: a dull thud + a paper slap — stamps
  stamp(rnd, k) {
    const sec = 0.32;
    const n = buf(sec).length;
    const thud = mul(tone(sec, (t) => 95 + 120 * Math.exp(-t / 0.02) + k * 10, [0.3, 0.12]), attackDecay(0.002, 0.07));
    const slap = mul(svf(noise(n, rnd), 2400, 0.8, 'low'), attackDecay(0.0008, 0.03));
    return tail(mix([thud, 1], [slap, 0.9]));
  },
  // a build into a landing: noise + an upward filter sweep, loudest at the very end — before a reveal
  riser(rnd, k) {
    const sec = 1.1;
    const n = buf(sec).length;
    const swell = svf(noise(n, rnd), (t) => 300 + 5200 * (t / sec) ** 2, 2.2, 'band');
    const shape = (t) => (t / sec) ** 2.6 * (t > sec - 0.03 ? (sec - t) / 0.03 : 1);
    return mul(swell, shape);
  },
};

mkdirSync(OUT, { recursive: true });
const manifest = {};
let seed = 1;
for (const [name, make] of Object.entries(RECIPES)) {
  for (const [k, take] of [[0, 'a'], [1, 'b']]) {
    const x = normalize(make(mulberry(seed++ * 7919), k), name === 'riser' || name === 'whoosh' ? -4 : -3);
    const file = `${name}_${take}.wav`;
    wav(resolve(OUT, file), x);
    manifest[`${name}_${take}`] = { file: `sfx/${file}`, sec: +(x.length / SR).toFixed(3), peak: +peakSec(x).toFixed(3) };
  }
}

writeFileSync(MANIFEST, `// generated by scripts/make-sfx.mjs — do not edit by hand
// peak = where each file's energy peaks (s): the renderer lands it on the action's frame
export const SFX_FILES = ${JSON.stringify(manifest, null, 2)} as const;
`);
console.log(`wrote ${Object.keys(manifest).length} sounds to ${OUT}`);
for (const [k, v] of Object.entries(manifest)) console.log(`  ${k.padEnd(10)} ${v.sec}s  peak ${v.peak}s`);
