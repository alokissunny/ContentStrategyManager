import { z } from 'zod';

/**
 * Cover spec — the contract between the Carousel Cover Agent (LLM JSON output)
 * and the Remotion <AnimatedCover> composition (inputProps).
 *
 * The agent NEVER emits code or arbitrary SVG. It emits this bounded, validated
 * data structure; the composition is fixed, hand-written React that knows how to
 * animate any valid spec deterministically from `useCurrentFrame()`.
 *
 * All illustration coordinates are percentages (0–100) of the illustration box,
 * so a spec is resolution-independent.
 */

const hex = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex color like #B5482E');

export const brandSchema = z.object({
  bg: hex.default('#EDE7DC'),
  ink: hex.default('#1B1A17'),
  accent: hex.default('#B5482E'),
  muted: hex.default('#8C8578'),
  hairline: hex.default('#CFC6B7'),
  // Font family names. Resolved to the renderable brand faces in AnimatedCover;
  // unknown names fall back by category. `serif`/`sans` kept for back-compat.
  headlineFont: z.string().default(''),
  bodyFont: z.string().default(''),
  serif: z.string().default('Playfair Display'),
  sans: z.string().default('Inter'),
});

export const formatSchema = z.object({
  width: z.number().int().min(240).max(2160).default(1080),
  height: z.number().int().min(240).max(2160).default(1350),
  fps: z.number().int().min(12).max(60).default(30),
  durationInFrames: z.number().int().min(24).max(1800).default(240),
});

export const headerSchema = z.object({
  eyebrow: z.string().max(64).default(''),
  counter: z.string().max(16).default(''),
});

const headlineLine = z.object({
  text: z.string().max(120),
  italic: z.boolean().default(false),
  accent: z.boolean().default(false),
});

export const headlineSchema = z.object({
  reveal: z.enum(['line', 'word', 'mask']).default('line'),
  lines: z.array(headlineLine).min(1).max(5),
});

export const footerSchema = z.object({
  label: z.string().max(80).default(''),
  cta: z.string().max(48).default('SWIPE'),
  arrow: z.boolean().default(true),
});

// ── Illustration primitives (bounded, safe vector vocabulary) ────────────────
const pct = z.number().min(-20).max(120);
const point = z.tuple([pct, pct]);

const baseEl = z.object({
  // frames, relative to the illustration beat, at which this element starts
  appearAt: z.number().min(0).max(600).default(0),
  // frames over which a stroke "draws on" (dashoffset) / a fill fades in
  drawFrames: z.number().min(0).max(300).default(18),
  stroke: z.enum(['ink', 'accent', 'muted', 'hairline']).default('ink'),
  fill: z.enum(['none', 'ink', 'accent', 'muted', 'bg', 'hairline']).default('none'),
  strokeWidth: z.number().min(0.2).max(6).default(1.4),
});

const rectEl = baseEl.extend({
  type: z.literal('rect'),
  x: pct, y: pct, w: pct, h: pct,
  radius: z.number().min(0).max(50).default(0),
});
const lineEl = baseEl.extend({
  type: z.literal('line'),
  x1: pct, y1: pct, x2: pct, y2: pct,
});
const polylineEl = baseEl.extend({
  type: z.literal('polyline'),
  points: z.array(point).min(2).max(24),
  closed: z.boolean().default(false),
});
const dotEl = baseEl.extend({
  type: z.literal('dot'),
  x: pct, y: pct, r: z.number().min(0.2).max(20).default(1.2),
});
const labelEl = baseEl.extend({
  type: z.literal('label'),
  x: pct, y: pct,
  text: z.string().max(48),
  size: z.number().min(0.6).max(6).default(1.6),
  align: z.enum(['start', 'middle', 'end']).default('start'),
  weight: z.enum(['normal', 'bold']).default('normal'),
});
// leader = a short pointer line + tiny label, e.g. "BLANK SPACE →"
const leaderEl = baseEl.extend({
  type: z.literal('leader'),
  x1: pct, y1: pct, x2: pct, y2: pct,
  text: z.string().max(32),
  size: z.number().min(0.6).max(4).default(1.2),
});

export const illustrationElement = z.discriminatedUnion('type', [
  rectEl, lineEl, polylineEl, dotEl, labelEl, leaderEl,
]);

export const illustrationSchema = z.object({
  mode: z.enum(['primitives', 'image', 'none']).default('none'),
  caption: z.string().max(64).default(''),
  // when mode === 'image', the app supplies the pixels for this asset key
  imageAssetKey: z.string().max(200).default(''),
  imageUrl: z.string().max(2000).default(''),
  elements: z.array(illustrationElement).max(48).default([]),
});

// timeline beats are absolute start frames within the composition
export const timelineSchema = z.object({
  header: z.number().min(0).max(1800).default(0),
  headline: z.number().min(0).max(1800).default(8),
  illustration: z.number().min(0).max(1800).default(30),
  subtext: z.number().min(0).max(1800).default(70),
  footer: z.number().min(0).max(1800).default(55),
});

export const motionSchema = z.object({
  // How the headline lands. Chosen for the post, not fixed.
  headline: z.enum(['rise', 'wipe', 'fade-scale', 'typewriter', 'stagger-words']).default('rise'),
  ease: z.enum(['outCubic', 'inOutCubic', 'outExpo', 'spring']).default('outCubic'),
  stagger: z.number().min(0).max(30).default(6),
  // Subtle background life. 'none' keeps it flat.
  background: z.enum(['none', 'drift', 'breathe', 'grain']).default('none'),
});

// A foregrounded number/stat (for the 'stat' composition).
export const statSchema = z.object({
  value: z.string().max(24).default(''),
  label: z.string().max(80).default(''),
});

// Composition archetype — the whole layout shape. The agent picks one from the
// content structure + strategy, so covers are not all the same template.
export const COMPOSITIONS = [
  'editorial-stack', // header top · headline · optional sketch · footer cue
  'centered',        // headline centered, sparse, type-led
  'statement-left',  // large left-aligned statement, bottom-weighted
  'question',        // one big question, accent pivot, lots of air
  'stat',            // a number/stat foregrounded above a short line
  'quote',           // pull-quote treatment with an oversized mark
  'photo',           // full-bleed hook photo with the headline over a scrim
] as const;

export const coverSpecSchema = z.object({
  composition: z.enum(COMPOSITIONS).default('editorial-stack'),
  format: formatSchema.default({}),
  brand: brandSchema.default({}),
  header: headerSchema.default({}),
  headline: headlineSchema,
  subtext: z.object({ text: z.string().max(160).default('') }).default({}),
  stat: statSchema.default({}),
  footer: footerSchema.default({}),
  illustration: illustrationSchema.default({}),
  timeline: timelineSchema.default({}),
  motion: motionSchema.default({}),
});

export type CoverSpec = z.infer<typeof coverSpecSchema>;
export type Brand = z.infer<typeof brandSchema>;
export type IllustrationElement = z.infer<typeof illustrationElement>;
