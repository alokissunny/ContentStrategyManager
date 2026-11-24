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
import { drawPalette, type BrandPalette } from './brandPalette';

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

/* ══ ONE MOTION LANGUAGE for every word in a talking reel (studio review, 2026-11-24) ══════════════
   "All text should use the same animation style and feel, with a very smooth ease-in." Hook, captions
   and chapter labels share it: each word rises a little (22 px) while it fades in, on a long soft
   ease-out, a few frames before it is said; a block leaves by fading while drifting up a touch. Sizes
   and faces vary with meaning — the motion never does. No boxes, no glow blobs. */
export const TEXT_MOTION = { rise: 22, inFrames: 10, lead: 2, stagger: 3, outFrames: 7, ease: Easing.bezier(0.16, 1, 0.3, 1) };
export const wordIn = (frame: number, at: number) => {
  const t = interpolate(frame, [at - TEXT_MOTION.lead, at - TEXT_MOTION.lead + TEXT_MOTION.inFrames], [0, 1], { ...clamp, easing: TEXT_MOTION.ease });
  return { opacity: t, transform: `translateY(${(1 - t) * TEXT_MOTION.rise}px)` };
};
export const blockOut = (frame: number, end: number) => {
  const t = interpolate(frame, [end - TEXT_MOTION.outFrames, end], [0, 1], { ...clamp, easing: Easing.bezier(0.4, 0, 1, 1) });
  return { opacity: 1 - t, transform: `translateY(${-t * 8}px)` };
};
/* a shadow only where the picture needs it (contrast measured per caption in reelCaptionContrast.js) */
export const textShadowFor = (ink: string, scrim?: 'dark' | 'light', onCard = false) => {
  if (onCard) return 'none';
  const white = ink.toUpperCase() === '#FFF' || ink.toUpperCase() === '#FFFFFF';
  if (scrim === 'dark') return '0 1px 2px rgba(0,0,0,0.35), 0 2px 10px rgba(0,0,0,0.35)';
  if (scrim === 'light') return '0 0 8px rgba(255,255,255,0.55)';
  return white ? '0 1px 2px rgba(0,0,0,0.22)' : 'none';
};

/* ── the hook: the first words, in the caption system (no card) — lead words + one key word ───────── */
export const TitleHook: React.FC<{ spec: ReelSpec; font: string; faces?: { heading: string; body: string; detail: string } }> = ({ spec, font, faces }) => {
  const frame = useCurrentFrame();
  const hook = spec.hook;
  if (!hook?.text) return null;
  const lit = (hook.emphasis || '').toLowerCase();
  const ws = hook.text.split(/\s+/);
  const ink = hook.ink || '#fff';
  const shadow = textShadowFor(ink, hook.scrim);
  const out = blockOut(frame, hook.durationInFrames);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '8%', right: '8%', top: '22%', transform: `translateY(-50%) ${out.transform}`, opacity: out.opacity,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', columnGap: 18, rowGap: 2, textAlign: 'center',
      }}>
        {ws.map((w, i) => {
          const key = lit && w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '') === lit;
          const m = wordIn(frame, 4 + i * TEXT_MOTION.stagger);
          return (
            <span key={i} style={{
              display: 'inline-block', color: ink, textShadow: shadow, ...m,
              ...(key && faces
                ? { fontFamily: faces.heading, fontSize: 100, fontWeight: 800, lineHeight: 1, letterSpacing: -1.5 }
                : { fontFamily: faces?.body || font, fontSize: 60, fontWeight: 600, lineHeight: 1.15, letterSpacing: -0.4 }),
            }}>{w}</span>
          );
        })}
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

/* ══ TWO-VOICE CAPTIONS (caption agent, 2026-11-22; motion + focus rules from the studio review 2026-11-24) ══
   A caption is 2–5 words that rise in as they are said (TEXT_MOTION). Lead words: small and light. One
   key word (the agent's `key`) larger, in the face its meaning asks for. One text block on screen at a
   time: a chapter is a small label ABOVE the caption, not a second headline; the hook replaces the
   captions while it shows. Where a caption sits, its ink and whether it is on a drawing card are fixed
   once per caption (no jumping mid-caption); captions that follow closely hand over without a blank. */
type Chapter = { text: string; fromFrame: number; durationInFrames: number };
export const TwoVoiceCaptions: React.FC<{ captions: ReelCaption[]; scenes: ReelScene[]; endFrame: number; faces: { heading: string; body: string; detail: string }; chapters?: Chapter[]; startFrame?: number; cardInk?: string }> = ({ captions, scenes, endFrame, faces, chapters = [], startFrame = 0, cardInk }) => {
  const frame = useCurrentFrame();
  if (frame >= endFrame || frame < startFrame) return null;
  const k = captions.findIndex((c, i) => {
    const next = captions[i + 1];
    const end = next && next.fromFrame - c.toFrame < 12 ? next.fromFrame : c.toFrame; // no blink between close captions
    return frame >= c.fromFrame && frame < end;
  });
  if (k < 0) return null;
  const cue = captions[k];
  const next = captions[k + 1];
  const end = Math.min(endFrame, next && next.fromFrame - cue.toFrame < 12 ? next.fromFrame : cue.toFrame);
  // the caption's place, decided once (at its middle), never per frame
  const mid = Math.round((cue.fromFrame + cue.toFrame) / 2);
  const under = scenes.filter((s) => !s.speaker && mid >= s.from && mid < s.from + s.durationInFrames).pop();
  const onCard = cue.onCard ?? Boolean(under?.card || under?.explainer);
  const pos = onCard ? 'lower' : (cue.pos || 'top');
  const top = onCard ? 84 : pos === 'top' ? 17 : pos === 'center' ? 50 : 74;
  const ink = onCard ? (cardInk || '#1d1d1f') : (cue.ink || '#fff');
  const shadow = textShadowFor(ink, cue.scrim, onCard);
  const keyInk = cue.keyColor || ink;
  // a captions-first start: the caption that is running when the hook ends appears whole
  const appear = (w: { fromFrame: number }) => wordIn(frame, Math.max(w.fromFrame, startFrame + TEXT_MOTION.lead));
  const out = blockOut(frame, end);
  // over a drawing card the drawing is the focus (studio review 2026-11-24): the caption is one quiet
  // line — no large key word, no brand marker, smaller, the card's ink
  const keyAt = onCard ? -1 : (typeof cue.key === 'number' ? cue.key : -1);
  const before = keyAt > 0 ? cue.words.slice(0, keyAt) : keyAt === 0 ? [] : cue.words;
  const keyWord = keyAt >= 0 ? cue.words[keyAt] : null;
  const after = keyAt >= 0 ? cue.words.slice(keyAt + 1) : [];
  // the chapter whose window this caption starts in: a quiet label above it
  const chapter = chapters.find((c) => cue.fromFrame >= c.fromFrame - 6 && cue.fromFrame < c.fromFrame + c.durationInFrames);
  const lead = (w: { text: string; fromFrame: number }, i: number) => (
    <span key={`l${i}`} style={{
      display: 'inline-block', fontFamily: faces.body, fontWeight: 500, fontSize: onCard ? 42 : 50, letterSpacing: 0.2, lineHeight: 1.15,
      color: ink, textShadow: shadow, ...appear(w),
    }}>{w.text}</span>
  );
  let keyEl = null;
  if (keyWord) {
    const m = appear(keyWord);
    // one face (the kit's heading) for every key word; meaning sets weight, size and spacing only
    const style = cue.keyStyle === 'serif' ? 'soft' : cue.keyStyle === 'condensed' ? 'strong' : (cue.keyStyle || 'strong');
    const base: React.CSSProperties = {
      display: 'inline-block', color: keyInk, lineHeight: 1.0, ...m,
      ...(cue.keyBg
        ? { background: cue.keyBg, padding: '0.04em 0.16em 0.02em', borderRadius: 8, textShadow: 'none' }
        : { textShadow: shadow }),
    };
    keyEl = style === 'soft'
      ? <span style={{ ...base, fontFamily: faces.heading, fontWeight: 400, fontSize: 100, letterSpacing: -1 }}>{keyWord.text}</span>
      : style === 'spaced'
        ? <span style={{ ...base, fontFamily: faces.heading, fontWeight: 500, fontSize: 62, letterSpacing: '0.28em', marginRight: '-0.28em', textTransform: 'uppercase' }}>{keyWord.text}</span>
        : <span style={{ ...base, fontFamily: faces.heading, fontWeight: 800, fontSize: 96, letterSpacing: -1.5 }}>{keyWord.text}</span>;
  }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '7%', right: '7%', top: `${top}%`, transform: `translateY(-50%) ${out.transform}`, opacity: out.opacity,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center',
      }}>
        {chapter ? (
          <div style={{
            fontFamily: faces.detail, fontWeight: 500, fontSize: 32, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: ink, textShadow: shadow, marginBottom: 6,
            ...(() => { const m = wordIn(frame, Math.max(chapter.fromFrame, cue.fromFrame)); return { ...m, opacity: m.opacity * 0.86 }; })(),
          }}>{chapter.text}</div>
        ) : null}
        {before.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 14, alignItems: 'baseline' }}>
            {before.map(lead)}
          </div>
        )}
        {keyEl && (
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', columnGap: 16, alignItems: 'baseline' }}>
            {keyEl}
            {after.map((w, i) => lead(w, i + 100))}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

/* ── chapter title (fallback narrative captions only): uppercase, condensed, the shared motion ───── */
export const ChapterTitle: React.FC<{ text: string; durationInFrames: number; font: string; ink?: string; scrim?: 'dark' | 'light' }> = ({ text, durationInFrames, font, ink = '#fff', scrim }) => {
  const frame = useCurrentFrame();
  const m = wordIn(frame, TEXT_MOTION.lead);
  const out = blockOut(frame, durationInFrames);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '30%', pointerEvents: 'none' }}>
      <div style={{
        maxWidth: '78%', textAlign: 'center', fontFamily: font, fontSize: 84, lineHeight: 0.98, letterSpacing: 1,
        textTransform: 'uppercase', color: ink, textShadow: textShadowFor(ink, scrim),
        opacity: m.opacity * out.opacity, transform: `${m.transform} ${out.transform}`,
      }}>{text}</div>
    </AbsoluteFill>
  );
};

/* ── ✓/✗ explainer card (motion agent's `verdict`): the photo inset on white, a badge and a title ── */
export const VerdictCard: React.FC<{ card: { verdict: 'good' | 'bad'; title: string }; font: string; children: React.ReactNode; palette?: BrandPalette | null }> = ({ card, font, children, palette }) => {
  const P = drawPalette(palette);
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: ease });
  const badge = interpolate(frame, [4, 14], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  const good = card.verdict === 'good';
  return (
    <AbsoluteFill style={{ background: P.paper, opacity: t }}>
      <div style={{ position: 'absolute', top: '9%', left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        <div style={{
          width: 120, height: 120, borderRadius: 999, background: good ? P.good : P.bad, color: good ? P.onGood : P.paper,
          display: 'grid', placeItems: 'center', fontSize: 74, fontWeight: 800, fontFamily: font,
          boxShadow: '0 10px 30px rgba(0,0,0,0.15)', transform: `scale(${badge})`,
        }}>{good ? '✓' : '✕'}</div>
        <div style={{ fontFamily: font, fontSize: 56, fontWeight: 700, color: P.ink, letterSpacing: -0.6, textAlign: 'center', maxWidth: '82%' }}>{card.title}</div>
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
