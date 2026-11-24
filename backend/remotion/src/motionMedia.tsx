/**
 * A motion reel's picture: the photo with a slow camera move — or, for a clip
 * still, the clip itself playing (muted, from just before that moment), with the
 * same framing. `still` keeps the photo frozen (wipes, hotspots and swatches
 * need their marks to stay put), so a clip falls back to its still there.
 */
import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { MotionMedia } from './reelSchema';
import { windup } from './motionTiming';

const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const MOVES = [
  { s: [1.04, 1.14], x: [0, 0], y: [0, -1.2] },
  { s: [1.12, 1.03], x: [0, 0], y: [0, 0] },
  { s: [1.1, 1.1], x: [2.2, -2.2], y: [0, 0] },
  { s: [1.1, 1.1], x: [-2.2, 2.2], y: [0, 0] },
];

export const MediaFill: React.FC<{
  m?: MotionMedia; dur: number; variant?: number; dim?: number; blur?: number; still?: boolean; clip?: string;
  zoom?: { at: number; to: number; len: number }; // a punch-in toward the focal point
  radius?: number;
  // depth (motion-graphics repos, 2026-11-24): the lens pulls focus as the shot opens and the picture
  // turns a degree or two in perspective, so a flat photo reads as a space, not a slide
  depth?: boolean;
}> = ({ m, dur, variant = 0, dim = 0, blur = 0, still = false, clip, zoom, radius, depth = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!m) return <AbsoluteFill style={{ background: '#111' }} />;
  const p = interpolate(f, [0, Math.max(1, dur)], [0, 1], cl);
  const mv = MOVES[variant % MOVES.length];
  const playing = Boolean(m.video) && !still;
  // a clip moves on its own: only a gentle push on top of it
  let s = still ? 1.02 : playing ? 1.03 + 0.04 * p : mv.s[0] + (mv.s[1] - mv.s[0]) * p;
  const tx = still || playing ? 0 : mv.x[0] + (mv.x[1] - mv.x[0]) * p;
  const ty = still || playing ? 0 : mv.y[0] + (mv.y[1] - mv.y[0]) * p;
  if (zoom) {
    s *= interpolate(f, [zoom.at, zoom.at + zoom.len], [1, zoom.to], { ...cl, easing: (t) => 1 - Math.pow(1 - t, 4) });
    s *= 1 - 0.045 * windup(f, zoom.at, 8); // anticipation: a small pull back before the punch
  }
  const focus = depth && !still ? interpolate(f, [0, 14], [7, 0], { ...cl, easing: (t) => 1 - Math.pow(1 - t, 3) }) : 0;
  const turn = depth && !still ? (variant % 2 ? -1 : 1) * interpolate(p, [0, 1], [-2.2, 2.2]) : 0;
  const fx = m.focal ? m.focal.x + m.focal.w / 2 : 50;
  const fy = m.focal ? m.focal.y + m.focal.h / 2 : 50;
  const style: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
    objectPosition: `${fx}% ${fy}%`, transformOrigin: `${fx}% ${fy}%`,
    transform: `${turn ? `perspective(1600px) rotateY(${turn}deg) rotateX(${turn * -0.4}deg) ` : ''}translate(${tx}%, ${ty}%) scale(${s * (turn ? 1.04 : 1)})`,
    filter: blur + focus > 0.05 ? `blur(${blur + focus}px)` : undefined,
  };
  return (
    <AbsoluteFill style={{ overflow: 'hidden', clipPath: clip, borderRadius: radius }}>
      {playing
        ? <OffthreadVideo src={m.video as string} muted trimBefore={Math.max(0, Math.round((m.videoStart || 0) * fps))} style={style} />
        : <Img src={m.src} style={style} />}
      {dim ? <AbsoluteFill style={{ background: `rgba(0,0,0,${dim})` }} /> : null}
    </AbsoluteFill>
  );
};
