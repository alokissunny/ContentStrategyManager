/**
 * Sound design for every reel: one sound per visible action, planned from the
 * timeline (never sprinkled by hand), mixed under the voice.
 *
 * Rules taken from lemo-opuscar DIRECTOR.md §6 and video-shotcraft's
 * aesthetic-rules S1–S5 / R4 (analysed 2026-11-24):
 *   - every visible action gets the sound of that action (a tick for a tick, paper for a card,
 *     a marker for a marker) — foley first, decoration second;
 *   - the sound's PEAK lands on the action's frame (files are measured: sfxManifest.ts),
 *     minus the output's AAC priming (~1 frame);
 *   - repeats alternate two takes and step down in volume, so a run never sounds like a machine gun;
 *   - full-frame hits (impact) are rare: at most 3 per reel, ≥ 4 s apart; everything else stays on
 *     the element layer;
 *   - sounds sit well under a voice (master 0.5) and never pile up (≥ 3 frames apart).
 *
 * Off with `reel.audio.sfx === false` (backend REEL_SFX=off).
 */
import React from 'react';
import { Audio, Sequence, staticFile, useVideoConfig } from 'remotion';
import { SFX_FILES } from './sfxManifest';
import type { Beat } from './motionStory';
import { planStory, slamLand, markerPaintAt, circleDrawAt, stampHitAt, outlineFillAt, FILL_LEN, maskOpenAt, MASK_LEN } from './motionTiming';
import type { ReelExplainer } from './reelSchema';
import { itemStart } from './explainers';

export type SfxKind = 'whoosh' | 'tick' | 'key' | 'paper' | 'marker' | 'impact' | 'stamp' | 'riser';
/** `at` = the frame the action happens on (where the sound should hit). */
export type SfxEvent = { at: number; kind: SfxKind; gain?: number; prio?: number };

const BASE: Record<SfxKind, number> = {
  whoosh: 0.32, tick: 0.42, key: 0.2, paper: 0.36, marker: 0.3, impact: 0.55, stamp: 0.5, riser: 0.28,
};
// higher wins when two sounds would collide
const PRIO: Record<SfxKind, number> = { impact: 6, stamp: 5, riser: 4, whoosh: 3, paper: 3, marker: 2, tick: 2, key: 1 };
// sustained sounds start on the action (their energy is a plateau); the rest hit on their peak
const FROM_START = new Set<SfxKind>(['marker']);
const OUTPUT_OFFSET_SEC = 0.021; // AAC encoder priming at 48 kHz (~1024 samples)
const MAX_IMPACTS = 3;
const IMPACT_GAP_SEC = 4;
const MIN_GAP_FRAMES = 3;
const RUN_WINDOW_SEC = 0.6;

type Placed = { from: number; file: string; volume: number; len: number };

export function planSfx(events: SfxEvent[], fps: number, total: number): Placed[] {
  const sorted = events
    .filter((e) => Number.isFinite(e.at) && e.at >= 0 && e.at < total)
    .map((e) => ({ ...e, prio: e.prio ?? PRIO[e.kind] }))
    .sort((a, b) => a.at - b.at || b.prio - a.prio);
  // impacts: keep the strongest few, well apart; the rest become a softer stamp-free thud (dropped)
  const impacts = sorted.filter((e) => e.kind === 'impact').sort((a, b) => b.prio - a.prio || a.at - b.at);
  const keptImpacts: number[] = [];
  for (const e of impacts) {
    if (keptImpacts.length >= MAX_IMPACTS) break;
    if (keptImpacts.every((t) => Math.abs(t - e.at) >= IMPACT_GAP_SEC * fps)) keptImpacts.push(e.at);
  }
  const kept: typeof sorted = [];
  for (const e of sorted) {
    if (e.kind === 'impact' && !keptImpacts.includes(e.at)) continue;
    const clash = kept.findIndex((k) => Math.abs(k.at - e.at) < MIN_GAP_FRAMES);
    if (clash >= 0) {
      if (kept[clash].prio >= e.prio) continue;
      kept.splice(clash, 1);
    }
    kept.push(e);
  }
  kept.sort((a, b) => a.at - b.at);
  // runs of one kind: alternate takes, step the volume down (0.85× per repeat, floor 0.55×)
  const take: Record<string, number> = {};
  const lastAt: Record<string, number> = {};
  const run: Record<string, number> = {};
  return kept.map((e) => {
    const near = lastAt[e.kind] !== undefined && e.at - lastAt[e.kind] <= RUN_WINDOW_SEC * fps;
    run[e.kind] = near ? (run[e.kind] || 0) + 1 : 0;
    lastAt[e.kind] = e.at;
    take[e.kind] = ((take[e.kind] ?? -1) + 1) % 2;
    const key = `${e.kind}_${take[e.kind] ? 'b' : 'a'}` as keyof typeof SFX_FILES;
    const f = SFX_FILES[key];
    const lead = (FROM_START.has(e.kind) ? 0 : f.peak) + OUTPUT_OFFSET_SEC;
    const volume = BASE[e.kind] * (e.gain ?? 1) * Math.max(0.55, 0.85 ** run[e.kind]);
    return { from: Math.max(0, Math.round(e.at - lead * fps)), file: f.file, volume, len: Math.ceil(f.sec * fps) + 1 };
  });
}

/** `total` = the length of the Sequence it sits in (defaults to the whole composition). */
export const SfxTrack: React.FC<{ events: SfxEvent[]; master?: number; total?: number }> = ({ events, master = 1, total }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const len = total ?? durationInFrames;
  const placed = React.useMemo(() => planSfx(events, fps, len), [events, fps, len]);
  return (
    <>
      {placed.map((p, i) => (
        <Sequence key={i} from={p.from} durationInFrames={p.len} layout="none" name={`sfx ${p.file}`}>
          <Audio src={staticFile(p.file)} volume={Math.min(1, p.volume * master)} />
        </Sequence>
      ))}
    </>
  );
};

// ── event plans that mirror each renderer's own timing ───────────────────────

const words = (s?: string) => (s || '').split(/\s+/).filter(Boolean);

/**
 * One motion-story beat's actions, in frames from the beat's own Sequence start
 * (the same key frames motionStory.tsx animates with — motionTiming.ts).
 * `enter` = its entrance length (0 for the first beat).
 */
export function beatSfx(b: Beat, dur: number, enter: number, impact: boolean, signature: boolean): SfxEvent[] {
  const ev: SfxEvent[] = [];
  if (signature) {
    // the signature move: a build that lands as the new scene comes into focus
    ev.push({ at: enter, kind: 'riser', gain: 0.9, prio: 5 });
    ev.push({ at: Math.round(enter * 0.4), kind: 'whoosh', gain: 0.7 });
  } else if (enter) ev.push({ at: 4, kind: 'whoosh', gain: 0.9 });
  const n = Math.max(1, words(b.text).length);
  switch (b.scene) {
    case 'slam': {
      // the frame-shaking beats get the big hit; the rest a lighter thud on the last word
      ev.push({ at: slamLand(n, dur), kind: impact ? 'impact' : 'stamp', gain: impact ? 1 : 0.5, prio: impact ? 7 : undefined });
      break;
    }
    case 'strike_swap': {
      ev.push({ at: Math.floor(dur * 0.2), kind: 'marker' });
      ev.push({ at: Math.floor(dur * 0.42) + 4, kind: 'whoosh', gain: 0.6 });
      break;
    }
    case 'prompt_type': {
      const typeEnd = Math.max(12, Math.floor(dur * 0.5));
      // a key every ~2 frames while it types (not every character), then the send click
      if ((b.text || '').length) for (let t = 6; t < typeEnd; t += 2 + ((t * 7) % 3 === 0 ? 1 : 0)) ev.push({ at: t, kind: 'key', gain: 0.9 });
      ev.push({ at: typeEnd + 3, kind: 'tick', gain: 1.1 });
      break;
    }
    case 'marker': ev.push({ at: markerPaintAt(n), kind: 'marker', gain: 0.9 }); break;
    case 'circle': ev.push({ at: circleDrawAt(n), kind: 'marker', gain: 0.9 }); break;
    case 'checklist': {
      const items = (b.items || []).slice(0, 4).length;
      const per = Math.max(6, Math.floor((dur * 0.62) / Math.max(1, items)));
      const first = b.text ? 10 : 2;
      // motionStory Checklist: the tick draws over [at+5, at+12] — the click lands as it closes
      for (let i = 0; i < items; i++) ev.push({ at: first + i * per + 10, kind: 'tick' });
      break;
    }
    case 'split': {
      ev.push({ at: 2, kind: 'whoosh', gain: 0.7 });
      ev.push({ at: 10, kind: 'whoosh', gain: 0.6 });
      ev.push({ at: 20, kind: 'tick' });
      break;
    }
    case 'stamp': {
      const hit = stampHitAt(dur);
      ev.push({ at: hit, kind: impact ? 'impact' : 'stamp', gain: impact ? 0.8 : 1, prio: impact ? 6 : undefined });
      if (impact) ev.push({ at: hit + 1, kind: 'stamp', gain: 0.7 });
      break;
    }
    case 'photo_reveal': {
      ev.push({ at: 8, kind: 'paper', gain: 0.8 });
      ev.push({ at: Math.max(10, Math.floor(dur * 0.3)) + 10, kind: 'whoosh' });
      break;
    }
    case 'zoom_punch': {
      const at = Math.max(8, Math.floor(dur * 0.28));
      ev.push({ at, kind: 'whoosh', gain: 0.9 });
      ev.push({ at: at + 12, kind: 'marker', gain: 0.6 });
      break;
    }
    case 'polaroid': {
      ev.push({ at: 9, kind: 'paper' });
      ev.push({ at: 14, kind: 'marker', gain: 0.55 });
      break;
    }
    case 'outline_fill': {
      const at = outlineFillAt(n);
      ev.push({ at: at + FILL_LEN, kind: 'riser', gain: 0.55 });
      ev.push({ at: at + FILL_LEN + 1, kind: 'tick', gain: 0.6 });
      break;
    }
    case 'text_mask': {
      const at = maskOpenAt(dur);
      ev.push({ at: at + Math.round(MASK_LEN * 0.7), kind: 'whoosh', gain: 1.1 });
      break;
    }
    default: break;
  }
  return ev;
}

/** The same plan MotionStory renders with (motionTiming.planStory). */
export function storySfx(beats: Beat[], dur: number, fps: number): SfxEvent[] {
  const plan = planStory(beats, dur, fps);
  const out: SfxEvent[] = [];
  beats.forEach((b, i) => {
    for (const e of beatSfx(b, plan.lens[i], plan.enters[i], plan.impact[i], i === plan.signature)) out.push({ ...e, at: plan.froms[i] + e.at });
  });
  return out;
}

/** An explainer card (explainers.tsx): paper as the card lands, a pen stroke as the drawing draws, a tick per point said. */
export function explainerSfx(spec: ReelExplainer, fps: number): SfxEvent[] {
  // a list card returning after footage is already known: a softer paper, no stamp again
  const ev: SfxEvent[] = [{ at: 3, kind: 'paper', gain: spec.resume ? 0.6 : 1 }];
  const items = (spec.items || []).slice(0, 4);
  if (spec.scene === 'checklist' || spec.scene === 'flow') {
    // the tick lands with the point's follow-through (landScale peaks ~8 frames after it starts)
    items.forEach((it, i) => {
      const a = itemStart(it, i, items.length, fps, spec.scene);
      if (a >= 2) ev.push({ at: a + 8, kind: 'tick', gain: 0.85 }); // points said before a resumed card stay silent
    });
  } else {
    ev.push({ at: 10, kind: 'marker', gain: 0.5 });
  }
  if (!spec.resume && (spec.verdict === 'good' || spec.verdict === 'bad')) ev.push({ at: 16, kind: 'stamp', gain: 0.45 });
  return ev;
}
