/**
 * Capture Reel — a 9:16 Instagram reel cut from a studio's capture.
 *
 * Fixed, hand-written composition: the Reel agent (backend
 * services/captureReelAgent.js) only emits a bounded, validated timeline
 * (scenes → media + trims + motion, hook, word-timed captions, CTA). Every
 * frame is derived from useCurrentFrame(), so renders are deterministic.
 *
 * Look: full-bleed footage, a word-by-word hook slam in the first second,
 * karaoke captions (2–3 words, the spoken word lit in the brand accent),
 * quick punch-in transitions, a thin progress bar, and an end card.
 */
import React from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, Easing,
  useCurrentFrame, useVideoConfig,
} from 'remotion';
import { resolveFont, CAPTION_FONT } from './fonts';
import type { ReelSpec, ReelScene, ReelCaption } from './reelSchema';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outCubic = Easing.out(Easing.cubic);
const outBack = Easing.out(Easing.back(1.8));

// ── One scene: media + its motion + its entry transition ─────────────────────
const SceneMedia: React.FC<{ scene: ReelScene; fps: number }> = ({ scene, fps }) => {
  const frame = useCurrentFrame();
  const d = Math.max(1, scene.durationInFrames);
  const p = frame / d;
  const fx = scene.focusX ?? 50;
  const fy = scene.focusY ?? 50;

  // continuous camera move across the whole scene
  let scale = 1.06;
  let tx = 0;
  let ty = 0;
  switch (scene.motion) {
    case 'push-in': scale = interpolate(p, [0, 1], [1.04, 1.16]); break;
    case 'pull-out': scale = interpolate(p, [0, 1], [1.18, 1.04]); break;
    case 'pan-left': scale = 1.14; tx = interpolate(p, [0, 1], [3.5, -3.5]); break;
    case 'pan-right': scale = 1.14; tx = interpolate(p, [0, 1], [-3.5, 3.5]); break;
    case 'pan-up': scale = 1.14; ty = interpolate(p, [0, 1], [3, -3]); break;
    case 'none': scale = scene.kind === 'video' ? 1 : 1.04; break;
    default: break;
  }

  // entry transition (first ~8 frames)
  const tIn = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: outCubic });
  let enterScale = 1;
  let enterX = 0;
  let enterY = 0;
  let blur = 0;
  let flash = 0;
  switch (scene.transition) {
    case 'zoom': enterScale = interpolate(tIn, [0, 1], [1.28, 1]); blur = interpolate(tIn, [0, 1], [10, 0]); break;
    case 'whip': enterX = interpolate(tIn, [0, 1], [38, 0]); blur = interpolate(tIn, [0, 1], [18, 0]); break;
    case 'slide': enterY = interpolate(tIn, [0, 1], [100, 0]); break;
    case 'flash': flash = interpolate(frame, [0, 6], [0.85, 0], clamp); break;
    default: break;
  }

  // zoom past letterbox bands baked into the clip, centred on the picture
  const c = scene.crop;
  const unbox = c ? 1 / Math.max(0.35, Math.min(c.w, c.h)) : 1;
  const ox = c ? (c.x + c.w / 2) * 100 : fx;
  const oy = c ? (c.y + c.h / 2) * 100 : fy;
  const style: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    objectFit: 'cover', objectPosition: `${c ? 50 : fx}% ${c ? 50 : fy}%`,
    transformOrigin: `${ox}% ${oy}%`,
    transform: `translate(${tx + enterX}%, ${ty}%) scale(${scale * enterScale * unbox})`,
    filter: blur > 0.2 ? `blur(${blur}px)` : undefined,
  };

  return (
    <AbsoluteFill style={{ background: '#000', transform: `translateY(${enterY}%)`, overflow: 'hidden' }}>
      {scene.kind === 'video' ? (
        <OffthreadVideo
          src={scene.src}
          trimBefore={Math.max(0, Math.round((scene.sourceStartSec || 0) * fps))}
          volume={scene.volume ?? 0}
          muted={!(scene.volume && scene.volume > 0)}
          style={style}
        />
      ) : (
        <Img src={scene.src} style={style} />
      )}
      {flash > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};

// legibility scrims, always on (top for the hook/kicker, bottom for captions)
const Scrims: React.FC = () => (
  <>
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%)' }} />
    <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.12) 42%, rgba(0,0,0,0) 60%)' }} />
  </>
);

// ── Hook: the first ~1.5 s — words slam in one after another ────────────────
const Hook: React.FC<{ spec: ReelSpec; headline: string }> = ({ spec, headline }) => {
  const frame = useCurrentFrame();
  const { hook, brand } = spec;
  if (!hook?.text) return null;
  const words = hook.text.split(/\s+/).filter(Boolean);
  const emph = new Set((hook.emphasis || '').toLowerCase().split(/\s+/).filter(Boolean));
  const out = interpolate(frame, [hook.durationInFrames - 6, hook.durationInFrames], [1, 0], clamp);
  const per = Math.max(2, Math.min(5, Math.floor((hook.durationInFrames * 0.45) / Math.max(1, words.length))));
  const big = words.length <= 4 ? 128 : words.length <= 7 ? 104 : 86;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: '26%', opacity: out }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        width: '86%', textAlign: 'center',
      }}>
        {words.map((w, i) => {
          const s = i * per;
          const t = interpolate(frame, [s, s + 7], [0, 1], { ...clamp, easing: outBack });
          const lit = emph.has(w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''));
          return (
            <span key={i} style={{
              display: 'inline-block', margin: '4px 11px',
              fontFamily: headline,
              fontWeight: 900,
              fontSize: big,
              lineHeight: 1.02,
              letterSpacing: -1.5,
              color: lit ? brand.accentInk : '#fff',
              background: lit ? brand.accent : 'transparent',
              padding: lit ? '0 18px 6px' : 0,
              borderRadius: lit ? 14 : 0,
              textShadow: lit ? 'none' : '0 6px 28px rgba(0,0,0,0.55)',
              opacity: t,
              transform: `scale(${interpolate(t, [0, 1], [1.6, 1])}) translateY(${interpolate(t, [0, 1], [24, 0])}px)`,
            }}>{w}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── Kicker: a small label on a scene ("BEFORE", "WEEK 3") ────────────────────
const Kicker: React.FC<{ text: string; spec: ReelSpec; durationInFrames: number }> = ({ text, spec, durationInFrames }) => {
  const frame = useCurrentFrame();
  const tIn = interpolate(frame, [2, 10], [0, 1], { ...clamp, easing: outBack });
  const tOut = interpolate(frame, [durationInFrames - 5, durationInFrames], [1, 0], clamp);
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: '17%' }}>
      <span style={{
        fontFamily: CAPTION_FONT, fontWeight: 800, fontSize: 46, letterSpacing: 1,
        textTransform: 'uppercase', color: spec.brand.accentInk, background: spec.brand.accent,
        padding: '12px 28px', borderRadius: 999, maxWidth: '84%', textAlign: 'center',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        opacity: tIn * tOut, transform: `scale(${interpolate(tIn, [0, 1], [0.6, 1])})`,
      }}>{text}</span>
    </AbsoluteFill>
  );
};

// ── Karaoke captions ────────────────────────────────────────────────────────
const Captions: React.FC<{ captions: ReelCaption[]; spec: ReelSpec }> = ({ captions, spec }) => {
  const frame = useCurrentFrame();
  const cue = captions.find((c) => frame >= c.fromFrame && frame < c.toFrame);
  if (!cue) return null;
  const local = frame - cue.fromFrame;
  const pop = interpolate(local, [0, 5], [0.82, 1], { ...clamp, easing: outBack });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: '118%' }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        width: '84%', transform: `scale(${pop})`,
      }}>
        {cue.words.map((w, i) => {
          const on = frame >= w.fromFrame && frame < w.toFrame;
          const said = frame >= w.fromFrame;
          return (
            <span key={i} style={{
              fontFamily: CAPTION_FONT, fontWeight: 900, fontSize: 78, lineHeight: 1.12,
              textTransform: 'uppercase', letterSpacing: -0.5,
              color: on ? spec.brand.accent : said ? '#fff' : 'rgba(255,255,255,0.92)',
              WebkitTextStroke: '3px rgba(0,0,0,0.85)',
              paintOrder: 'stroke fill',
              textShadow: '0 8px 24px rgba(0,0,0,0.55)',
              transform: on ? 'scale(1.1)' : 'scale(1)',
              display: 'inline-block', margin: '0 18px', transformOrigin: '50% 60%',
            }}>{w.text}</span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ── End card ────────────────────────────────────────────────────────────────
const EndCard: React.FC<{ spec: ReelSpec; headline: string; body: string }> = ({ spec, headline, body }) => {
  const frame = useCurrentFrame();
  const { cta, brand } = spec;
  if (!cta) return null;
  const tBg = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: outCubic });
  const tLine = interpolate(frame, [4, 14], [0, 1], { ...clamp, easing: outBack });
  const tSub = interpolate(frame, [10, 20], [0, 1], { ...clamp, easing: outCubic });
  return (
    <AbsoluteFill style={{ background: `rgba(0,0,0,${0.62 * tBg})`, justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ width: '82%', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34 }}>
        <div style={{
          fontFamily: headline, fontWeight: 800, fontSize: 92, lineHeight: 1.05, color: '#fff', letterSpacing: -1,
          opacity: tLine, transform: `translateY(${interpolate(tLine, [0, 1], [40, 0])}px)`,
        }}>{cta.line}</div>
        {cta.sub ? (
          <div style={{
            fontFamily: body, fontWeight: 600, fontSize: 44, color: brand.accentInk, background: brand.accent,
            padding: '16px 34px', borderRadius: 999, opacity: tSub,
            transform: `scale(${interpolate(tSub, [0, 1], [0.8, 1])})`,
          }}>{cta.sub}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const Progress: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, height: 8, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`, background: color }} />
  );
};

export const CaptureReel: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const { fps } = useVideoConfig();
  const headline = resolveFont(reel.brand.headlineFont || 'Montserrat', 'display');
  const body = resolveFont(reel.brand.bodyFont || 'Inter', 'sans');
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {reel.scenes.map((s, i) => (
        <Sequence key={`m${i}`} from={s.from} durationInFrames={s.durationInFrames} layout="none">
          <SceneMedia scene={s} fps={fps} />
        </Sequence>
      ))}
      <Scrims />
      {reel.scenes.map((s, i) => {
        const end = Math.min(s.from + s.durationInFrames, reel.cta ? reel.cta.fromFrame : Infinity);
        const len = Math.min(end - s.from, Math.round(fps * 2.6));
        return s.kicker && len > 12 ? (
          <Sequence key={`k${i}`} from={s.from} durationInFrames={len}>
            <Kicker text={s.kicker} spec={reel} durationInFrames={len} />
          </Sequence>
        ) : null;
      })}
      {reel.hook?.text ? (
        <Sequence from={0} durationInFrames={reel.hook.durationInFrames}>
          <Hook spec={reel} headline={headline} />
        </Sequence>
      ) : null}
      <Captions captions={reel.captions} spec={reel} />
      {reel.cta ? (
        <Sequence from={reel.cta.fromFrame} durationInFrames={reel.cta.durationInFrames}>
          <EndCard spec={reel} headline={headline} body={body} />
        </Sequence>
      ) : null}
      {reel.audio?.voiceoverSrc ? (
        <Sequence from={reel.audio.startFrame ?? 0} layout="none">
          <Audio src={reel.audio.voiceoverSrc} volume={reel.audio.voiceVolume ?? 1} />
        </Sequence>
      ) : null}
      <Progress color={reel.brand.accent} />
    </AbsoluteFill>
  );
};
