/**
 * Narrative look for talking reels (studio's reference reel, 2026-11-21).
 *
 * Typography that follows the voice and stays out of the picture's way:
 *   - words appear as they are said, 1–3 at a time, small and light, no outline, a soft shadow;
 *   - the beat's key word (`em`, chosen by the editor) is set large and bold on its own line;
 *   - where the words sit depends on what is under them: below the face on the speaker, centred
 *     on full-screen B-roll, on the seam of a split;
 *   - the hook is a calm title card (white box, dark text), not a slam.
 * And the picture work that carries the narrative:
 *   - into B-roll on a soft push (blur + settle), a short dissolve between B-roll shots;
 *   - split: the B-roll slides into the top half while the speaker moves down and keeps talking.
 * Movement is small on purpose: enough to feel edited, never enough to pull the eye off the image.
 */
import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame } from 'remotion';
import type { ReelSpec, ReelScene, ReelCaption } from './reelSchema';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);
const SHADOW = '0 2px 22px rgba(0,0,0,0.42), 0 1px 3px rgba(0,0,0,0.35)';

/* ── split windows: adjacent split cutaways read as one stretch ─────────────── */
export function splitWindows(scenes: ReelScene[]): { a: number; b: number }[] {
  const list = scenes.filter((s) => s.layout === 'split' && !s.speaker)
    .map((s) => ({ a: s.from, b: s.from + s.durationInFrames }))
    .sort((x, y) => x.a - y.a);
  const out: { a: number; b: number }[] = [];
  list.forEach((w) => {
    const last = out[out.length - 1];
    if (last && w.a <= last.b + 1) last.b = Math.max(last.b, w.b);
    else out.push({ ...w });
  });
  return out;
}
export function splitAmount(windows: { a: number; b: number }[], frame: number): number {
  for (const w of windows) {
    if (frame < w.a || frame >= w.b) continue;
    const tin = interpolate(frame, [w.a, w.a + 10], [0, 1], { ...clamp, easing: ease });
    const tout = interpolate(frame, [w.b - 9, w.b], [1, 0], { ...clamp, easing: ease });
    return Math.min(tin, tout);
  }
  return 0;
}

/* ── a cutaway's entry (inside its Sequence: frame 0 = its first frame) ──────── */
export const Cutaway: React.FC<{ scene: ReelScene; split: number; children: React.ReactNode }> = ({ scene, split, children }) => {
  const frame = useCurrentFrame();
  if (scene.layout === 'split') {
    // the top half; the first shot of a split stretch slides down with it, the next ones dissolve
    const fade = scene.transition === 'fade' ? interpolate(frame, [0, 7], [0, 1], { ...clamp, easing: ease }) : 1;
    return (
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: '50%', overflow: 'hidden',
        transform: `translateY(${(split - 1) * 100}%)`, opacity: fade,
      }}>
        {children}
      </div>
    );
  }
  const soft = scene.transition === 'soft';
  const t = interpolate(frame, [0, soft ? 10 : 7], [0, 1], { ...clamp, easing: ease });
  const style: React.CSSProperties = scene.transition === 'soft' || scene.transition === 'fade' ? {
    opacity: t,
    transform: soft ? `scale(${interpolate(t, [0, 1], [1.07, 1])})` : undefined,
    filter: soft && t < 0.98 ? `blur(${interpolate(t, [0, 1], [14, 0])}px)` : undefined,
  } : {};
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

/* ── the hook: a calm title card ────────────────────────────────────────────── */
export const TitleHook: React.FC<{ spec: ReelSpec; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const hook = spec.hook;
  if (!hook?.text) return null;
  const tin = interpolate(frame, [2, 12], [0, 1], { ...clamp, easing: ease });
  const tout = interpolate(frame, [hook.durationInFrames - 7, hook.durationInFrames], [1, 0], clamp);
  const lit = (hook.emphasis || '').toLowerCase();
  const n = hook.text.split(/\s+/).length;
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', top: '34%', left: '50%', translate: '-50% -50%', width: 'max-content',
        maxWidth: '80%', padding: '22px 34px 26px', borderRadius: 24, background: 'rgba(255,255,255,0.96)',
        color: '#111', fontFamily: font, fontWeight: 600, fontSize: n <= 4 ? 64 : 56, lineHeight: 1.16,
        letterSpacing: -0.6, textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
        opacity: tin * tout, transform: `translateY(${interpolate(tin, [0, 1], [18, 0])}px)`,
      }}>
        {hook.text.split(/\s+/).map((w, i) => (
          <span key={i} style={{ fontWeight: lit && w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') === lit ? 800 : 600 }}>
            {i ? ' ' : ''}{w}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ── the words: whole short phrases, one size, one place (editor v2) ─────────────────────────────
   Studio's review of a reel: one word at a time and changing sizes were hard to follow, and white
   words blended into bright terrace shots. A cue (2–5 words) appears whole, at one size, on a soft
   dark backdrop; the beat's key words are picked out in the accent colour, never enlarged. It sits
   in the lower third (on the seam of a split). */
export const NarrativeCaptions: React.FC<{ captions: ReelCaption[]; scenes: ReelScene[]; font: string; endFrame: number; accent?: string }> = ({ captions, scenes, font, endFrame, accent = '#FFD75E' }) => {
  const frame = useCurrentFrame();
  if (frame >= endFrame) return null;
  const cue = captions.find((c) => frame >= c.fromFrame && frame < c.toFrame);
  if (!cue) return null;
  const over = scenes.filter((s) => !s.speaker && frame >= s.from && frame < s.from + s.durationInFrames).pop();
  // lower third, clear of the face on close selfie framing and of Instagram's bottom UI
  const top = over?.layout === 'split' ? 50 : 76;
  const tin = interpolate(frame, [cue.fromFrame, cue.fromFrame + 4], [0, 1], { ...clamp, easing: ease });
  const tout = interpolate(frame, [cue.toFrame - 3, cue.toFrame], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '50%', top: `${top}%`, translate: '-50% -50%', maxWidth: '84%', width: 'max-content',
        padding: '12px 26px 14px', borderRadius: 20, background: 'rgba(12,12,14,0.46)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        textAlign: 'center', fontFamily: font, fontSize: 58, fontWeight: 700, lineHeight: 1.18, letterSpacing: -0.4,
        color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.35)',
        opacity: tin * tout, transform: `translateY(${interpolate(tin, [0, 1], [10, 0])}px)`,
      }}>
        {cue.words.map((w, i) => (
          <span key={i} style={{ color: w.em ? accent : '#fff' }}>{i ? ' ' : ''}{w.text}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/* ── one look across sources (editor v2): phone footage and crisp renders meet in the middle ─────
   (studio's review: "warm, soft indoor phone footage switches to bright, crisp terrace renders").
   The speaker is lifted a touch, the inserts softened and warmed a touch, and a shared vignette
   ties them together. */
export const GRADE_SPEAKER = 'saturate(0.96) contrast(1.05) brightness(1.03)';
export const GRADE_INSERT = 'saturate(0.9) sepia(0.07) contrast(0.96) brightness(0.98)';
export const Vignette: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 58%, rgba(0,0,0,0.22) 100%)' }} />
);

/* ── the end card: a clean, readable hold (3 s), high contrast ─────────────────────────────────── */
export const NarrativeEnd: React.FC<{ spec: ReelSpec; font: string }> = ({ spec, font }) => {
  const frame = useCurrentFrame();
  const cta = spec.cta;
  if (!cta) return null;
  const tBg = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease });
  const tLine = interpolate(frame, [6, 18], [0, 1], { ...clamp, easing: ease });
  const tSub = interpolate(frame, [14, 26], [0, 1], { ...clamp, easing: ease });
  return (
    <AbsoluteFill style={{ background: `rgba(10,10,12,${0.66 * tBg})`, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: '82%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, textAlign: 'center' }}>
        <div style={{
          fontFamily: font, fontWeight: 800, fontSize: 84, lineHeight: 1.08, letterSpacing: -1.5, color: '#fff',
          textShadow: '0 2px 16px rgba(0,0,0,0.35)',
          opacity: tLine, transform: `translateY(${interpolate(tLine, [0, 1], [24, 0])}px)`,
        }}>{cta.line}</div>
        {cta.sub ? (
          <div style={{
            fontFamily: font, fontWeight: 700, fontSize: 44, color: '#111', background: '#fff',
            padding: '14px 34px 16px', borderRadius: 999, opacity: tSub,
            transform: `translateY(${interpolate(tSub, [0, 1], [14, 0])}px)`,
          }}>{cta.sub}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
