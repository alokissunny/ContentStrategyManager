/**
 * Reel styles (Captures › Generate reel › Choose reel style) — the on-screen
 * treatments a reference reel's style can call for. Used by CaptureReel only
 * when `reel.look` is set; the default look stays in CaptureReel.tsx.
 *
 *   overlay   serif-stack | serif-center | serif-accent | two-weight | bold-sans | pill
 *   hook      stack-repeat | serif-center | listicle | two-weight | slam
 *   captions  subtitle | two-weight | karaoke | none
 *   cards     numbered white chapter cards (scene.kind === 'card')
 */
import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame } from 'remotion';
import { CAPTION_FONT, LOOK_FONTS } from './fonts';
import type { ReelSpec, ReelScene, ReelCaption, ReelLook } from './reelSchema';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outCubic = Easing.out(Easing.cubic);
const outBack = Easing.out(Easing.back(1.6));

export function fontOf(look: ReelLook): { family: string; weight: number; italic: boolean } {
  switch (look.font) {
    case 'condensed-serif': return { family: LOOK_FONTS.condensedSerif, weight: 500, italic: false };
    case 'serif-italic': return { family: LOOK_FONTS.serif, weight: 500, italic: true };
    case 'sans': return { family: LOOK_FONTS.sans, weight: 600, italic: false };
    case 'sans-bold': return { family: CAPTION_FONT, weight: 800, italic: false };
    case 'serif':
    default: return { family: LOOK_FONTS.serif, weight: 500, italic: false };
  }
}

const caseOf = (text: string, look: ReelLook) => (look.textCase === 'upper' ? text.toUpperCase()
  : look.textCase === 'lower' ? text.toLowerCase() : text);

const justifyOf = (pos: ReelLook['position']) => (pos === 'top' ? 'flex-start' : pos === 'lower' ? 'flex-end' : 'center');
const padOf = (pos: ReelLook['position']) => (pos === 'top' ? { paddingTop: '22%' } : pos === 'lower' ? { paddingBottom: '34%' } : {});
const SOFT = '0 4px 22px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.35)';

// ── Overlay text on a shot ───────────────────────────────────────────────────
export const LookOverlay: React.FC<{ text: string; look: ReelLook; durationInFrames: number }> = ({ text, look, durationInFrames }) => {
  const frame = useCurrentFrame();
  const quick = durationInFrames < 24; // fast-cut styles: no time to animate in
  const tIn = quick ? 1 : interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: outCubic });
  const tOut = quick ? 1 : interpolate(frame, [durationInFrames - 5, durationInFrames], [1, 0], clamp);
  const f = fontOf(look);
  const color = look.color || '#FFFFFF';
  const words = look.overlay === 'two-weight' ? caseOf(text, look) : caseOf(text, look).replace(/\s*\|\s*/g, '\n');
  const base: React.CSSProperties = {
    whiteSpace: 'pre-line',
    fontFamily: f.family, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal', color,
    textShadow: SOFT, opacity: tIn * tOut, transform: `translateY(${interpolate(tIn, [0, 1], [18, 0])}px)`,
  };
  let node: React.ReactNode;
  switch (look.overlay) {
    case 'serif-stack': {
      // one word per line, oversized, left-aligned — a chant
      const lines = words.split(/\s+/).filter(Boolean).slice(0, 5);
      const size = lines.length <= 1 ? 170 : lines.length <= 3 ? 132 : 104;
      node = (
        <div style={{ ...base, fontSize: size, lineHeight: 0.98, letterSpacing: -1, textAlign: 'left', alignSelf: 'flex-start', marginLeft: '8%' }}>
          {lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      );
      break;
    }
    case 'serif-accent':
      node = <div style={{ ...base, fontSize: 104, lineHeight: 1.02, textAlign: 'center', width: '84%', fontStyle: 'italic' }}>{words}</div>;
      break;
    case 'two-weight': {
      const parts = words.split(/\s*\|\s*/);
      const [a, b] = parts.length > 1 ? parts : (() => {
        const w = words.split(/\s+/);
        const cut = Math.max(1, Math.floor(w.length / 2));
        return [w.slice(0, cut).join(' '), w.slice(cut).join(' ')];
      })();
      node = (
        <div style={{ ...base, fontFamily: LOOK_FONTS.sans, fontStyle: 'normal', textAlign: 'center', width: '84%' }}>
          <div style={{ fontSize: 46, fontWeight: 400, opacity: 0.92 }}>{a}</div>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.04, letterSpacing: -1 }}>{b}</div>
        </div>
      );
      break;
    }
    case 'bold-sans':
      node = <div style={{ ...base, fontFamily: CAPTION_FONT, fontStyle: 'normal', fontWeight: 800, fontSize: 72, lineHeight: 1.06, textAlign: 'center', width: '84%' }}>{words}</div>;
      break;
    case 'serif-center':
    default:
      node = <div style={{ ...base, fontSize: 60, lineHeight: 1.14, textAlign: 'center', width: '78%' }}>{words}</div>;
  }
  return (
    <AbsoluteFill style={{ justifyContent: justifyOf(look.position), alignItems: 'center', ...padOf(look.position) }}>
      {node}
    </AbsoluteFill>
  );
};

// ── Hook ─────────────────────────────────────────────────────────────────────
export const LookHook: React.FC<{ spec: ReelSpec }> = ({ spec }) => {
  const frame = useCurrentFrame();
  const look = spec.look as ReelLook;
  const hook = spec.hook;
  if (!hook?.text) return null;
  const d = hook.durationInFrames;
  const out = interpolate(frame, [d - 5, d], [1, 0], clamp);
  const f = fontOf(look);
  const color = look.color || '#FFFFFF';
  const text = caseOf(hook.text, look);
  if (look.hook === 'stack-repeat') {
    // words land one after another, each on its own line (HEY / HEY / HEY)
    const lines = text.split(/\s+/).filter(Boolean).slice(0, 7);
    const per = Math.max(3, Math.floor((d * 0.6) / Math.max(1, lines.length)));
    const size = lines.length <= 3 ? 150 : lines.length <= 5 ? 120 : 96;
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'flex-start', paddingLeft: '8%', opacity: out }}>
        <div style={{ fontFamily: f.family, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal', fontSize: size, lineHeight: 0.98, color, textShadow: SOFT }}>
          {lines.map((l, i) => {
            const t = interpolate(frame, [i * per, i * per + 3], [0, 1], clamp);
            return <div key={i} style={{ opacity: t, transform: `scale(${interpolate(t, [0, 1], [1.25, 1])})`, transformOrigin: 'left center' }}>{l}</div>;
          })}
        </div>
      </AbsoluteFill>
    );
  }
  if (look.hook === 'two-weight') {
    return (
      <AbsoluteFill style={{ opacity: out }}>
        <LookOverlay text={hook.text} look={{ ...look, overlay: 'two-weight', position: 'center' }} durationInFrames={d} />
      </AbsoluteFill>
    );
  }
  // serif-center / listicle: the promise set in the style's type, line by line
  const lines = text.split(/\n|(?<=[.:!?])\s+/).filter(Boolean);
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: out }}>
      <div style={{ width: '80%', textAlign: 'center' }}>
        {lines.map((l, i) => {
          const t = interpolate(frame, [i * 6, i * 6 + 10], [0, 1], { ...clamp, easing: outCubic });
          return (
            <div key={i} style={{
              fontFamily: f.family, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal',
              fontSize: look.hook === 'listicle' ? 66 : 88, lineHeight: 1.1, color, textShadow: SOFT,
              opacity: t, transform: `translateY(${interpolate(t, [0, 1], [20, 0])}px)`,
            }}>{l}</div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── Numbered chapter card (white, oversized soft numeral) ────────────────────
export const ChapterCard: React.FC<{ scene: ReelScene; look: ReelLook }> = ({ scene, look }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: outCubic });
  const label = caseOf(scene.cardTitle || '', look);
  return (
    <AbsoluteFill style={{ background: '#F7F6F3', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', width: '78%' }}>
        <div style={{
          fontFamily: LOOK_FONTS.sans, fontWeight: 700, fontSize: 380, lineHeight: 0.9, color: '#C9C7C2',
          textShadow: '0 18px 40px rgba(0,0,0,0.12)', opacity: t, transform: `scale(${interpolate(t, [0, 1], [0.9, 1])})`,
        }}>{scene.cardNumber}</div>
        {label ? (
          <div style={{ marginTop: 28, fontFamily: LOOK_FONTS.sans, fontWeight: 600, fontSize: 54, lineHeight: 1.15, color: '#3A3936', opacity: interpolate(frame, [6, 16], [0, 1], clamp) }}>{label}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// ── Captions in a style ──────────────────────────────────────────────────────
export const LookCaptions: React.FC<{ captions: ReelCaption[]; look: ReelLook; scenes?: ReelScene[] }> = ({ captions, look, scenes = [] }) => {
  const frame = useCurrentFrame();
  const cue = captions.find((c) => frame >= c.fromFrame && frame < c.toFrame);
  if (!cue) return null;
  // over a white chapter card the light caption colour would vanish
  const onCard = scenes.some((s) => s.kind === 'card' && frame >= s.from && frame < s.from + s.durationInFrames);
  if (onCard) look = { ...look, captionColor: '#3A3936' };
  const words = cue.words.map((w) => w.text);
  const say = look.captionCase === 'lower' ? words.join(' ').toLowerCase() : words.join(' ');
  const t = interpolate(frame - cue.fromFrame, [0, 4], [0, 1], clamp);
  const color = look.captionColor || '#FFFFFF';
  const shadow = onCard ? 'none' : SOFT;
  if (look.captions === 'two-weight') {
    const cut = Math.max(1, Math.floor(words.length / 2));
    return (
      <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '30%' }}>
        <div style={{ width: '84%', textAlign: 'center', fontFamily: LOOK_FONTS.sans, color, textShadow: shadow, opacity: t }}>
          <span style={{ fontSize: 44, fontWeight: 400 }}>{words.slice(0, cut).join(' ')} </span>
          <span style={{ fontSize: 52, fontWeight: 700 }}>{words.slice(cut).join(' ')}</span>
        </div>
      </AbsoluteFill>
    );
  }
  // subtitle: small, quiet, low and centred
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: '27%' }}>
      <div style={{ width: '80%', textAlign: 'center', fontFamily: LOOK_FONTS.sans, fontWeight: 500, fontSize: 40, lineHeight: 1.25, color, textShadow: shadow, opacity: t }}>{say}</div>
    </AbsoluteFill>
  );
};

// ── End line over the last shot (no card) ────────────────────────────────────
export const LookEndLine: React.FC<{ spec: ReelSpec; durationInFrames: number }> = ({ spec, durationInFrames }) => {
  const look = spec.look as ReelLook;
  if (!spec.cta?.line) return null;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'rgba(0,0,0,0.28)' }} />
      <LookOverlay
        text={spec.cta.sub ? `${spec.cta.line} | ${spec.cta.sub}` : spec.cta.line}
        look={{ ...look, overlay: look.overlay === 'two-weight' || look.overlay === 'bold-sans' ? look.overlay : 'serif-center', position: 'center' }}
        durationInFrames={durationInFrames}
      />
    </AbsoluteFill>
  );
};

export const GRADE: Record<string, string | undefined> = {
  warm: 'sepia(0.12) saturate(1.08) contrast(1.03)',
  bright: 'brightness(1.06) contrast(1.04) saturate(1.04)',
  cool: 'hue-rotate(-6deg) saturate(0.95) contrast(1.02)',
  neutral: undefined,
};
