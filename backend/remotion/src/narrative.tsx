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
  // back to the speaker on a short fade (the speaker is underneath)
  const exit = scene.exit === 'fade' ? interpolate(frame, [scene.durationInFrames - 6, scene.durationInFrames], [1, 0], { ...clamp, easing: ease }) : 1;
  const style: React.CSSProperties = scene.transition === 'soft' || scene.transition === 'fade' || exit < 1 ? {
    opacity: (scene.transition === 'soft' || scene.transition === 'fade' ? t : 1) * exit,
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

/* ══ TWO-VOICE CAPTIONS (caption agent, 2026-11-22 — the studio's reference reel) ═══════════════════
   A caption is 2–5 words that appear as they are said. Lead words: small, light, lowercase-ish.
   One key word (the agent's `key`) is set ~2.2× larger in the face its meaning asks for — a tall
   condensed sans for things and numbers, a fat display serif for qualities and verdicts, or wide
   letter-spacing for an airy word. Position follows the shot: above the head on the speaker, lower
   third on inserts, the seam on a split; on a ✓/✗ card the words turn dark. No backdrop — a soft
   shadow only, as in the reference. */
export const TwoVoiceCaptions: React.FC<{ captions: ReelCaption[]; scenes: ReelScene[]; endFrame: number; faces: { lead: string; condensed: string; serif: string }; chapters?: { fromFrame: number; durationInFrames: number }[] }> = ({ captions, scenes, endFrame, faces, chapters = [] }) => {
  const frame = useCurrentFrame();
  if (frame >= endFrame) return null;
  const cue = captions.find((c) => frame >= c.fromFrame && frame < c.toFrame);
  if (!cue) return null;
  const over = scenes.filter((s) => !s.speaker && frame >= s.from && frame < s.from + s.durationInFrames).pop();
  const onCard = Boolean(over?.card || over?.explainer);
  // a chapter title owns the lower third while it shows: the caption goes up top
  const chapterOn = chapters.some((c) => frame >= c.fromFrame && frame < c.fromFrame + c.durationInFrames);
  const pos = onCard ? 'lower' : chapterOn ? 'top' : (cue.pos || 'top');
  const top = onCard ? 80 : pos === 'top' ? 17 : pos === 'center' ? 50 : 72;
  // ink + scrim come from the measured picture behind this caption (reelCaptionContrast.js)
  const ink = onCard ? '#1d1d1f' : (cue.ink || '#fff');
  const darkInk = !onCard && ink.toUpperCase() !== '#FFF' && ink.toUpperCase() !== '#FFFFFF';
  const scrim = onCard ? undefined : cue.scrim;
  const shadow = onCard ? 'none' : darkInk ? '0 1px 12px rgba(255,255,255,0.55)' : '0 2px 18px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.4)';
  const keyInk = cue.keyColor || ink;
  const out = interpolate(frame, [cue.toFrame - 3, cue.toFrame], [1, 0], clamp);
  const keyAt = typeof cue.key === 'number' ? cue.key : -1;
  // lead words before the key on one line, the key (with what follows) on the next — as in the reference
  const before = keyAt > 0 ? cue.words.slice(0, keyAt) : keyAt === 0 ? [] : cue.words;
  const keyWord = keyAt >= 0 ? cue.words[keyAt] : null;
  const after = keyAt >= 0 ? cue.words.slice(keyAt + 1) : [];
  const shown = (w: { fromFrame: number }) => interpolate(frame, [w.fromFrame - 1, w.fromFrame + 3], [0, 1], { ...clamp, easing: ease });
  const lead = (w: { text: string; fromFrame: number }, k: number) => {
    const t = shown(w);
    return (
      <span key={`l${k}`} style={{
        display: 'inline-block', fontFamily: faces.lead, fontWeight: 500, fontSize: 52, letterSpacing: 0.2,
        color: ink, textShadow: shadow, opacity: t, transform: `translateY(${interpolate(t, [0, 1], [6, 0])}px)`,
      }}>{w.text}</span>
    );
  };
  let keyEl = null;
  if (keyWord) {
    const t = shown(keyWord);
    const style = cue.keyStyle || 'condensed';
    const marker: React.CSSProperties = cue.keyBg
      ? { background: cue.keyBg, padding: '0.04em 0.16em 0.02em', borderRadius: 8, boxShadow: '0 6px 22px rgba(0,0,0,0.18)' }
      : {};
    const base: React.CSSProperties = {
      ...marker,
      display: 'inline-block', color: keyInk, textShadow: cue.keyBg ? 'none' : shadow, lineHeight: 1.0,
      opacity: t, transform: `scale(${interpolate(t, [0, 1], [0.94, 1])})`, transformOrigin: '50% 70%',
    };
    keyEl = style === 'serif'
      ? <span style={{ ...base, fontFamily: faces.serif, fontSize: 112, letterSpacing: -0.5 }}>{keyWord.text}</span>
      : style === 'spaced'
        ? <span style={{ ...base, fontFamily: faces.serif, fontSize: 84, letterSpacing: '0.42em', marginRight: '-0.42em', textTransform: 'lowercase' }}>{keyWord.text}</span>
        : <span style={{ ...base, fontFamily: faces.condensed, fontSize: 118, letterSpacing: 0.5, textTransform: 'lowercase' }}>{keyWord.text}</span>;
  }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '7%', right: '7%', top: `${top}%`, transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, textAlign: 'center', opacity: out, isolation: 'isolate',
      }}>
        {scrim ? (
          /* a soft blurred glow that hugs the words (no box, no edge) */
          <div style={{
            position: 'absolute', left: '50%', top: '50%', width: `${Math.min(100, 30 + cue.words.map((w) => w.text).join(' ').length * 3.2)}%`, height: keyEl && before.length ? '120%' : '135%',
            transform: 'translate(-50%, -50%)', zIndex: -1, borderRadius: 999, filter: 'blur(26px)',
            background: scrim === 'dark' ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.6)',
          }} />
        ) : null}
        {before.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, alignItems: 'baseline' }}>
            {before.map(lead)}
          </div>
        )}
        {keyEl && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, alignItems: 'baseline' }}>
            {keyEl}
            {after.map((w, k) => lead(w, k + 100))}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/* ── chapter title card (cut agent's `label` on a new point): two lines, uppercase, condensed ───── */
export const ChapterTitle: React.FC<{ text: string; durationInFrames: number; font: string; ink?: string; scrim?: 'dark' | 'light' }> = ({ text, durationInFrames, font, ink = '#fff', scrim }) => {
  const frame = useCurrentFrame();
  const tin = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: ease });
  const tout = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '30%', pointerEvents: 'none' }}>
      <div style={{
        maxWidth: '78%', textAlign: 'center', fontFamily: font, fontSize: 104, lineHeight: 0.98, letterSpacing: 1,
        textTransform: 'uppercase', color: ink,
        textShadow: ink.toUpperCase() === '#FFF' || ink.toUpperCase() === '#FFFFFF' ? '0 3px 24px rgba(0,0,0,0.5)' : '0 1px 14px rgba(255,255,255,0.55)',
        opacity: tin * tout, transform: `translateY(${interpolate(tin, [0, 1], [22, 0])}px)`, position: 'relative', isolation: 'isolate',
      }}>
        {scrim ? (
          <div style={{
            position: 'absolute', left: '-6%', right: '-6%', top: '-12%', bottom: '-12%', zIndex: -1, borderRadius: 999, filter: 'blur(30px)',
            background: scrim === 'dark' ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.6)',
          }} />
        ) : null}
        {text}
      </div>
    </AbsoluteFill>
  );
};

/* ── ✓/✗ explainer card (motion agent's `verdict`): the photo inset on white, a badge and a title ── */
export const VerdictCard: React.FC<{ card: { verdict: 'good' | 'bad'; title: string }; font: string; children: React.ReactNode }> = ({ card, font, children }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease });
  const badge = interpolate(frame, [4, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  const good = card.verdict === 'good';
  return (
    <AbsoluteFill style={{ background: '#f6f5f2', opacity: t }}>
      <div style={{ position: 'absolute', top: '9%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <div style={{
          width: 120, height: 120, borderRadius: 999, background: good ? '#2fa84f' : '#e0403a', color: '#fff',
          display: 'grid', placeItems: 'center', fontSize: 74, fontWeight: 800, fontFamily: font,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)', transform: `scale(${badge})`,
        }}>{good ? '✓' : '✕'}</div>
        <div style={{ fontFamily: font, fontSize: 56, fontWeight: 700, color: '#1d1d1f', letterSpacing: -0.6, textAlign: 'center', maxWidth: '82%' }}>{card.title}</div>
      </div>
      <div style={{
        position: 'absolute', left: '8%', right: '8%', top: '28%', height: '44%', borderRadius: 28, overflow: 'hidden',
        boxShadow: '0 18px 50px rgba(0,0,0,0.18)', transform: `translateY(${interpolate(t, [0, 1], [26, 0])}px)`,
      }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

/* a speaker piece after a jump cut: dissolves in over the outgoing piece (which runs on underneath) */
export const SpeakerIn: React.FC<{ scene: ReelScene; children: React.ReactNode }> = ({ scene, children }) => {
  const frame = useCurrentFrame();
  if (scene.transition !== 'fade') return <>{children}</>;
  const t = interpolate(frame, [0, 4], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  return <AbsoluteFill style={{ opacity: t }}>{children}</AbsoluteFill>;
};
