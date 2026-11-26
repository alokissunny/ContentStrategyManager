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
  AbsoluteFill, Img, Sequence, interpolate, Easing,
  useCurrentFrame, useVideoConfig,
} from 'remotion';
import { Audio, OffthreadVideo } from './media';
import { resolveFont, CAPTION_FONT, LOOK_FONTS, CAPTION_FACES } from './fonts';
import { LookOverlay, LookHook, ChapterCard, LookCaptions, LookEndLine, GRADE } from './reelLook';
import { cameraAt, zoomPunchAt, SceneAnnotations, OVERLAP, type Exit } from './teaserFx';
import type { ReelSpec, ReelScene, ReelCaption } from './reelSchema';
import { MotionReel } from './MotionReel';
import { ExplainerScene } from './explainers';
import { useReelFaces } from './brandFonts';
import { drawPalette } from './brandPalette';
import { SfxTrack, explainerSfx, type SfxEvent } from './sfx';
import { Cutaway, NarrativeCaptions, NarrativeEnd, TitleHook, Vignette, GRADE_INSERT, GRADE_SPEAKER, splitAmount, splitWindows, TwoVoiceCaptions, ChapterTitle, VerdictCard, SpeakerIn, Framed } from './narrative';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outCubic = Easing.out(Easing.cubic);
const outBack = Easing.out(Easing.back(1.8));

// ── One scene: media + its motion + its entry transition ─────────────────────
const SceneMedia: React.FC<{ scene: ReelScene; fps: number; grade?: string; exit?: Exit }> = ({ scene, fps, grade, exit = null }) => {
  const frame = useCurrentFrame();
  const cam = cameraAt(scene, frame, exit);
  // a clip's own sound never clicks in or out: 4 frames up, and down over its overlap (or 6 frames)
  const total = scene.durationInFrames + (exit?.frames || 0);
  const clipVolume = (f: number) => (scene.volume ?? 0) * Math.min(
    interpolate(f, [0, 4], [0, 1], clamp),
    interpolate(f, [total - Math.max(6, exit?.frames || 0), total], [1, 0], clamp),
  );
  const c = scene.crop;
  const fx = c ? 50 : (scene.focusX ?? 50);
  const fy = c ? 50 : (scene.focusY ?? 50);
  const style: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    objectFit: 'cover', objectPosition: `${fx}% ${fy}%`,
    transformOrigin: `${cam.ox}% ${cam.oy}%`,
    transform: `translate(${cam.tx}%, ${cam.ty}%) scale(${cam.scale})`,
    filter: [cam.blur > 0.2 ? `blur(${cam.blur}px)` : '', grade || ''].filter(Boolean).join(' ') || undefined,
  };
  // before → after wipe: the before photo is pulled away left-to-right
  const wipe = scene.beforeSrc ? interpolate(frame, [Math.round(fps * 0.35), Math.round(fps * 0.85)], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) }) : 100;

  return (
    <AbsoluteFill style={{ background: '#000', transform: `translateY(${cam.enterY}%)`, overflow: 'hidden', opacity: cam.opacity }}>
      <Framed scene={scene}>
      {scene.kind === 'video' ? (
        <OffthreadVideo
          src={scene.src}
          trimBefore={Math.max(0, Math.round((scene.sourceStartSec || 0) * fps))}
          volume={clipVolume}
          muted={!(scene.volume && scene.volume > 0)}
          playbackRate={scene.playbackRate || 1}
          style={style}
        />
      ) : (
        <Img src={scene.src} style={style} />
      )}
      </Framed>
      {scene.beforeSrc && wipe < 100 ? (
        <>
          <Img src={scene.beforeSrc} style={{ ...style, clipPath: `inset(0 0 0 ${wipe}%)` }} />
          {wipe > 0 ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: 8, marginLeft: -4, background: '#fff', boxShadow: '0 0 24px rgba(255,255,255,0.9)' }} /> : null}
        </>
      ) : null}
      {cam.flash > 0 ? <AbsoluteFill style={{ background: '#fff', opacity: cam.flash }} /> : null}
    </AbsoluteFill>
  );
};

// A styled shot: its media, the overlays anchored to it, and — for a 'zoom'
// overlay — a crash-zoom that moves both together
const SceneFrame: React.FC<{ scene: ReelScene; fps: number; grade?: string; accent: string; ink: string; minimal?: boolean }> = ({ scene, fps, grade, accent, ink, minimal }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const punch = zoomPunchAt(scene, frame, width, height);
  return (
    <AbsoluteFill style={punch ? {
      transformOrigin: `${punch.originX}px ${punch.originY}px`,
      transform: `translate(${punch.shake}px, 0) scale(${punch.scale})`,
    } : undefined}>
      <SceneMedia scene={scene} fps={fps} grade={grade} />
      {scene.annotations?.length && scene.layout !== 'split' ? <SceneAnnotations scene={scene} accent={accent} ink={ink} minimal={minimal} /> : null}
    </AbsoluteFill>
  );
};

// legibility scrims, always on (top for the hook/kicker, bottom for captions)
// twovoice: the caption's own ink + shadow are measured against the photo, so the bottom gradient
// (which the measurement doesn't see) stays light — just enough to seat the end card and progress bar
const Scrims: React.FC<{ light?: boolean }> = ({ light = false }) => (
  <>
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%)' }} />
    <AbsoluteFill style={{ background: light
      ? 'linear-gradient(0deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0) 22%)'
      : 'linear-gradient(0deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.12) 42%, rgba(0,0,0,0) 60%)' }} />
  </>
);

// the transition the next shot arrives with, if it needs this one to play on underneath
const exitOf = (scenes: ReelScene[], s: ReelScene): Exit => {
  const end = s.from + s.durationInFrames;
  const next = scenes.find((x) => !x.explainer && x !== s && Math.abs(x.from - end) <= 1);
  const frames = next ? OVERLAP[next.transition] || 0 : 0;
  return next && frames ? { type: next.transition, frames } : null;
};

// ── Voice + music for the default look ──────────────────────────────────────
// voiceSegments (on-camera moments): each stretch of the voiceover in its own Sequence, trimmed to its
// slice of the one voice track; else the whole track from startFrame. The music bed dips to a third
// under on-camera speech (audio.duck), easing over 6 frames either side.
const VoiceTrack: React.FC<{ audio: NonNullable<ReelSpec['audio']> }> = ({ audio }) => {
  if (!audio.voiceoverSrc) return null;
  if (audio.voiceSegments?.length) {
    return (
      <>
        {audio.voiceSegments.map((g, i) => (
          <Sequence key={`v${i}`} from={g.fromFrame} durationInFrames={g.durationInFrames} layout="none">
            <Audio
              src={audio.voiceoverSrc as string}
              trimBefore={g.trimBeforeFrames}
              volume={(f) => (audio.voiceVolume ?? 1) * Math.min(interpolate(f, [0, 3], [0, 1], clamp), interpolate(f, [g.durationInFrames - 5, g.durationInFrames], [1, 0], clamp))}
            />
          </Sequence>
        ))}
      </>
    );
  }
  return (
    <Sequence from={audio.startFrame ?? 0} layout="none">
      <Audio src={audio.voiceoverSrc} volume={audio.voiceVolume ?? 1} />
    </Sequence>
  );
};
const musicVolumeAt = (audio: NonNullable<ReelSpec['audio']>) => (f: number) => {
  const base = audio.musicVolume ?? 0.9;
  const dip = (audio.duck || []).reduce((m, d) => Math.max(m, interpolate(f, [d.fromFrame - 6, d.fromFrame, d.toFrame, d.toFrame + 6], [0, 1, 1, 0], clamp)), 0);
  return base * (1 - dip * 0.65);
};

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

// Sound for a reel cut from footage (sfx.tsx): only what is DRAWN or PLACED gets a sound — plain
// cuts between shots stay silent (lemo-opuscar: "don't cut on every beat"); under a voice the
// effects sit at half level.
function reelSfx(reel: ReelSpec, fps: number): SfxEvent[] {
  const ev: SfxEvent[] = [];
  for (const s of reel.scenes) {
    if (s.speaker) continue;
    if (s.explainer) for (const e of explainerSfx(s.explainer, fps)) ev.push({ ...e, at: s.from + e.at });
    else if (s.card) { ev.push({ at: s.from + 3, kind: 'paper' }); ev.push({ at: s.from + 14, kind: 'stamp', gain: 0.45 }); }
    else if (s.kind === 'card') ev.push({ at: s.from + 3, kind: 'paper' }); // a styled reel's chapter card
  }
  for (const c of reel.chapters || []) ev.push({ at: c.fromFrame + 2, kind: 'tick', gain: 0.6 });
  if (reel.cta) ev.push({ at: reel.cta.fromFrame + 2, kind: 'whoosh', gain: 0.8 });
  return ev;
}
const ReelSfx: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const { fps } = useVideoConfig();
  const events = React.useMemo(() => reelSfx(reel, fps), [reel, fps]);
  if (reel.audio?.sfx === false) return null;
  return <SfxTrack events={events} master={reel.audio?.voiceoverSrc ? 0.5 : 0.8} />;
};

// Explainer drawings in a photo reel (backend captureReelAgent commissionDrawings): full-screen paper
// cards — over the footage while their words are said, or cut in between shots of a music-led reel.
// Words on the photos (overlays, kickers) stay off while a drawing is up: one text block at a time.
const drawnOver = (reel: ReelSpec, from: number, to: number) =>
  reel.scenes.some((d) => d.explainer && from < d.from + d.durationInFrames && d.from < to);
const ExplainerLayer: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const body = resolveFont(reel.brand.bodyFont || 'Inter', 'sans');
  const head = resolveFont(reel.brand.headlineFont || 'Montserrat', 'display');
  return (
    <>
      {reel.scenes.map((s, i) => (s.explainer ? (
        <Sequence key={`x${i}`} from={s.from} durationInFrames={s.durationInFrames}>
          <ExplainerScene spec={s.explainer} durationInFrames={s.durationInFrames} font={body} titleFont={head} palette={reel.brand.palette} centered={!reel.captions?.length} />
        </Sequence>
      ) : null))}
    </>
  );
};

// A reel cut in a reference reel's style (reel.look) — see reelLook.tsx
const StyledReel: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const { fps } = useVideoConfig();
  const look = reel.look!;
  if (look.captions === 'narrative' || look.captions === 'twovoice') return <NarrativeReel reel={reel} />;
  const grade = GRADE[look.grade];
  const endFrom = reel.cta ? reel.cta.fromFrame : Infinity;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {reel.scenes.map((s, i) => (s.explainer ? null : (
        <Sequence key={`m${i}`} from={s.from} durationInFrames={s.durationInFrames} layout="none">
          {s.kind === 'card' ? <ChapterCard scene={s} look={look} />
            : <SceneFrame scene={s} fps={fps} grade={s.graded ? undefined : grade} accent={reel.brand.accent} ink={reel.brand.accentInk} />}
        </Sequence>
      )))}
      <ExplainerLayer reel={reel} />
      {reel.scenes.map((s, i) => {
        if (!s.overlayText || s.kind === 'card' || drawnOver(reel, s.from, s.from + s.durationInFrames)) return null;
        const from = Math.max(s.from, reel.hook ? Math.min(reel.hook.durationInFrames, s.from + s.durationInFrames) : 0);
        const len = Math.min(s.from + s.durationInFrames, endFrom) - from;
        return len > 4 ? (
          <Sequence key={`o${i}`} from={from} durationInFrames={len}>
            <LookOverlay text={s.overlayText} look={look} durationInFrames={len} textY={s.textY} />
          </Sequence>
        ) : null;
      })}
      {reel.hook?.text ? (
        <Sequence from={0} durationInFrames={reel.hook.durationInFrames}>
          {look.hook === 'slam' ? <Hook spec={reel} headline={resolveFont(reel.brand.headlineFont || 'Montserrat', 'display')} /> : <LookHook spec={reel} />}
        </Sequence>
      ) : null}
      {look.captions === 'karaoke' ? <Captions captions={reel.captions} spec={reel} />
        : look.captions !== 'none' ? <LookCaptions captions={reel.captions} look={look} scenes={reel.scenes} /> : null}
      {reel.cta && look.endCard !== 'none' ? (
        <Sequence from={reel.cta.fromFrame} durationInFrames={reel.cta.durationInFrames}>
          {look.endCard === 'card'
            ? <EndCard spec={reel} headline={resolveFont(reel.brand.headlineFont || 'Montserrat', 'display')} body={resolveFont(reel.brand.bodyFont || 'Inter', 'sans')} />
            : <LookEndLine spec={reel} durationInFrames={reel.cta.durationInFrames} />}
        </Sequence>
      ) : null}
      <ReelSfx reel={reel} />
      {reel.audio?.musicSrc ? <Audio src={reel.audio.musicSrc} volume={reel.audio.musicVolume ?? 0.9} /> : null}
      {reel.audio?.voiceoverSrc ? (
        <Sequence from={reel.audio.startFrame ?? 0} layout="none">
          <Audio src={reel.audio.voiceoverSrc} volume={reel.audio.voiceVolume ?? 1} />
        </Sequence>
      ) : null}
      {look.progress ? <Progress color={reel.brand.accent} /> : null}
    </AbsoluteFill>
  );
};

// A talking reel in the narrative look (narrative.tsx): the speaker underneath, cutaways on soft
// transitions (or split on the top half while the speaker moves down), minimal voice-led words
const NarrativeReel: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const look = reel.look!;
  const grade = GRADE[look.grade];
  // the Brand Kit's three type roles for every word (heading / body / detail); shipped faces when unset
  const faces = useReelFaces(reel.brand.fonts);
  const font = faces.fromKit ? faces.body : LOOK_FONTS.sans;
  const windows = React.useMemo(() => splitWindows(reel.scenes), [reel.scenes]);
  const split = splitAmount(windows, frame);
  const speakers = reel.scenes.filter((s) => s.speaker);
  const over = reel.scenes.filter((s) => !s.speaker);
  const endFrom = reel.cta ? reel.cta.fromFrame : reel.format.durationInFrames;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* the speaker: slides down into the bottom half while a split cutaway holds the top */}
      <AbsoluteFill style={split > 0 ? { transform: `translateY(${split * 22}%)` } : undefined}>
        {speakers.map((s, i) => (
          <Sequence key={`s${i}`} from={s.from} durationInFrames={s.durationInFrames} layout="none">
            <SpeakerIn scene={s}>
              <Framed scene={s}>
                <SceneFrame scene={s} fps={fps} grade={[grade, GRADE_SPEAKER].filter(Boolean).join(' ')} accent={reel.brand.accent} ink={reel.brand.accentInk} minimal />
              </Framed>
            </SpeakerIn>
          </Sequence>
        ))}
      </AbsoluteFill>
      {over.map((s, i) => (
        <Sequence key={`c${i}`} from={s.from} durationInFrames={s.durationInFrames} layout="none">
          <Cutaway scene={s} split={split}>
            {s.explainer ? (
              <ExplainerScene spec={s.explainer} durationInFrames={s.durationInFrames} font={font} titleFont={faces.heading} palette={reel.brand.palette} />
            ) : s.card ? (
              <VerdictCard card={s.card} font={font} palette={reel.brand.palette}>
                <SceneFrame scene={s} fps={fps} grade={[s.graded ? '' : grade, GRADE_INSERT].filter(Boolean).join(' ')} accent={reel.brand.accent} ink={reel.brand.accentInk} minimal />
              </VerdictCard>
            ) : (
              <Framed scene={s}><SceneFrame scene={s} fps={fps} grade={[s.graded ? '' : grade, GRADE_INSERT].filter(Boolean).join(' ')} accent={reel.brand.accent} ink={reel.brand.accentInk} minimal /></Framed>
            )}
          </Cutaway>
        </Sequence>
      ))}
      {reel.hook?.text ? (
        <Sequence from={0} durationInFrames={reel.hook.durationInFrames}>
          <TitleHook spec={reel} font={font} faces={look.captions === 'twovoice' ? faces : undefined} />
        </Sequence>
      ) : null}
      {/* the edge vignette is for photos: a drawing card stays clean paper */}
      {over.some((s) => s.explainer && frame >= s.from && frame < s.from + s.durationInFrames) ? null : <Vignette />}
      {/* two-voice reels: a chapter is a small label above the caption (one text block at a time) */}
      {look.captions !== 'twovoice' ? (reel.chapters || []).map((c, i) => (
        <Sequence key={`ch${i}`} from={c.fromFrame} durationInFrames={c.durationInFrames}>
          <ChapterTitle text={c.text} durationInFrames={c.durationInFrames} font={faces.heading} ink={c.ink} scrim={c.scrim} />
        </Sequence>
      )) : null}
      {look.captions === 'twovoice'
        ? <TwoVoiceCaptions captions={reel.captions} scenes={reel.scenes} endFrame={endFrom} faces={faces} chapters={reel.chapters || []} startFrame={reel.hook?.text ? reel.hook.durationInFrames : 0} cardInk={drawPalette(reel.brand.palette).ink} />
        : <NarrativeCaptions captions={reel.captions} scenes={reel.scenes} font={font} endFrame={endFrom} accent={reel.brand.accent} />}
      {reel.cta && look.endCard !== 'none' ? (
        <Sequence from={reel.cta.fromFrame} durationInFrames={reel.cta.durationInFrames}>
          <NarrativeEnd spec={reel} font={font} />
        </Sequence>
      ) : null}
      <ReelSfx reel={reel} />
      {reel.audio?.musicSrc ? <Audio src={reel.audio.musicSrc} volume={reel.audio.musicVolume ?? 0.9} /> : null}
      {reel.audio?.voiceoverSrc ? (
        <Sequence from={reel.audio.startFrame ?? 0} layout="none">
          <Audio src={reel.audio.voiceoverSrc} volume={reel.audio.voiceVolume ?? 1} />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export const CaptureReel: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  if (reel.motion) return <MotionReel reel={reel} />;
  if (reel.look) return <StyledReel reel={reel} />;
  return <DefaultReel reel={reel} />;
};

const DefaultReel: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const { fps } = useVideoConfig();
  const headline = resolveFont(reel.brand.headlineFont || 'Montserrat', 'display');
  const body = resolveFont(reel.brand.bodyFont || 'Inter', 'sans');
  const twoVoice = reel.captionStyle === 'twovoice';
  const faces = useReelFaces(reel.brand.fonts);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {reel.scenes.map((s, i) => {
        if (s.explainer) return null;
        const exit = exitOf(reel.scenes, s);
        return (
          <Sequence key={`m${i}`} from={s.from} durationInFrames={s.durationInFrames + (exit?.frames || 0)} layout="none">
            <SceneMedia scene={s} fps={fps} exit={exit} />
          </Sequence>
        );
      })}
      <Scrims light={twoVoice} />
      <ExplainerLayer reel={reel} />
      {reel.scenes.map((s, i) => {
        const end = Math.min(s.from + s.durationInFrames, reel.cta ? reel.cta.fromFrame : Infinity);
        const len = Math.min(end - s.from, Math.round(fps * 2.6));
        return s.kicker && len > 12 && !drawnOver(reel, s.from, s.from + len) ? (
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
      {twoVoice ? (
        <TwoVoiceCaptions
          captions={reel.captions}
          scenes={reel.scenes}
          endFrame={reel.cta ? reel.cta.fromFrame : reel.format.durationInFrames}
          faces={faces}
          startFrame={reel.hook?.text ? reel.hook.durationInFrames : 0}
          cardInk={drawPalette(reel.brand.palette).ink}
          photo
        />
      ) : <Captions captions={reel.captions} spec={reel} />}
      {reel.cta ? (
        <Sequence from={reel.cta.fromFrame} durationInFrames={reel.cta.durationInFrames}>
          <EndCard spec={reel} headline={headline} body={body} />
        </Sequence>
      ) : null}
      {reel.audio?.musicSrc ? <Audio src={reel.audio.musicSrc} volume={musicVolumeAt(reel.audio)} /> : null}
      {reel.audio ? <VoiceTrack audio={reel.audio} /> : null}
      <ReelSfx reel={reel} />
      <Progress color={reel.brand.accent} />
    </AbsoluteFill>
  );
};
