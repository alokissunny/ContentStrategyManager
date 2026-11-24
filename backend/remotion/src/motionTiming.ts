/**
 * Timing rules shared by the motion-story scenes (motionStory.tsx) and their
 * sound plan (sfx.tsx), so picture and sound always agree. From the motion
 * graphics repos analysed 2026-11-24 (video-shotcraft aesthetic-rules R2/R4,
 * lemo-opuscar DIRECTOR.md §7–9):
 *
 *   stagger      a run of words/items arrives faster and faster (even spacing reads as a cheap slideshow)
 *   windup       anticipation: a small move the other way before the main move
 *   planStory    which beats may hit the WHOLE frame (≤ 3, ≥ 4 s apart — the rest move only their element)
 *                and which one beat is the reel's signature move (its peak)
 */

/** Offset (frames) of element i of n: gaps shrink by `r` each step, the run keeps its total length. */
export function stagger(i: number, n: number, per: number, r = 0.78): number {
  if (i <= 0 || n <= 1) return 0;
  const gaps = n - 1;
  let sum = 0;
  for (let k = 0; k < gaps; k++) sum += r ** k;
  const first = (per * gaps) / sum;
  let off = 0;
  for (let k = 0; k < i; k++) off += first * r ** k;
  return Math.round(off);
}

/**
 * Anticipation bump: 0 → 1 → 0 over the `len` frames BEFORE `at` (peaks 1/3 in),
 * so a stamp lifts before it drops, a picture pulls back before it punches in.
 */
export function windup(f: number, at: number, len = 7): number {
  const k = f - (at - len);
  if (k <= 0 || k >= len) return 0;
  const p = k / len;
  return p < 0.4 ? Math.sin((p / 0.4) * (Math.PI / 2)) : Math.cos(((p - 0.4) / 0.6) * (Math.PI / 2));
}

type BeatLike = { scene: string; sec?: number; signature?: boolean; assetId?: string };

export const ENTER_LEN = 9;
export const SIGNATURE_ENTER_LEN = 16;
const HIT_SCENES = new Set(['slam', 'stamp']);
const PEAK_SCENES = new Set(['photo_reveal', 'text_mask', 'zoom_punch', 'outline_fill']);

export type StoryPlan = {
  starts: number[]; // where each beat's own time begins
  froms: number[]; // where its Sequence begins (earlier by its entrance)
  lens: number[]; // its Sequence length
  enters: number[]; // its entrance length (0 for the first)
  impact: boolean[]; // may shake the whole frame / gets the big hit sound
  signature: number; // index of the signature beat, -1 = none
};

export function planStory(beats: BeatLike[], dur: number, fps: number): StoryPlan {
  const n = beats.length;
  const weights = beats.map((b) => (b.sec && b.sec > 0 ? b.sec : 2.6));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const starts: number[] = [];
  let acc = 0;
  weights.forEach((w) => { starts.push(Math.round((acc / sum) * dur)); acc += w; });

  // the signature beat: the planner's pick, else a picture/peak scene in the back half, else ~2/3 in
  let signature = -1;
  if (n >= 3) {
    signature = beats.findIndex((b, i) => i > 0 && b.signature);
    if (signature < 0) {
      const back = beats.map((b, i) => i).filter((i) => i >= Math.floor(n / 2) && i > 0);
      signature = back.find((i) => PEAK_SCENES.has(beats[i].scene)) ?? Math.min(n - 1, Math.max(1, Math.round(n * 0.66)));
    }
  }

  // whole-frame hits: the opening slam first, then slams/stamps, ≤ 3 and ≥ 4 s apart
  const impact = beats.map(() => false);
  const hits: number[] = [];
  const order = beats.map((b, i) => i).filter((i) => HIT_SCENES.has(beats[i].scene)).sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : a - b));
  for (const i of order) {
    if (hits.length >= 3) break;
    if (hits.every((j) => Math.abs(starts[j] - starts[i]) >= 4 * fps)) { hits.push(i); impact[i] = true; }
  }

  const enters = beats.map((_, i) => (i === 0 ? 0 : i === signature ? SIGNATURE_ENTER_LEN : ENTER_LEN));
  const froms = starts.map((s, i) => Math.max(0, s - enters[i]));
  const lens = starts.map((s, i) => (i === n - 1 ? dur : starts[i + 1]) - froms[i]);
  return { starts, froms, lens: lens.map((l) => Math.max(1, l)), enters, impact, signature };
}

/** Seconds a line needs on screen once it has animated in (lemo-opuscar: letters ÷ 15 + 1.5 s, English). */
export const readSec = (text: string) => (text || '').replace(/\s+/g, '').length / 15 + 1.5;

// ── per-scene key frames (frames from the beat's own start), shared with sfx.tsx ──
export const slamPer = (n: number, dur: number) => Math.max(3, Math.min(6, Math.floor((dur * 0.42) / Math.max(1, n))));
/** the frame the last slammed word lands */
export const slamLand = (n: number, dur: number) => stagger(n - 1, n, slamPer(n, dur)) + 3;
/** marker: the highlighter starts once the last word is up */
export const markerPaintAt = (n: number) => 4 + stagger(n - 1, n, 3) + 13;
/** circle: the ring starts once the last word is up */
export const circleDrawAt = (n: number) => 2 + stagger(n - 1, n, 3) + 13;
/** stamp: the frame it hits (it hovers and lifts first) */
export const stampHitAt = (dur: number) => Math.max(18, Math.floor(dur * 0.38));
/** outline_fill: the fill starts rising once the line is in; it takes FILL_LEN */
export const outlineFillAt = (n: number) => 10 + stagger(Math.max(0, n - 1), Math.max(1, n), 3) + 6;
export const FILL_LEN = 26;
/** text_mask: the word starts flying open into the picture */
export const maskOpenAt = (dur: number) => Math.max(20, Math.floor(dur * 0.36));
export const MASK_LEN = 16;
