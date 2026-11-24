/**
 * Motion story — a graphics-led reel told beat by beat, each beat animated to
 * match what it SAYS (studio, 2026-11-19: "boring, doesn't match the
 * narrative"). Used by MotionReel for the `motion_story` main format and for a
 * photo-less hook.
 *
 * Scenes (the planner picks one per beat from its meaning; the backend guard
 * repairs the choice — services/motionReelPlanner.js):
 *   slam         words punch in one by one, the screen shakes on impact      → hooks, tension, bold claims
 *   strike_swap  a phrase gets struck through by a marker, the real line rises → "not X, Y", myths, rejections
 *   prompt_type  a prompt box types the line, then an answer streams in        → AI, tools, digital process
 *   marker       lines rise from a mask, a highlighter paints the key word     → values, insights, the takeaway
 *   checklist    items tick in with drawn checkmarks                            → what we do, uses, steps
 *   split        two halves slide in from opposite sides, "vs" pops            → comparisons, before/now
 *   stamp        the line lands, then a rubber stamp slams down                → rules, promises, "never"
 *   circle       a hand-drawn ring scribbles around the key word               → pointing out one word
 *   photo_reveal the line lands, then the picture grows from a card to full-bleed → the payoff, the result
 *   zoom_punch   the picture punch-zooms into its focal point, a ring marks it  → a detail, "look at this"
 *   polaroid     the picture drops in as a tilted print, the line written under → memories, process, a moment
 *   outline_fill the key word huge in outline, filled from below like a liquid  → a quality, a material, a feeling
 *   text_mask    the picture shows through the key word, then the camera dives in → the reveal, a room's name
 *
 * Motion rules (motionTiming.ts, from the motion-graphics repos, 2026-11-24): runs of words arrive
 * faster and faster; big moves wind up first and settle after; only ≤ 3 beats may shake the whole
 * frame; pictures pull focus and turn slightly in depth with the type drifting against them; one
 * beat per reel is the signature move ('through' entrance + riser).
 *
 * Any beat can carry a picture (`assetId`, a photo or a clip still — a clip
 * plays): the scene then runs over it, in white with a soft shade. BeatCaption
 * runs one scene inside a band — photo formats' captions use it.
 *
 * Beats overlap by a few frames: each one enters with its own transition (a
 * block wipe, a circle reveal, a push-up) on a colour that alternates with the
 * last (ground → ink → accent), over a light animated grain. Everything is a
 * function of useCurrentFrame() — deterministic.
 */
import React from 'react';
import { AbsoluteFill, Sequence, interpolate, Easing, useCurrentFrame, useVideoConfig } from 'remotion';
import { MediaFill } from './motionMedia';
import type { MotionMedia } from './reelSchema';
import { SfxTrack, storySfx } from './sfx';
import { stagger, windup, planStory, slamPer, slamLand, markerPaintAt, circleDrawAt, stampHitAt, outlineFillAt, FILL_LEN, maskOpenAt, MASK_LEN } from './motionTiming';

const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outCubic = Easing.out(Easing.cubic);
const outExpo = Easing.out(Easing.exp);
const outBack = Easing.out(Easing.back(1.7));
const inOut = Easing.inOut(Easing.cubic);

export type StoryCtx = {
  brand: { accent: string; accentInk: string; ground?: string; fg?: string };
  media?: Record<string, MotionMedia>;
  sfx?: boolean; // false = no sound effects (reel.audio.sfx)
  grain?: boolean; // false = no in-page grain (added in ffmpeg after the render instead)
  head: string;
  body: string;
  S: number;
  W: number;
  H: number;
};

export type Beat = {
  scene: string;
  text: string;
  emphasis?: string;
  struck?: string;
  items?: string[];
  left?: string;
  right?: string;
  stampText?: string;
  assetId?: string; // the picture this beat plays over (or shows, for photo scenes)
  assetIds?: string[]; // split: one picture per half; polaroid: a second print behind
  sec?: number; // how long it needs (backend guard); the beats share the segment in proportion
  signature?: boolean; // the planner's pick for the reel's one signature move (motionTiming.planStory)
  impact?: boolean; // set by MotionStory: this beat may shake the whole frame (≤ 3 per reel)
};

type Pal = { bg: string; ink: string; hi: string; hiInk: string; shadow?: boolean };

// the three grounds a story alternates between
export function palettes(c: StoryCtx): Pal[] {
  const ground = c.brand.ground || '#F4F1EA';
  const fg = c.brand.fg || '#141414';
  return [
    { bg: ground, ink: fg, hi: c.brand.accent, hiInk: c.brand.accentInk },
    { bg: fg, ink: ground, hi: c.brand.accent, hiInk: c.brand.accentInk },
    { bg: c.brand.accent, ink: c.brand.accentInk, hi: fg, hiInk: ground },
  ];
}

type Area = { top: number; h: number };
const zone = (c: StoryCtx, area?: Area) => {
  const left = 80 * c.S; const right = c.W - 120 * c.S;
  const top = area ? area.top : 230 * c.S; const bottom = area ? area.top + area.h : c.H - 430 * c.S;
  return { left, right, top, bottom, w: right - left, h: bottom - top };
};
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const isEmph = (w: string, emph?: string) => Boolean(emph) && norm(w) === norm(emph || '');

// type size that fits: by total length, capped so the longest word fits the width
function fit(text: string, c: StoryCtx, base = 1) {
  const z = zone(c);
  const chars = text.length;
  const longest = Math.max(1, ...text.split(/\s+/).map((w) => w.length));
  let size = (chars <= 12 ? 214 : chars <= 22 ? 176 : chars <= 34 ? 144 : 118) * c.S * base;
  size = Math.min(size, z.w / (longest * 0.57));
  return size;
}

// ── shared pieces ────────────────────────────────────────────────────────────

// film grain: a turbulence field whose seed steps every 2 frames
const Grain: React.FC<{ id: string; opacity?: number }> = ({ id, opacity = 0.09 }) => {
  const f = useCurrentFrame();
  const seed = Math.floor(f / 2) % 97;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'multiply', opacity }}>
      <svg width="100%" height="100%">
        <filter id={`g-${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#g-${id})`} />
      </svg>
    </AbsoluteFill>
  );
};

// a slow marquee band of the key word behind the type — depth without clutter
const Marquee: React.FC<{ word: string; c: StoryCtx; pal: Pal; y: number; dir?: 1 | -1 }> = ({ word, c, pal, y, dir = 1 }) => {
  const f = useCurrentFrame();
  if (!word) return null;
  const size = 220 * c.S;
  const run = `${word.toUpperCase()} · `.repeat(8);
  const x = (dir * -f * 6 * c.S) % (c.W * 1.5);
  return (
    <div style={{ position: 'absolute', top: y, left: 0, whiteSpace: 'nowrap', transform: `translateX(${x - (dir === -1 ? c.W : 0)}px)`, fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1, letterSpacing: -4 * c.S, color: pal.ink, opacity: 0.06 }}>{run}</div>
  );
};

// how a beat enters, over the beat before it
const ENTRANCES = ['block', 'circle', 'push', 'block-down'] as const;
function entranceStyle(kind: string, f: number, len: number, c: StoryCtx): React.CSSProperties {
  if (kind === 'none' || len <= 0) return {};
  const p = interpolate(f, [0, len], [0, 1], { ...cl, easing: inOut });
  if (kind === 'circle') return { clipPath: `circle(${p * 150}% at 50% 55%)` };
  // the signature move: the camera pulls back out of the next scene, from blur into focus
  if (kind === 'through') return { transform: `scale(${1.45 - 0.45 * p})`, filter: p < 1 ? `blur(${(1 - p) * 14}px)` : undefined, opacity: Math.min(1, p * 1.6) };
  if (kind === 'push') return { transform: `translateY(${(1 - p) * c.H}px)` };
  if (kind === 'block-down') return { clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` };
  return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
}

// the leading edge of a block wipe: a thin bar in the next colour's highlight
const WipeEdge: React.FC<{ kind: string; len: number; pal: Pal; c: StoryCtx }> = ({ kind, len, pal, c }) => {
  const f = useCurrentFrame();
  if (len <= 0 || f > len + 10) return null;
  const p = interpolate(f, [0, len], [0, 1], { ...cl, easing: inOut });
  if (kind === 'through') {
    // a ring of the highlight colour opening past the frame as it lands
    const q = interpolate(f, [len - 6, len + 10], [0, 1], { ...cl, easing: outCubic });
    const r = q * Math.hypot(c.W, c.H) * 0.6;
    return q > 0 && q < 1 ? <div style={{ position: 'absolute', left: c.W / 2 - r, top: c.H * 0.5 - r, width: 2 * r, height: 2 * r, borderRadius: '50%', border: `${(1 - q) * 30 * c.S}px solid ${pal.hi}`, opacity: 1 - q }} /> : null;
  }
  if (f > len || (kind !== 'block' && kind !== 'block-down')) return null;
  const t = 26 * c.S;
  return kind === 'block'
    ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: p * c.W - t, width: t, background: pal.hi }} />
    : <div style={{ position: 'absolute', left: 0, right: 0, top: p * c.H - t, height: t, background: pal.hi }} />;
};

// small camera shake that decays after an impact frame
function shake(f: number, at: number, c: StoryCtx, amp = 14) {
  const k = f - at;
  if (k < 0 || k > 10) return { x: 0, y: 0 };
  const d = (1 - k / 10) * amp * c.S;
  return { x: Math.sin(k * 2.7) * d, y: Math.cos(k * 3.3) * d * 0.7 };
}

// ── the scenes ───────────────────────────────────────────────────────────────

type SceneProps = { beat: Beat; c: StoryCtx; pal: Pal; dur: number; start: number; area?: Area; k?: number };

const Slam: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const words = beat.text.split(/\s+/).filter(Boolean);
  const n = Math.max(1, words.length);
  const per = slamPer(n, dur);
  const size = fit(beat.text, c, 1.08 * k);
  const z = zone(c, area);
  const lastAt = slamLand(n, dur);
  // only an impact beat shakes the frame; the others land on the element alone
  const sh = beat.impact ? shake(f, lastAt, c, 18) : { x: 0, y: 0 };
  const drift = interpolate(f, [0, dur], [1, 1.05], cl);
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, display: 'flex', alignItems: 'center', transform: `translate(${sh.x}px, ${sh.y}px) scale(${drift})`, transformOrigin: '0% 50%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline' }}>
        {words.map((w, i) => {
          const at = stagger(i, n, per);
          const t = interpolate(f, [at, at + 5], [0, 1], { ...cl, easing: outExpo });
          // follow-through: it lands a touch small and settles
          const settle = interpolate(f, [at + 5, at + 8, at + 13], [1, 0.94, 1], cl);
          // a beat without the frame shake gets its hit on the last word alone
          const pop = !beat.impact && i === n - 1 ? interpolate(f, [at + 4, at + 7, at + 12], [1, 1.07, 1], cl) : 1;
          const lit = isEmph(w, beat.emphasis);
          return (
            <span key={i} style={{
              display: 'inline-block', marginRight: 22 * c.S, fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 0.98, letterSpacing: -3 * c.S,
              color: lit ? pal.hi : pal.ink, opacity: t > 0 ? 1 : 0,
              transform: `scale(${(2.1 - 1.1 * t) * settle * pop})`, transformOrigin: '30% 70%', filter: t < 1 ? `blur(${(1 - t) * 6}px)` : undefined,
            }}>{w}</span>
          );
        })}
      </div>
    </div>
  );
};

const StrikeSwap: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const struck = beat.struck || '';
  const sSize = fit(struck || 'x', c, 1 * k);
  const strikeAt = Math.floor(dur * 0.2);
  const swapAt = Math.floor(dur * 0.42);
  const tIn = interpolate(f, [0, 8], [0, 1], { ...cl, easing: outCubic });
  const line = interpolate(f, [strikeAt, strikeAt + 7], [0, 1], { ...cl, easing: outCubic });
  const up = interpolate(f, [swapAt, swapAt + 10], [0, 1], { ...cl, easing: inOut });
  const sh = shake(f, strikeAt + 6, c, 10);
  const words = beat.text.split(/\s+/).filter(Boolean);
  const size = fit(beat.text, c, 0.92 * k);
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h }}>
      {struck ? (
        <div style={{
          position: 'absolute', left: 0, top: interpolate(up, [0, 1], [z.h * 0.36, 0]), transformOrigin: '0% 0%',
          transform: `translate(${sh.x}px, ${sh.y}px) scale(${1 - 0.5 * up})`, opacity: tIn * (1 - 0.45 * line),
        }}>
          <span style={{ position: 'relative', display: 'inline-block', fontFamily: c.head, fontWeight: 900, fontSize: sSize, lineHeight: 1, letterSpacing: -2 * c.S, color: pal.ink }}>
            {struck}
            <span style={{ position: 'absolute', left: -12 * c.S, right: -12 * c.S, top: '48%', height: Math.max(14 * c.S, sSize * 0.13), background: pal.hi, transform: `scaleX(${line}) rotate(-3deg)`, transformOrigin: '0% 50%', borderRadius: 8 * c.S, opacity: 1 }} />
          </span>
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: 0, right: 0, top: struck ? z.h * 0.3 : 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap' }}>
          {words.map((w, i) => {
            const at = swapAt + 4 + stagger(i, words.length, 2.4);
            const t = interpolate(f, [at, at + 10], [0, 1], { ...cl, easing: outCubic });
            const lit = isEmph(w, beat.emphasis);
            return (
              <span key={i} style={{ display: 'inline-block', overflow: 'hidden', marginRight: 20 * c.S, paddingBottom: 6 * c.S }}>
                <span style={{ display: 'inline-block', fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -2 * c.S, color: lit ? pal.hiInk : pal.ink, background: lit ? pal.hi : 'transparent', padding: lit ? `0 ${14 * c.S}px` : 0, borderRadius: 12 * c.S, transform: `translateY(${(1 - t) * 110}%)` }}>{w}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const PromptType: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const text = beat.text;
  const typeEnd = Math.max(12, Math.floor(dur * 0.5));
  const shownChars = Math.floor(interpolate(f, [6, typeEnd], [0, text.length], cl));
  const cursorOn = Math.floor(f / 7) % 2 === 0 || shownChars < text.length;
  const box = interpolate(f, [0, 8], [0, 1], { ...cl, easing: outBack });
  const sendAt = typeEnd + 3;
  const send = interpolate(f, [sendAt, sendAt + 6], [0, 1], { ...cl, easing: outBack });
  const lift = interpolate(f, [sendAt + 4, sendAt + 14], [0, 1], { ...cl, easing: inOut });
  const size = Math.min(96 * c.S, fit(text, c, 0.66 * k));
  const card = pal.bg === (c.brand.ground || '#F4F1EA') ? '#FFFFFF' : pal.ink;
  const cardInk = card === '#FFFFFF' ? (c.brand.fg || '#141414') : pal.bg;
  const answers = [0.92, 0.78, 0.55];
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34 * c.S, transform: `translateY(${-lift * 120 * c.S}px)` }}>
      <div style={{ background: card, borderRadius: 40 * c.S, padding: `${40 * c.S}px ${40 * c.S}px ${34 * c.S}px`, boxShadow: '0 30px 80px rgba(0,0,0,0.22)', transform: `scale(${0.8 + 0.2 * box})`, opacity: box, transformOrigin: '50% 50%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * c.S, fontFamily: c.body, fontWeight: 700, fontSize: 30 * c.S, color: pal.hi, letterSpacing: 2 * c.S, textTransform: 'uppercase', marginBottom: 18 * c.S }}>
          <span style={{ fontSize: 40 * c.S, transform: `rotate(${f * 4}deg)`, display: 'inline-block' }}>✦</span>
        </div>
        <div style={{ fontFamily: c.head, fontWeight: 800, fontSize: size, lineHeight: 1.12, color: cardInk, minHeight: size * 1.12 }}>
          {text.slice(0, shownChars)}
          <span style={{ display: 'inline-block', width: 6 * c.S, height: size * 0.95, marginLeft: 6 * c.S, verticalAlign: 'text-bottom', background: pal.hi, opacity: cursorOn ? 1 : 0 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 * c.S }}>
          <div style={{ width: 84 * c.S, height: 84 * c.S, borderRadius: '50%', background: pal.hi, color: pal.hiInk, display: 'grid', placeItems: 'center', fontFamily: c.body, fontWeight: 900, fontSize: 46 * c.S, transform: `scale(${0.6 + 0.4 * send + 0.12 * Math.sin(Math.max(0, f - sendAt) / 2) * (1 - lift)})`, opacity: 0.35 + 0.65 * send }}>↑</div>
        </div>
      </div>
      {/* the answer streaming in */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 * c.S, paddingLeft: 10 * c.S }}>
        {answers.map((w, i) => {
          const t = interpolate(f, [sendAt + 10 + i * 4, sendAt + 22 + i * 4], [0, w], { ...cl, easing: outCubic });
          const shimmer = 0.55 + 0.25 * Math.sin((f + i * 5) / 4);
          return <div key={i} style={{ height: 30 * c.S, width: `${t * 100}%`, borderRadius: 15 * c.S, background: pal.ink, opacity: shimmer * 0.35 }} />;
        })}
      </div>
    </div>
  );
};

const Marker: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const words = beat.text.split(/\s+/).filter(Boolean);
  const size = fit(beat.text, c, 1 * k);
  const revealEnd = markerPaintAt(words.length);
  const paint = interpolate(f, [revealEnd, revealEnd + 9], [0, 1], { ...cl, easing: outCubic });
  const settle = interpolate(f, [0, dur], [0, 1], cl);
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', transform: `translateY(${-settle * 16 * c.S}px)` }}>
        {words.map((w, i) => {
          const at = 4 + stagger(i, words.length, 3);
          const t = interpolate(f, [at, at + 10], [0, 1], { ...cl, easing: outCubic });
          const lit = isEmph(w, beat.emphasis);
          return (
            <span key={i} style={{ position: 'relative', display: 'inline-block', overflow: 'hidden', marginRight: 22 * c.S, padding: `0 ${lit ? 10 * c.S : 0}px ${8 * c.S}px` }}>
              {lit ? <span style={{ position: 'absolute', left: 0, right: 0, top: '18%', bottom: '6%', background: pal.hi, transform: `scaleX(${paint}) skewX(-8deg)`, transformOrigin: '0% 50%', borderRadius: 10 * c.S }} /> : null}
              <span style={{ position: 'relative', display: 'inline-block', fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -2 * c.S, color: lit && paint > 0.5 ? pal.hiInk : pal.ink, transform: `translateY(${(1 - t) * 110}%)` }}>{w}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Check: React.FC<{ t: number; size: number; color: string; box: string }> = ({ t, size, color, box }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ flex: 'none' }}>
    <rect x="6" y="6" width="88" height="88" rx="22" fill="none" stroke={box} strokeWidth="8" opacity="0.5" />
    <path d="M24 52 L43 70 L78 30" fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="90" strokeDashoffset={90 * (1 - t)} />
  </svg>
);

const Checklist: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const items = (beat.items || []).slice(0, 4);
  const hasTitle = Boolean(beat.text);
  const titleSize = Math.min(124 * c.S, fit(beat.text || 'x', c, 0.8 * k));
  const per = Math.max(6, Math.floor((dur * 0.62) / Math.max(1, items.length)));
  const first = hasTitle ? 10 : 2;
  const itemSize = 92 * c.S;
  const tT = interpolate(f, [0, 9], [0, 1], { ...cl, easing: outCubic });
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34 * c.S }}>
      {hasTitle ? <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: titleSize, lineHeight: 1.02, letterSpacing: -2 * c.S, color: pal.ink, opacity: tT, transform: `translateY(${(1 - tT) * 30 * c.S}px)`, marginBottom: 10 * c.S }}>{beat.text}</div> : null}
      {items.map((it, i) => {
        const at = first + i * per;
        const tRow = interpolate(f, [at, at + 8], [0, 1], { ...cl, easing: outCubic });
        const tTick = interpolate(f, [at + 5, at + 12], [0, 1], { ...cl, easing: outCubic });
        const pop = interpolate(f, [at + 10, at + 13, at + 17], [1, 1.08, 1], cl);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 28 * c.S, opacity: tRow, transform: `translateX(${(1 - tRow) * -50 * c.S}px) scale(${pop})`, transformOrigin: '0% 50%' }}>
            <Check t={tTick} size={110 * c.S} color={pal.hi} box={pal.ink} />
            <span style={{ fontFamily: c.head, fontWeight: 800, fontSize: itemSize, lineHeight: 1.05, color: pal.ink }}>{it}</span>
          </div>
        );
      })}
    </div>
  );
};

const Split: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const tA = interpolate(f, [0, 10], [0, 1], { ...cl, easing: outExpo });
  const tB = interpolate(f, [8, 18], [0, 1], { ...cl, easing: outExpo });
  const vs = interpolate(f, [18, 24], [0, 1], { ...cl, easing: outBack });
  const mid = z.top + z.h / 2;
  const half = z.h / 2 - 20 * c.S;
  const L = beat.left || ''; const R = beat.right || '';
  const sz = (s: string) => Math.min(120 * c.S, fit(s || 'x', c, 0.85 * k));
  const lean = interpolate(f, [24, dur], [0, 1], cl);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: mid, background: pal.ink, transform: `translateX(${(tA - 1) * c.W}px)`, overflow: 'hidden' }}>
        {mediaOf(c, beat.assetIds?.[0]) ? <><MediaFill m={mediaOf(c, beat.assetIds?.[0])} dur={dur} variant={2} /><AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.6), rgba(0,0,0,0) 60%)' }} /></> : null}
        <div style={{ position: 'absolute', left: z.left, width: z.w, bottom: 60 * c.S, height: half - 40 * c.S, display: 'flex', alignItems: 'flex-end', fontFamily: c.head, fontWeight: 900, fontSize: sz(L), lineHeight: 1, letterSpacing: -2 * c.S, color: mediaOf(c, beat.assetIds?.[0]) ? '#fff' : pal.bg, opacity: 0.55 + 0.45 * (1 - lean) }}>{L}</div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: mid, bottom: 0, background: pal.hi, transform: `translateX(${(1 - tB) * c.W}px)`, overflow: 'hidden' }}>
        {mediaOf(c, beat.assetIds?.[1]) ? <><MediaFill m={mediaOf(c, beat.assetIds?.[1])} dur={dur} variant={3} /><AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.6), rgba(0,0,0,0) 60%)' }} /></> : null}
        <div style={{ position: 'absolute', left: z.left, width: z.w, top: 60 * c.S, display: 'flex', fontFamily: c.head, fontWeight: 900, fontSize: sz(R), lineHeight: 1, letterSpacing: -2 * c.S, color: mediaOf(c, beat.assetIds?.[1]) ? '#fff' : pal.hiInk, transform: `scale(${1 + 0.04 * lean})`, transformOrigin: '0% 0%' }}>{R}</div>
      </div>
      <div style={{ position: 'absolute', left: c.W / 2 - 80 * c.S, top: mid - 80 * c.S, width: 160 * c.S, height: 160 * c.S, borderRadius: '50%', background: pal.bg, color: pal.ink, display: 'grid', placeItems: 'center', fontFamily: c.head, fontWeight: 900, fontSize: 64 * c.S, transform: `scale(${vs}) rotate(${(1 - vs) * -90}deg)`, boxShadow: '0 16px 40px rgba(0,0,0,0.25)' }}>vs</div>
    </AbsoluteFill>
  );
};

const Stamp: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const words = beat.text.split(/\s+/).filter(Boolean);
  const size = fit(beat.text, c, 0.86 * k);
  const hitAt = stampHitAt(dur);
  const drop = interpolate(f, [hitAt - 6, hitAt], [0, 1], { ...cl, easing: Easing.in(Easing.cubic) });
  // anticipation: the stamp hovers in, lifts, then slams
  const hover = interpolate(f, [hitAt - 16, hitAt - 10], [0, 1], { ...cl, easing: outCubic });
  const lift = windup(f, hitAt - 5, 9);
  const sh = beat.impact ? shake(f, hitAt, c, 22) : { x: 0, y: 0 };
  const own = beat.impact ? { x: 0, y: 0 } : shake(f, hitAt, c, 9); // the stamp alone jolts
  const ring = interpolate(f, [hitAt, hitAt + 12], [0, 1], { ...cl, easing: outCubic });
  const label = (beat.stampText || beat.emphasis || '').toUpperCase();
  const st = 460 * c.S;
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, transform: `translate(${sh.x}px, ${sh.y}px)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: z.h * 0.12, display: 'flex', flexWrap: 'wrap' }}>
        {words.map((w, i) => {
          const at = 2 + stagger(i, words.length, 2);
          const t = interpolate(f, [at, at + 9], [0, 1], { ...cl, easing: outCubic });
          return <span key={i} style={{ display: 'inline-block', marginRight: 20 * c.S, fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -2 * c.S, color: pal.ink, opacity: t, transform: `translateY(${(1 - t) * 40 * c.S}px)` }}>{w}</span>;
        })}
      </div>
      {label ? (
        <div style={{ position: 'absolute', right: -20 * c.S, top: z.h * 0.42, width: st, height: st, transform: `translate(${own.x}px, ${own.y}px)` }}>
          <div style={{ position: 'absolute', inset: -ring * 60 * c.S, borderRadius: '50%', border: `${6 * c.S}px solid ${pal.hi}`, opacity: (1 - ring) * (f >= hitAt ? 0.8 : 0) }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%', border: `${12 * c.S}px double ${pal.hi}`, display: 'grid', placeItems: 'center', textAlign: 'center',
            fontFamily: c.head, fontWeight: 900, fontSize: Math.min(110 * c.S, (st * 0.8) / Math.max(4, label.length * 0.64)), letterSpacing: 3 * c.S, color: pal.hi, background: `${pal.bg}cc`,
            opacity: f >= hitAt - 16 ? 0.18 * hover + (0.82 * drop) : 0, transform: `scale(${(2.6 - 1.6 * drop) * (1 + 0.14 * lift)}) rotate(${-14 + (1 - drop) * 20 + lift * 6}deg)`, padding: 24 * c.S, lineHeight: 1,
          }}>{label}</div>
        </div>
      ) : null}
    </div>
  );
};

const Circle: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const words = beat.text.split(/\s+/).filter(Boolean);
  const size = fit(beat.text, c, 1 * k);
  const revealEnd = circleDrawAt(words.length);
  const draw = interpolate(f, [revealEnd, revealEnd + 12], [0, 1], { ...cl, easing: outCubic });
  const L = 900;
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        {words.map((w, i) => {
          const at = 2 + stagger(i, words.length, 3);
          const t = interpolate(f, [at, at + 9], [0, 1], { ...cl, easing: outBack });
          const lit = isEmph(w, beat.emphasis);
          return (
            <span key={i} style={{ position: 'relative', display: 'inline-block', marginRight: 24 * c.S, marginBottom: 6 * c.S }}>
              <span style={{ display: 'inline-block', fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1.04, letterSpacing: -2 * c.S, color: pal.ink, opacity: t, transform: `scale(${0.6 + 0.4 * t})`, transformOrigin: '50% 80%' }}>{w}</span>
              {lit ? (
                <svg viewBox="0 0 300 140" preserveAspectRatio="none" style={{ position: 'absolute', left: '-16%', top: '-22%', width: '132%', height: '144%', overflow: 'visible' }}>
                  <path d="M40 78 C 30 22, 250 8, 276 58 C 298 104, 120 136, 46 112 C 8 98, 22 44, 120 30" fill="none" stroke={pal.hi} strokeWidth="9" strokeLinecap="round" strokeDasharray={L} strokeDashoffset={L * (1 - draw)} vectorEffect="non-scaling-stroke" />
                </svg>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ── picture scenes ───────────────────────────────────────────────────────────

const mediaOf = (c: StoryCtx, id?: string) => (id && c.media ? c.media[id] : undefined);

// the line lands on colour, then the picture grows from a card to full-bleed
const PhotoReveal: React.FC<SceneProps> = ({ beat, c, pal, dur, start, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const m = mediaOf(c, beat.assetId);
  const z = zone(c);
  const words = beat.text.split(/\s+/).filter(Boolean);
  const growAt = Math.max(10, Math.floor(dur * 0.3));
  const g = interpolate(f, [growAt, growAt + 14], [0, 1], { ...cl, easing: inOut });
  const cardIn = interpolate(f, [4, 14], [0, 1], { ...cl, easing: outBack });
  const pull = windup(f, growAt + 2, 9); // anticipation: it draws back before it opens
  const w = interpolate(g, [0, 1], [0.46, 1]) * c.W;
  const h = interpolate(g, [0, 1], [0.3, 1]) * c.H;
  const top = interpolate(g, [0, 1], [c.H * 0.58, 0]);
  const size = fit(beat.text, c, 0.9 * k);
  const textTop = interpolate(g, [0, 1], [z.top + z.h * 0.08, z.bottom - size * 2.4]);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: (c.W - w) / 2, top, width: w, height: h, borderRadius: interpolate(g, [0, 1], [40, 0]) * c.S, overflow: 'hidden', transform: `scale(${(0.7 + 0.3 * cardIn) * (1 - 0.06 * pull)}) rotate(${(1 - g) * -3}deg)`, opacity: cardIn, boxShadow: '0 30px 80px rgba(0,0,0,0.3)' }}>
        <MediaFill m={m} dur={dur} variant={1} depth />
        <AbsoluteFill style={{ background: `linear-gradient(0deg, rgba(0,0,0,${0.55 * g}) 0%, rgba(0,0,0,0) 55%)` }} />
      </div>
      <div style={{ position: 'absolute', left: z.left, width: z.w, top: textTop, display: 'flex', flexWrap: 'wrap', textShadow: g > 0.5 ? '0 4px 24px rgba(0,0,0,0.5)' : 'none' }}>
        {words.map((wd, i) => {
          const at = stagger(i, words.length, 2);
          const t = interpolate(f, [at, at + 9], [0, 1], { ...cl, easing: outCubic });
          const lit = isEmph(wd, beat.emphasis);
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'hidden', marginRight: 20 * c.S, paddingBottom: 6 * c.S }}>
              <span style={{ display: 'inline-block', fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1.02, letterSpacing: -2 * c.S, color: lit ? pal.hi : (g > 0.5 ? '#fff' : pal.ink), transform: `translateY(${(1 - t) * 110}%)` }}>{wd}</span>
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// the picture punch-zooms into what it is about; a ring marks it; the line pops in
const ZoomPunch: React.FC<SceneProps> = ({ beat, c, pal, dur, start, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const m = mediaOf(c, beat.assetId);
  const z = zone(c);
  const at = Math.max(8, Math.floor(dur * 0.28));
  const flash = interpolate(f, [at, at + 2, at + 6], [0, 0.55, 0], cl);
  const ring = interpolate(f, [at + 6, at + 18], [0, 1], { ...cl, easing: outCubic });
  const txt = interpolate(f, [at + 10, at + 18], [0, 1], { ...cl, easing: outBack });
  // after the zoom the focal point sits at the frame's centre (transform-origin = focal)
  const cx = c.W / 2; const cy = c.H * 0.46;
  const R = 230 * c.S;
  const size = Math.min(110 * c.S, fit(beat.text, c, 0.72 * k));
  const words = beat.text.split(/\s+/).filter(Boolean);
  return (
    <AbsoluteFill>
      <MediaFill m={m} dur={dur} variant={0} zoom={{ at, to: 1.55, len: 7 }} depth />
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 46%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.5) 75%)', opacity: ring }} />
      <svg width={c.W} height={c.H} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={pal.hi} strokeWidth={10 * c.S} strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * (1 - ring)} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', left: z.left, width: z.w, top: z.bottom - size * 2.6, display: 'flex', flexWrap: 'wrap', opacity: txt, transform: `translateY(${(1 - txt) * 40 * c.S}px)` }}>
        {words.map((wd, i) => {
          const lit = isEmph(wd, beat.emphasis);
          return <span key={i} style={{ display: 'inline-block', marginRight: 18 * c.S, marginBottom: 8 * c.S, fontFamily: c.head, fontWeight: 900, fontSize: size, lineHeight: 1.04, letterSpacing: -2 * c.S, color: lit ? pal.hiInk : '#fff', background: lit ? pal.hi : 'transparent', padding: lit ? `0 ${12 * c.S}px` : 0, borderRadius: 12 * c.S, textShadow: lit ? 'none' : '0 4px 24px rgba(0,0,0,0.6)' }}>{wd}</span>;
        })}
      </div>
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
    </AbsoluteFill>
  );
};

// the picture drops in as a tilted print, the line written under it
const Polaroid: React.FC<SceneProps> = ({ beat, c, pal, dur, start, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const m = mediaOf(c, beat.assetId);
  const m2 = mediaOf(c, beat.assetIds?.find((x) => x !== beat.assetId));
  const drop = interpolate(f, [0, 12], [0, 1], { ...cl, easing: outBack });
  const drop2 = interpolate(f, [5, 16], [0, 1], { ...cl, easing: outBack });
  const write = interpolate(f, [12, 12 + Math.max(10, beat.text.length * 0.8)], [0, 1], cl);
  const cw = 760 * c.S; const ph = 820 * c.S; const pad = 28 * c.S; const foot = 190 * c.S;
  const left = (c.W - cw) / 2; const top = c.H * 0.16;
  const size = Math.min(70 * c.S, fit(beat.text, c, 0.5 * k));
  const print = (mm: MotionMedia | undefined, t: number, rot: number, dx: number) => (
    <div style={{ position: 'absolute', left: left + dx, top, width: cw, background: '#fbfaf7', padding: pad, paddingBottom: foot, boxShadow: '0 30px 70px rgba(0,0,0,0.3)', transform: `translateY(${(1 - t) * -900 * c.S}px) rotate(${rot + (1 - t) * -10}deg)`, opacity: t > 0 ? 1 : 0 }}>
      <div style={{ position: 'relative', width: cw - pad * 2, height: ph, overflow: 'hidden', background: '#ddd' }}><MediaFill m={mm} dur={dur} variant={2} /></div>
    </div>
  );
  return (
    <AbsoluteFill>
      {m2 ? print(m2, drop2 * 0.98, 6, 60 * c.S) : null}
      {print(m, drop, -4, 0)}
      <div style={{ position: 'absolute', left: left + pad * 1.4, width: cw - pad * 3, top: top + pad + ph + 40 * c.S, transform: 'rotate(-4deg)', transformOrigin: '0 0', fontFamily: c.head, fontWeight: 800, fontSize: size, lineHeight: 1.1, color: '#2a2a2a', clipPath: `inset(0 ${(1 - write) * 100}% 0 0)` }}>
        {beat.text.split(/\s+/).map((wd, i) => <span key={i} style={{ color: isEmph(wd, beat.emphasis) ? pal.hi : undefined }}>{wd}{' '}</span>)}
      </div>
    </AbsoluteFill>
  );
};

// a quality or material word set huge in outline, then filled from below like a liquid rising
// (video-shotcraft typography/outline-word-fill) → "warmth", "texture", "light", "calm"
const OutlineFill: React.FC<SceneProps> = ({ beat, c, pal, dur, start, area, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const z = zone(c, area);
  const all = beat.text.split(/\s+/).filter(Boolean);
  const keyIdx = Math.max(0, all.findIndex((w) => isEmph(w, beat.emphasis)));
  const key = (all[keyIdx] || beat.text).replace(/[.,!?;:]+$/, '');
  const before = all.slice(0, keyIdx); const after = all.slice(keyIdx + 1);
  const small = Math.min(84 * c.S, fit(beat.text, c, 0.5 * k));
  // heavy display faces run ~0.7 em a letter: size so the word still fits the column
  const big = Math.min(330 * c.S * k, (z.w * 0.94) / Math.max(2, key.length * 0.7));
  const fillAt = outlineFillAt(all.length);
  const fill = interpolate(f, [fillAt, fillAt + FILL_LEN], [0, 1], { ...cl, easing: inOut });
  const keyIn = interpolate(f, [2, 12], [0, 1], { ...cl, easing: outCubic });
  const land = interpolate(f, [fillAt + FILL_LEN, fillAt + FILL_LEN + 6, fillAt + FILL_LEN + 14], [0, 1, 0], cl);
  // the liquid's surface: a gentle wave that calms as it fills
  const pts: string[] = [];
  const amp = 3.2 * (1 - fill * 0.8);
  for (let x = 0; x <= 100; x += 5) pts.push(`${x}% ${(1 - fill) * 104 - 2 + amp * Math.sin(x / 9 + f / 3)}%`);
  const clip = `polygon(${pts.join(', ')}, 100% 100%, 0% 100%)`;
  const word = (style: React.CSSProperties) => (
    <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: big, lineHeight: 1, letterSpacing: -3 * c.S, whiteSpace: 'nowrap', ...style }}>{key}</div>
  );
  // the small words keep reading order: those before the key word above it, the rest below
  const n = before.length + after.length;
  const line = (ws: string[], from: number) => ws.length ? (
    <div style={{ display: 'flex', flexWrap: 'wrap' }}>
      {ws.map((w, i) => {
        const at = 10 + stagger(from + i, Math.max(1, n), 3);
        const t = interpolate(f, [at, at + 10], [0, 1], { ...cl, easing: outCubic });
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', marginRight: 16 * c.S }}>
            <span style={{ display: 'inline-block', fontFamily: c.head, fontWeight: 800, fontSize: small, lineHeight: 1.08, color: pal.ink, transform: `translateY(${(1 - t) * 110}%)` }}>{w}</span>
          </span>
        );
      })}
    </div>
  ) : null;
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.top, width: z.w, height: z.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 * c.S }}>
      {line(before, 0)}
      <div style={{ position: 'relative', opacity: keyIn, transform: `translateY(${(1 - keyIn) * 50 * c.S}px) scale(${1 + 0.03 * land})`, transformOrigin: '0% 60%' }}>
        {word({ color: 'transparent', WebkitTextStroke: `${Math.max(3, 4 * c.S)}px ${pal.ink}` })}
        <div style={{ position: 'absolute', inset: 0, clipPath: clip }}>{word({ color: pal.hi })}</div>
      </div>
      {line(after, before.length)}
    </div>
  );
};

// the key word set huge with the picture showing THROUGH its letters, then the camera flies into
// a letter and the picture opens full-bleed (video-shotcraft opening/text-as-mask)
const TextMask: React.FC<SceneProps> = ({ beat, c, pal, dur, start, k = 1 }) => {
  const f = useCurrentFrame() - start;
  const m = mediaOf(c, beat.assetId);
  const z = zone(c);
  const all = beat.text.split(/\s+/).filter(Boolean);
  const key = ((all.find((w) => isEmph(w, beat.emphasis)) || all[0] || '').replace(/[.,!?;:]+$/, '')).toUpperCase();
  const size = Math.min(420 * c.S * k, (c.W * 0.9) / Math.max(2, key.length * 0.66));
  const openAt = maskOpenAt(dur);
  const keyIn = interpolate(f, [0, 12], [0, 1], { ...cl, easing: outCubic });
  const pull = windup(f, openAt + 1, 8); // it draws back before the dive
  const dive = interpolate(f, [openAt, openAt + MASK_LEN], [0, 1], { ...cl, easing: Easing.in(Easing.cubic) });
  const scale = (1.12 - 0.12 * keyIn) * (1 - 0.06 * pull) * (1 + 26 * dive ** 2.2);
  const cover = interpolate(f, [openAt + MASK_LEN - 5, openAt + MASK_LEN + 2], [1, 0], cl);
  const line = all.filter((w) => w.replace(/[.,!?;:]+$/, '').toUpperCase() !== key);
  const lineSize = Math.min(96 * c.S, fit(line.join(' ') || 'x', c, 0.7 * k));
  const cx = c.W / 2; const cy = c.H * 0.46;
  const id = `tm-${start}-${key.length}`;
  return (
    <AbsoluteFill>
      <MediaFill m={m} dur={dur} variant={0} depth />
      {cover > 0 ? (
        <svg width={c.W} height={c.H} style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={c.W} height={c.H}>
              <rect x={0} y={0} width={c.W} height={c.H} fill="#fff" />
              <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
                <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontFamily={c.head} fontWeight={900} fontSize={size} letterSpacing={-2 * c.S} fill="#000">{key}</text>
              </g>
            </mask>
          </defs>
          <rect x={0} y={0} width={c.W} height={c.H} fill={pal.bg} mask={`url(#${id})`} opacity={cover} />
        </svg>
      ) : null}
      <div style={{ position: 'absolute', left: z.left, width: z.w, top: z.bottom - lineSize * 2.5, display: 'flex', flexWrap: 'wrap', textShadow: '0 4px 24px rgba(0,0,0,0.55)' }}>
        {line.map((w, i) => {
          const at = openAt + MASK_LEN + 2 + stagger(i, line.length, 2.5);
          const t = interpolate(f, [at, at + 10], [0, 1], { ...cl, easing: outCubic });
          return (
            <span key={i} style={{ display: 'inline-block', overflow: 'hidden', marginRight: 18 * c.S, paddingBottom: 6 * c.S }}>
              <span style={{ display: 'inline-block', fontFamily: c.head, fontWeight: 900, fontSize: lineSize, lineHeight: 1.04, letterSpacing: -2 * c.S, color: '#fff', transform: `translateY(${(1 - t) * 110}%)` }}>{w}</span>
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const SCENES: Record<string, React.FC<SceneProps>> = {
  slam: Slam, strike_swap: StrikeSwap, prompt_type: PromptType, marker: Marker,
  checklist: Checklist, split: Split, stamp: Stamp, circle: Circle,
  photo_reveal: PhotoReveal, zoom_punch: ZoomPunch, polaroid: Polaroid,
  outline_fill: OutlineFill, text_mask: TextMask,
};
// scenes that draw their own picture (the others run over it)
const OWN_PICTURE = new Set(['photo_reveal', 'zoom_punch', 'polaroid', 'split', 'text_mask']);

// one beat: its ground, its entrance over the last beat, grain, the scene
export const BeatScene: React.FC<{ beat: Beat; c: StoryCtx; pal: Pal; dur: number; enter: string; enterLen: number; index: number; marquee?: boolean }> = ({ beat, c, pal, dur, enter, enterLen, index, marquee = true }) => {
  const f = useCurrentFrame();
  const Scene = SCENES[beat.scene] || Slam;
  const word = beat.emphasis || '';
  const m = mediaOf(c, beat.assetId);
  // a picture under a text scene: white type on a soft shade, the accent kept
  const over = Boolean(m) && !OWN_PICTURE.has(beat.scene);
  // on (or of) a picture the highlight is always the accent — the dark ink would vanish on it
  const usePal: Pal = over
    ? { bg: '#000', ink: '#FFFFFF', hi: c.brand.accent, hiInk: c.brand.accentInk, shadow: true }
    : m ? { ...pal, hi: c.brand.accent, hiInk: c.brand.accentInk } : pal;
  return (
    <AbsoluteFill style={{ ...entranceStyle(enter, f, enterLen, c), overflow: 'hidden' }}>
      <AbsoluteFill style={{ background: pal.bg }} />
      {over ? (
        <>
          <MediaFill m={m} dur={dur} variant={index} depth />
          <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.6) 100%)' }} />
        </>
      ) : null}
      {marquee && word && !over && !OWN_PICTURE.has(beat.scene) ? <Marquee word={word} c={c} pal={pal} y={c.H * (index % 2 ? 0.08 : 0.74)} dir={index % 2 ? -1 : 1} /> : null}
      {/* parallax: over a picture the type drifts against the photo's own move, so the two read as layers */}
      <AbsoluteFill style={{ textShadow: usePal.shadow ? '0 4px 26px rgba(0,0,0,0.55)' : undefined, transform: over ? `translateY(${interpolate(f, [0, dur], [18, -18]) * c.S}px)` : undefined }}>
        <Scene beat={beat} c={c} pal={usePal} dur={dur} start={0} />
      </AbsoluteFill>
      {c.grain === false ? null : <Grain id={`b${index}`} opacity={over ? 0.05 : 0.09} />}
      <WipeEdge kind={enter} len={enterLen} pal={pal} c={c} />
    </AbsoluteFill>
  );
};

/** The whole main segment: beats in sequence, overlapping by their entrance. */
export const MotionStory: React.FC<{ beats: Beat[]; c: StoryCtx; dur: number; palOffset?: number }> = ({ beats, c, dur, palOffset = 0 }) => {
  const { fps } = useVideoConfig();
  const pals = palettes(c);
  // where each beat starts, which may hit the whole frame, which is the signature move (motionTiming.ts)
  const plan = React.useMemo(() => planStory(beats, dur, fps), [beats, dur, fps]);
  return (
    <AbsoluteFill style={{ background: pals[palOffset % 3].bg }}>
      {beats.map((b, i) => {
        const enter = i === 0 ? 'none' : i === plan.signature ? 'through' : ENTRANCES[(i - 1) % ENTRANCES.length];
        return (
          <Sequence key={i} from={plan.froms[i]} durationInFrames={plan.lens[i]} layout="none">
            <BeatScene beat={{ ...b, impact: plan.impact[i] }} c={c} pal={pals[(i + palOffset) % 3]} dur={plan.lens[i]} enter={enter} enterLen={plan.enters[i]} index={i} />
          </Sequence>
        );
      })}
      {c.sfx !== false ? <SfxTrack events={storySfx(beats, dur, fps)} total={dur} /> : null}
    </AbsoluteFill>
  );
};

/**
 * One scene as a caption over a picture (photo formats): no box, white type on
 * a soft band where the caption sits, the key word acted on by the scene.
 */
export const BeatCaption: React.FC<{ text: string; scene: string; emphasis?: string; c: StoryCtx; top: number; h: number; dur: number }> = ({ text, scene, emphasis, c, top, h, dur }) => {
  const f = useCurrentFrame();
  const Scene = SCENES[scene] || Marker;
  const out = interpolate(f, [dur - 6, dur], [1, 0], cl);
  const band = interpolate(f, [0, 8], [0, 1], cl);
  const pal: Pal = { bg: '#000', ink: '#FFFFFF', hi: c.brand.accent, hiInk: c.brand.accentInk, shadow: true };
  const below = top > c.H / 2;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: below ? top - 120 * c.S : 0, height: below ? c.H - top + 120 * c.S : top + h + 140 * c.S, opacity: band, background: below ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 45%)' : 'linear-gradient(0deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 45%)' }} />
      <AbsoluteFill style={{ textShadow: '0 4px 26px rgba(0,0,0,0.55)' }}>
        <Scene beat={{ scene, text, emphasis }} c={c} pal={pal} dur={dur} start={0} area={{ top, h }} k={0.62} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
