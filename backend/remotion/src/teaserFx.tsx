/**
 * Teaser effects for capture reels (the Default director's teaser cut):
 *
 *   cameraAt()         the shot's camera at a frame (Ken Burns move + entry),
 *                      shared by the media and everything anchored to it
 *   projectPoint()     a point on the photo (% of the image) → where it is on
 *                      screen at that frame, through object-fit cover + camera
 *   SceneAnnotations   circle / arrow / label / spotlight drawn ON a subject
 *                      the vision pass found, following the camera
 *   zoomPunchAt()      the crash-zoom onto a subject ('zoom' overlay)
 *
 * Everything is derived from useCurrentFrame(), so renders stay deterministic.
 */
import React from 'react';
import { AbsoluteFill, interpolate, Easing, useCurrentFrame, useVideoConfig } from 'remotion';
import { CAPTION_FONT, LOOK_FONTS } from './fonts';
import type { ReelScene, ReelAnnotation } from './reelSchema';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outCubic = Easing.out(Easing.cubic);
const outBack = Easing.out(Easing.back(1.7));

export type Camera = { scale: number; tx: number; ty: number; ox: number; oy: number; enterX: number; enterScale: number; blur: number; flash: number; enterY: number };

/** The shot's camera at `frame` (translate % of the frame, scale about origin %). */
export function cameraAt(scene: ReelScene, frame: number): Camera {
  const d = Math.max(1, scene.durationInFrames);
  const p = frame / d;
  const fx = scene.focusX ?? 50;
  const fy = scene.focusY ?? 50;
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
  const c = scene.crop;
  const unbox = c ? 1 / Math.max(0.35, Math.min(c.w, c.h)) : 1;
  return {
    // zoom: a fixed punch-in on top of the move (talking-head cuts alternate framing)
    scale: scale * enterScale * unbox * Math.max(1, Math.min(1.6, scene.zoom || 1)), tx: tx + enterX, ty,
    ox: c ? (c.x + c.w / 2) * 100 : fx, oy: c ? (c.y + c.h / 2) * 100 : fy,
    enterX, enterScale, blur, flash, enterY,
  };
}

/** Where a point on the photo (px, py in % of the image) is on screen, in px. */
export function projectPoint(scene: ReelScene, frame: number, W: number, H: number, px: number, py: number) {
  const cam = cameraAt(scene, frame);
  const iw = scene.srcW || W;
  const ih = scene.srcH || H;
  // object-fit: cover + object-position focus
  const s0 = Math.max(W / iw, H / ih);
  const dw = iw * s0;
  const dh = ih * s0;
  const fx = scene.crop ? 50 : (scene.focusX ?? 50);
  const fy = scene.crop ? 50 : (scene.focusY ?? 50);
  const x0 = ((W - dw) * fx) / 100 + (dw * px) / 100;
  const y0 = ((H - dh) * fy) / 100 + (dh * py) / 100;
  // CSS: translate(T) scale(k) about origin O → O + T + k (P − O)
  const Ox = (W * cam.ox) / 100;
  const Oy = (H * cam.oy) / 100;
  return {
    x: Ox + (W * cam.tx) / 100 + cam.scale * (x0 - Ox),
    y: Oy + (H * cam.ty) / 100 + (H * cam.enterY) / 100 + cam.scale * (y0 - Oy),
    scale: cam.scale * s0,
  };
}

/** The 'zoom' overlay: a fast crash-zoom onto its subject from its frame on. */
export function zoomPunchAt(scene: ReelScene, frame: number, W: number, H: number) {
  const z = (scene.annotations || []).find((a) => a.type === 'zoom');
  if (!z || frame < z.atFrame) return null;
  const t = interpolate(frame, [z.atFrame, z.atFrame + 6], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const pt = projectPoint(scene, z.atFrame, W, H, z.point.x, z.point.y);
  return { scale: interpolate(t, [0, 1], [1, 1.5]), originX: pt.x, originY: pt.y, shake: frame - z.atFrame < 4 ? (frame % 2 ? 4 : -4) : 0 };
}

// ── the overlays ────────────────────────────────────────────────────────────
const SHADOW = 'drop-shadow(0 4px 10px rgba(0,0,0,0.45))';

// minimal (narrative look): a small white tag, sentence case — it names the thing, it does not shout
const Pill: React.FC<{ text: string; x: number; y: number; t: number; accent: string; ink: string; minimal?: boolean }> = ({ text, x, y, t, accent, ink, minimal }) => (minimal ? (
  <div style={{
    position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) translateY(${(1 - t) * 10}px)`,
    opacity: t, padding: '10px 20px 12px', borderRadius: 14, background: 'rgba(255,255,255,0.95)', color: '#111',
    fontFamily: LOOK_FONTS.sans, fontWeight: 600, fontSize: 38, letterSpacing: -0.3, whiteSpace: 'nowrap',
    boxShadow: '0 8px 26px rgba(0,0,0,0.28)',
  }}>{text}</div>
) : (
  <div style={{
    position: 'absolute', left: x, top: y, transform: `translate(-50%, -50%) scale(${interpolate(t, [0, 1], [0.4, 1])})`,
    opacity: t, padding: '14px 26px', borderRadius: 999, background: accent, color: ink,
    fontFamily: CAPTION_FONT, fontWeight: 800, fontSize: 44, letterSpacing: 0.5, whiteSpace: 'nowrap',
    textTransform: 'uppercase', boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
  }}>{text}</div>
));

const Annotation: React.FC<{ scene: ReelScene; an: ReelAnnotation; accent: string; ink: string; minimal?: boolean }> = ({ scene, an, accent, ink, minimal }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const local = frame - an.atFrame;
  if (local < 0 || an.type === 'zoom') return null;
  const draw = interpolate(local, [0, 10], [0, 1], { ...clamp, easing: outCubic });
  const pop = interpolate(local, [6, 14], [0, 1], { ...clamp, easing: outBack });
  const pt = projectPoint(scene, frame, W, H, an.point.x, an.point.y);
  const a = projectPoint(scene, frame, W, H, an.box.x, an.box.y);
  const b = projectPoint(scene, frame, W, H, an.box.x + an.box.w, an.box.y + an.box.h);
  // keep labels on screen and clear of the IG UI band at the bottom
  const safeX = (x: number) => Math.min(W - 220, Math.max(220, x));
  const safeY = (y: number) => Math.min(H * 0.74, Math.max(H * 0.14, y));

  if (an.type === 'circle') {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.max(70, Math.abs(b.x - a.x) / 2 + 30);
    const ry = Math.max(60, Math.abs(b.y - a.y) / 2 + 26);
    const len = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) * 1.12;
    // a hand-drawn loop: an ellipse that overshoots its start a little
    const path = `M ${cx - rx} ${cy - 6} A ${rx} ${ry} -6 1 1 ${cx - rx + 4} ${cy + 10} A ${rx} ${ry} -6 0 1 ${cx - rx * 0.86} ${cy - ry * 0.55}`;
    return (
      <AbsoluteFill style={{ filter: SHADOW }}>
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          <path d={path} fill="none" stroke={accent} strokeWidth={10} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
        </svg>
      </AbsoluteFill>
    );
  }
  if (an.type === 'spotlight') {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const r = Math.max(160, Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 0.75 + 60);
    return (
      <AbsoluteFill style={{
        opacity: interpolate(local, [0, 6], [0, 1], clamp),
        background: `radial-gradient(circle ${r}px at ${cx}px ${cy}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.68) 100%)`,
      }} />
    );
  }
  // arrow / label: a tag placed toward the middle of the frame, a line to the subject
  const up = pt.y > H * 0.45;
  const lx = safeX(pt.x + (pt.x > W / 2 ? -180 : 180));
  const ly = safeY(pt.y + (up ? -260 : 260));
  const ex = pt.x + (lx - pt.x) * 0.12;
  const ey = pt.y + (ly - pt.y) * 0.12; // the line stops just short of the subject
  const sx = lx;
  const sy = ly + (up ? 40 : -40);
  if (an.type === 'arrow') {
    const mx = (sx + ex) / 2 + (up ? 60 : -60);
    const my = (sy + ey) / 2;
    const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
    const len = Math.hypot(ex - sx, ey - sy) * 1.3;
    const ang = Math.atan2(ey - my, ex - mx);
    const head = draw >= 0.95 ? (
      <path d={`M ${ex} ${ey} L ${ex - 30 * Math.cos(ang - 0.45)} ${ey - 30 * Math.sin(ang - 0.45)} M ${ex} ${ey} L ${ex - 30 * Math.cos(ang + 0.45)} ${ey - 30 * Math.sin(ang + 0.45)}`}
        fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" />
    ) : null;
    return (
      <AbsoluteFill style={{ filter: SHADOW }}>
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
          <path d={d} fill="none" stroke="#fff" strokeWidth={9} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - draw)} />
          {head}
        </svg>
        {an.text ? <Pill text={an.text} x={lx} y={ly} t={pop} accent={accent} ink={ink} minimal={minimal} /> : null}
      </AbsoluteFill>
    );
  }
  // label: a pulsing dot on the subject, a leader line, a tag
  const ring = 1 + 0.35 * Math.abs(Math.sin(local / 6));
  return (
    <AbsoluteFill style={{ filter: SHADOW }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={pt.x} cy={pt.y} r={16 * ring} fill="none" stroke="#fff" strokeWidth={4} opacity={draw * 0.8} />
        <circle cx={pt.x} cy={pt.y} r={11} fill={accent} stroke="#fff" strokeWidth={4} opacity={draw} />
        <line x1={pt.x} y1={pt.y} x2={pt.x + (sx - pt.x) * draw} y2={pt.y + (sy - pt.y) * draw} stroke="#fff" strokeWidth={5} strokeLinecap="round" />
      </svg>
      {an.text ? <Pill text={an.text} x={lx} y={ly} t={pop} accent={accent} ink={ink} minimal={minimal} /> : null}
    </AbsoluteFill>
  );
};

export const SceneAnnotations: React.FC<{ scene: ReelScene; accent: string; ink: string; minimal?: boolean }> = ({ scene, accent, ink, minimal }) => (
  <>
    {(scene.annotations || []).map((an, i) => <Annotation key={i} scene={scene} an={an} accent={accent} ink={ink} minimal={minimal} />)}
  </>
);
