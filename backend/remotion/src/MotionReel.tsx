/**
 * Motion graphic reel — the renderer for the planner's segments
 * (backend services/motionReelPlanner.js → timeline.motion).
 *
 *   [intro kinetic_hook] → [ONE main format + ≤ 2 accent types] → [cta_end_card]
 *
 * Main formats: before_after_wipe, ken_burns, stat_counter, listicle_tips,
 * hotspot_callouts, palette_extract, grid_build, kinetic_hook, motion_story
 * (graphics told beat by beat, each beat animated to its meaning — motionStory.tsx).
 * Without a picture, the hook and the tips use the same beat scenes (no more
 * generic grid-and-disc backdrop).
 * Accents: fact_captions, stat_badge, hotspot_tags, palette_strip, poll_sticker.
 *
 * Visual rules (studio's guidance): text stays in the safe zone (not the top
 * 220 px, bottom 420 px or right 120 px of 1080×1920), captions avoid the
 * picture's focal point, one text element at a time (except hotspot tags and
 * palette swatches). Every frame comes from useCurrentFrame() — deterministic.
 */
import React from 'react';
import { AbsoluteFill, Audio, Img, Sequence, interpolate, Easing, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolveFont } from './fonts';
import type { ReelSpec, MotionMedia, MotionSegment } from './reelSchema';
import { MotionStory, BeatCaption, type Beat } from './motionStory';
import { MediaFill } from './motionMedia';

const cl = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const outCubic = Easing.out(Easing.cubic);
const outBack = Easing.out(Easing.back(1.6));
const inOut = Easing.inOut(Easing.cubic);

type Ctx = {
  media: Record<string, MotionMedia>;
  products: NonNullable<ReelSpec['motion']>['products'];
  brand: ReelSpec['brand'];
  head: string;
  body: string;
  S: number; // px scale vs 1080 wide
  W: number;
  H: number;
};

// the safe zone, in frame px
const safe = (c: Ctx) => ({ top: 220 * c.S, bottom: c.H - 420 * c.S, left: 72 * c.S, right: c.W - 120 * c.S });

// where an image point (% of the picture) lands on the frame under object-fit: cover
function coverPoint(m: MotionMedia | undefined, pt: { x: number; y: number }, c: Ctx) {
  if (!m || !m.w || !m.h) return { x: (pt.x / 100) * c.W, y: (pt.y / 100) * c.H };
  const k = Math.max(c.W / m.w, c.H / m.h);
  const dw = m.w * k; const dh = m.h * k;
  const fx = (m.focal ? m.focal.x + m.focal.w / 2 : 50) / 100;
  const fy = (m.focal ? m.focal.y + m.focal.h / 2 : 50) / 100;
  const ox = (c.W - dw) * fx; const oy = (c.H - dh) * fy;
  return { x: ox + (pt.x / 100) * dw, y: oy + (pt.y / 100) * dh };
}

// captions sit where the focal point is not
function captionTop(m: MotionMedia | undefined, c: Ctx, boxH: number) {
  const z = safe(c);
  const f = m?.focal ? coverPoint(m, { x: m.focal.x + m.focal.w / 2, y: m.focal.y + m.focal.h / 2 }, c) : { x: 0, y: c.H / 2 };
  return f.y < c.H * 0.5 ? z.bottom - boxH : z.top + 30 * c.S;
}

// ── a picture with a slow camera (or its clip, playing) — motionMedia.tsx ──
const Photo = MediaFill;

// ── text pieces ──────────────────────────────────────────────────────────────
// a caption acts out its words over the picture (motionStory BeatCaption): a
// highlighter, a scribbled ring or a word punch — no more dark box
const CAPTION_SCENES = ['marker', 'circle', 'slam'];
const Caption: React.FC<{ text: string; c: Ctx; top: number; dur: number; i?: number }> = ({ text, c, top, dur, i }) => {
  const z = safe(c);
  const h = 300 * c.S;
  const below = top > c.H / 2;
  const scene = CAPTION_SCENES[(i ?? text.length) % CAPTION_SCENES.length];
  return <BeatCaption text={text} scene={scene} emphasis={keyWord(text)} c={c} top={below ? z.bottom - h : z.top + 10 * c.S} h={h} dur={dur} />;
};

// items shown one at a time across [from, from+len)
const CaptionRun: React.FC<{ items: string[]; c: Ctx; from: number; len: number; m?: MotionMedia }> = ({ items, c, from, len, m }) => {
  if (!items.length || len < 12) return null;
  const per = Math.floor(len / items.length);
  const top = captionTop(m, c, 150 * c.S);
  return (
    <>
      {items.map((t, i) => (
        <Sequence key={i} from={from + i * per} durationInFrames={per} layout="none">
          <Caption text={t} c={c} top={top} dur={per} i={i} />
        </Sequence>
      ))}
    </>
  );
};

const Chip: React.FC<{ text: string; c: Ctx; x: number; y: number; t: number; dark?: boolean; anchorRight?: boolean }> = ({ text, c, x, y, t, dark, anchorRight }) => (
  <div style={{
    position: 'absolute', top: y, ...(anchorRight ? { right: c.W - x } : { left: x }),
    fontFamily: c.body, fontWeight: 800, fontSize: 40 * c.S, letterSpacing: 2 * c.S, textTransform: 'uppercase',
    color: dark ? '#fff' : c.brand.accentInk, background: dark ? 'rgba(10,10,10,0.75)' : c.brand.accent,
    padding: `${12 * c.S}px ${26 * c.S}px`, borderRadius: 999, opacity: t, transform: `scale(${0.7 + 0.3 * t})`,
    transformOrigin: anchorRight ? '100% 50%' : '0% 50%', whiteSpace: 'nowrap',
  }}>{text}</div>
);

// ── formats ──────────────────────────────────────────────────────────────────
// ── no picture: a graphic ground in the brand's colours ──────────────────────
// a drifting accent disc, a hairline grid and a stripe that sweeps across —
// enough motion that a graphics-only reel never feels like a static slide
const GraphicBackdrop: React.FC<{ c: Ctx; dur: number; variant?: number }> = ({ c, dur, variant = 0 }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, Math.max(1, dur)], [0, 1], cl);
  const v = variant % 3;
  const r = (v === 1 ? 760 : 620) * c.S;
  const cx = (v === 2 ? 0.15 : 0.82) * c.W + Math.sin(p * Math.PI) * 60 * c.S;
  const cy = (v === 1 ? 0.18 : 0.74) * c.H - p * 120 * c.S;
  const sweep = interpolate(f, [4, 26], [-30, 0], { ...cl, easing: outCubic });
  const cols = 6;
  return (
    <AbsoluteFill style={{ background: c.brand.ground, overflow: 'hidden' }}>
      {Array.from({ length: cols - 1 }, (_, i) => (
        <div key={`v${i}`} style={{ position: 'absolute', top: 0, bottom: 0, left: ((i + 1) / cols) * c.W, width: 1.5 * c.S, background: c.brand.fg, opacity: 0.06 }} />
      ))}
      {Array.from({ length: 9 }, (_, i) => (
        <div key={`h${i}`} style={{ position: 'absolute', left: 0, right: 0, top: ((i + 1) / 10) * c.H, height: 1.5 * c.S, background: c.brand.fg, opacity: 0.06 }} />
      ))}
      <div style={{ position: 'absolute', left: cx - r / 2, top: cy - r / 2, width: r, height: r, borderRadius: '50%', background: c.brand.accent, opacity: 0.9, transform: `scale(${0.85 + 0.15 * p})` }} />
      <div style={{ position: 'absolute', left: `${sweep}%`, top: (v === 1 ? 0.06 : 0.86) * c.H, width: '130%', height: 26 * c.S, background: c.brand.fg, opacity: 0.85, transform: 'rotate(-8deg)', transformOrigin: '0 50%' }} />
    </AbsoluteFill>
  );
};

// the word a line hangs on, when the planner named none: the longest content word
function keyWord(t: string) {
  const stop = /^(the|and|for|with|your|our|you|we|are|was|that|this|from|into|not|but|its|it's|they|them|their|have|has|will|can|just|more|than|what|when|how|why)$/i;
  const words = t.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, '')).filter((w) => w && !stop.test(w));
  return words.sort((a, b) => b.length - a.length)[0] || '';
}

// one line of type, word by word (the hook, or a line of a graphics-only main)
const KineticLine: React.FC<{ words: string[]; c: Ctx; dur: number; emph: string; ink: string; shadow: boolean }> = ({ words, c, dur, emph, ink, shadow }) => {
  const f = useCurrentFrame();
  const n = Math.max(1, words.length);
  const per = Math.max(2, Math.min(4, Math.floor((dur * 0.3) / n)));
  const out = interpolate(f, [dur - 6, dur], [1, 0], cl);
  const big = (n <= 3 ? 132 : n <= 5 ? 112 : 94) * c.S;
  const z = safe(c);
  return (
    <div style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: z.bottom - z.top, display: 'flex', alignItems: 'center' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', opacity: out }}>
        {words.map((w, i) => {
          const t = interpolate(f, [i * per, i * per + 7], [0, 1], { ...cl, easing: outBack });
          const lit = emph && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === emph.replace(/[^\p{L}\p{N}]/gu, '');
          return (
            <span key={i} style={{
              fontFamily: c.head, fontWeight: 900, fontSize: big, lineHeight: 1.02, letterSpacing: -2 * c.S,
              margin: `${4 * c.S}px ${18 * c.S}px ${4 * c.S}px 0`, display: 'inline-block',
              color: lit ? c.brand.accentInk : ink, background: lit ? c.brand.accent : 'transparent',
              padding: lit ? `0 ${16 * c.S}px ${6 * c.S}px` : 0, borderRadius: 14 * c.S,
              textShadow: lit || !shadow ? 'none' : '0 6px 30px rgba(0,0,0,0.5)',
              opacity: t, transform: `translateY(${(1 - t) * 40 * c.S}px) scale(${1.25 - 0.25 * t})`,
            }}>{w}</span>
          );
        })}
      </div>
    </div>
  );
};

const KineticHook: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const m = c.media[seg.props.backgroundAssetId];
  const emph = String(seg.props.emphasis || '').toLowerCase();
  const ink = m ? '#fff' : (c.brand.fg || '#141414');
  // a graphics-only main: its lines one after another
  const lines: string[] = seg.type === 'main' && Array.isArray(seg.props.lines) && seg.props.lines.length ? seg.props.lines : [];
  const per = lines.length ? Math.floor(seg.durationInFrames / lines.length) : seg.durationInFrames;
  {
    // the words are the show — slam the hook, then a marker / circle per line,
    // over the picture (or its clip, playing) when there is one
    const all = lines.length ? lines : [(seg.props.words || []).join(' ')];
    const beats: Beat[] = all.filter(Boolean).map((t, i) => ({
      scene: i === 0 ? 'slam' : (i % 2 ? 'marker' : 'circle'),
      text: t,
      emphasis: i === 0 ? emph : keyWord(t),
      ...(m ? { assetId: seg.props.backgroundAssetId } : {}),
    }));
    if (beats.length) return <MotionStory beats={beats} c={c} dur={seg.durationInFrames} />;
  }
  return (
    <AbsoluteFill>
      {m ? <Photo m={m} dur={seg.durationInFrames} variant={1} dim={0.42} /> : <GraphicBackdrop c={c} dur={seg.durationInFrames} variant={1} />}
      {lines.length ? lines.map((l, i) => (
        <Sequence key={i} from={i * per} durationInFrames={per} layout="none">
          <KineticLine words={l.split(/\s+/).filter(Boolean)} c={c} dur={per} emph={i === 0 ? emph : ''} ink={ink} shadow={Boolean(m)} />
        </Sequence>
      )) : <KineticLine words={seg.props.words || []} c={c} dur={seg.durationInFrames} emph={emph} ink={ink} shadow={Boolean(m)} />}
    </AbsoluteFill>
  );
};

const BeforeAfter: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const f = useCurrentFrame();
  const q = seg.props;
  const before = c.media[q.beforeAssetId];
  const after = c.media[q.afterAssetId];
  const w0 = q.wipe.startFrame; const w1 = w0 + q.wipe.durationInFrames;
  const p = interpolate(f, [w0, w1], [0, 100], { ...cl, easing: inOut });
  const ltr = q.wipe.direction !== 'rtl';
  const clip = ltr ? `inset(0 ${100 - p}% 0 0)` : `inset(0 0 0 ${100 - p}%)`;
  const lineX = (ltr ? p : 100 - p) / 100 * c.W;
  const z = safe(c);
  const tB = interpolate(f, [4, 12], [0, 1], { ...cl, easing: outBack }) * interpolate(f, [w0 + q.wipe.durationInFrames * 0.4, w0 + q.wipe.durationInFrames * 0.6], [1, 0], cl);
  const tA = interpolate(f, [w1 - 6, w1 + 4], [0, 1], { ...cl, easing: outBack });
  const hold = seg.durationInFrames - w1;
  const caps = (seg.accents.find((a) => a.kind === 'fact_captions')?.items) || [];
  const tags = seg.accents.find((a) => a.kind === 'hotspot_tags');
  const badge = seg.accents.find((a) => a.kind === 'stat_badge');
  return (
    <AbsoluteFill>
      <Photo m={before} dur={seg.durationInFrames} variant={0} still />
      <Photo m={after} dur={seg.durationInFrames} variant={0} still clip={clip} />
      {p > 0 && p < 100 ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: lineX - 4 * c.S, width: 8 * c.S, background: '#fff', boxShadow: '0 0 30px rgba(255,255,255,0.9)' }} /> : null}
      <Chip text={q.labels?.before || 'Before'} c={c} x={z.left} y={z.top + 10 * c.S} t={tB} dark />
      <Chip text={q.labels?.after || 'After'} c={c} x={z.left} y={z.top + 10 * c.S} t={tA} />
      {badge ? <Badge text={badge.text || ''} c={c} from={w1 + 6} /> : null}
      {tags ? <Hotspots ids={tags.productIds || []} c={c} m={after} from={w1 + 8} span={Math.max(20, hold - 16)} /> : null}
      <CaptionRun items={caps} c={c} from={w1 + 10} len={hold - 12} m={after} />
    </AbsoluteFill>
  );
};

const KenBurns: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const f = useCurrentFrame();
  const ids: string[] = seg.props.assetIds || [];
  const n = Math.max(1, ids.length);
  const per = Math.floor(seg.durationInFrames / n);
  const fade = 10;
  const caps = (seg.accents.find((a) => a.kind === 'fact_captions')?.items) || [];
  const strip = seg.accents.some((a) => a.kind === 'palette_strip');
  const badge = seg.accents.find((a) => a.kind === 'stat_badge');
  return (
    <AbsoluteFill>
      {ids.map((id, i) => {
        const from = i * per;
        const len = i === n - 1 ? seg.durationInFrames - from : per + fade;
        const op = i === 0 ? 1 : interpolate(f, [from, from + fade], [0, 1], cl);
        return (
          <Sequence key={id} from={from} durationInFrames={len} layout="none">
            <AbsoluteFill style={{ opacity: op }}>
              <Photo m={c.media[id]} dur={len} variant={i} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
      {ids.map((id, i) => (caps[i] && !(strip && i === n - 1) ? (
        <Sequence key={`c${i}`} from={i * per + 8} durationInFrames={Math.max(14, per - 12)} layout="none">
          <Caption text={caps[i]} c={c} top={captionTop(c.media[id], c, 150 * c.S)} dur={Math.max(14, per - 12)} i={i} />
        </Sequence>
      ) : null))}
      {strip ? (
        <Sequence from={(n - 1) * per + 6} layout="none">
          <Swatches m={c.media[ids[n - 1]]} count={5} c={c} />
        </Sequence>
      ) : null}
      {badge ? <Badge text={badge.text || ''} c={c} from={per} /> : null}
    </AbsoluteFill>
  );
};

function splitNumber(v: string) {
  const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(v);
  if (!m) return null;
  const raw = m[2];
  const n = Number(raw.replace(/,/g, ''));
  const dec = (raw.split('.')[1] || '').length;
  return { pre: m[1], n, dec, commas: raw.includes(','), post: m[3] };
}

const StatCounter: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const f = useCurrentFrame();
  const stats: { value: string; label: string }[] = seg.props.stats || [];
  const caps = (seg.accents.find((a) => a.kind === 'fact_captions')?.items) || [];
  const m = c.media[seg.props.backgroundAssetId];
  const n = Math.max(1, stats.length);
  const per = Math.floor(seg.durationInFrames / n);
  const z = safe(c);
  return (
    <AbsoluteFill style={{ background: c.brand.ground }}>
      {m ? <Photo m={m} dur={seg.durationInFrames} variant={1} dim={0.58} blur={3} /> : <GraphicBackdrop c={c} dur={seg.durationInFrames} variant={0} />}
      {stats.map((s, i) => {
        const from = i * per;
        const local = f - from;
        if (local < 0 || local >= per) return null;
        const sp = splitNumber(s.value);
        const p = interpolate(local, [4, 34], [0, 1], { ...cl, easing: outCubic });
        let shown = s.value;
        if (sp) {
          const v = sp.n * p;
          const fixed = v.toFixed(sp.dec);
          shown = `${sp.pre}${sp.commas ? Number(fixed).toLocaleString('en-IN', { minimumFractionDigits: sp.dec, maximumFractionDigits: sp.dec }) : fixed}${sp.post}`;
        }
        const tIn = interpolate(local, [0, 8], [0, 1], { ...cl, easing: outBack });
        const tOut = interpolate(local, [per - 7, per], [1, 0], cl);
        const tL = interpolate(local, [26, 36], [0, 1], { ...cl, easing: outCubic });
        const tC = interpolate(local, [38, 48], [0, 1], { ...cl, easing: outCubic });
        const ink = m ? '#fff' : c.brand.fg;
        return (
          <div key={i} style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: z.bottom - z.top, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: tOut }}>
            <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: (shown.length > 7 ? 170 : 230) * c.S, lineHeight: 0.95, letterSpacing: -6 * c.S, color: c.brand.accent, transform: `scale(${0.85 + 0.15 * tIn})`, transformOrigin: '0% 50%', opacity: tIn }}>{shown}</div>
            <div style={{ marginTop: 24 * c.S, fontFamily: c.head, fontWeight: 800, fontSize: 66 * c.S, color: ink, opacity: tL, transform: `translateY(${(1 - tL) * 20 * c.S}px)` }}>{s.label}</div>
            {caps[i] ? <div style={{ marginTop: 18 * c.S, fontFamily: c.body, fontWeight: 600, fontSize: 44 * c.S, color: ink, opacity: 0.85 * tC }}>{caps[i]}</div> : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const Listicle: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const f = useCurrentFrame();
  const tips: { title: string }[] = seg.props.tips || [];
  const title: string = seg.props.title || '';
  const m = c.media[seg.props.backgroundAssetId];
  const intro = title ? Math.min(42, Math.floor(seg.durationInFrames * 0.16)) : 0;
  const per = Math.floor((seg.durationInFrames - intro) / Math.max(1, tips.length));
  const ink = m ? '#fff' : c.brand.fg;
  const z = safe(c);
  {
    // each tip is its own beat (alternating colour, entrance and scene) after a
    // slammed title — over the picture when there is one
    const bg = m ? { assetId: seg.props.backgroundAssetId } : {};
    const beats: Beat[] = [
      ...(title ? [{ scene: 'slam', text: title, emphasis: keyWord(title), ...bg }] : []),
      ...tips.map((t, i) => ({ scene: ['marker', 'circle', 'marker', 'stamp', 'circle'][i % 5], text: `${i + 1}. ${t.title}`, emphasis: keyWord(t.title), stampText: `Tip ${i + 1}`, ...bg })),
    ];
    if (beats.length) return <MotionStory beats={beats} c={c} dur={seg.durationInFrames} />;
  }
  return (
    <AbsoluteFill style={{ background: c.brand.ground }}>
      {m ? <Photo m={m} dur={seg.durationInFrames} variant={2} dim={0.6} blur={4} /> : <GraphicBackdrop c={c} dur={seg.durationInFrames} variant={2} />}
      {title && f < intro ? (
        <div style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: z.bottom - z.top, display: 'flex', alignItems: 'center' }}>
          <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: 118 * c.S, lineHeight: 1, letterSpacing: -2 * c.S, color: ink, opacity: interpolate(f, [0, 8, intro - 6, intro], [0, 1, 1, 0], cl), transform: `translateY(${interpolate(f, [0, 10], [30, 0], { ...cl, easing: outCubic }) * c.S}px)` }}>{title}</div>
        </div>
      ) : null}
      {tips.map((t, i) => {
        const from = intro + i * per;
        const local = f - from;
        if (local < 0 || local >= per) return null;
        const tIn = interpolate(local, [0, 10], [0, 1], { ...cl, easing: outCubic });
        const tOut = interpolate(local, [per - 6, per], [1, 0], cl);
        return (
          <div key={i} style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: z.bottom - z.top, display: 'flex', flexDirection: 'column', justifyContent: 'center', opacity: tOut }}>
            <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: 200 * c.S, lineHeight: 0.9, color: c.brand.accent, opacity: tIn, transform: `translateX(${(1 - tIn) * -60 * c.S}px)` }}>{String(i + 1).padStart(2, '0')}</div>
            <div style={{ marginTop: 26 * c.S, height: 8 * c.S, width: `${interpolate(local, [6, 20], [0, 30], { ...cl, easing: outCubic })}%`, background: c.brand.accent, borderRadius: 4 }} />
            <div style={{ marginTop: 30 * c.S, fontFamily: c.head, fontWeight: 800, fontSize: 92 * c.S, lineHeight: 1.04, letterSpacing: -1.5 * c.S, color: ink, opacity: interpolate(local, [6, 16], [0, 1], cl), transform: `translateY(${interpolate(local, [6, 16], [24, 0], { ...cl, easing: outCubic }) * c.S}px)` }}>{t.title}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// pulsing dots + tags, anchored on the picture
const Hotspots: React.FC<{ ids: string[]; c: Ctx; m?: MotionMedia; from: number; span: number }> = ({ ids, c, m, from, span }) => {
  const f = useCurrentFrame();
  const z = safe(c);
  const step = Math.max(8, Math.floor((span * 0.6) / Math.max(1, ids.length)));
  return (
    <>
      {ids.map((id, i) => {
        const pr = c.products?.[id];
        if (!pr) return null;
        const at = coverPoint(m, pr.point, c);
        const x = Math.min(z.right - 20 * c.S, Math.max(z.left + 20 * c.S, at.x));
        const y = Math.min(z.bottom - 60 * c.S, Math.max(z.top + 60 * c.S, at.y));
        const t0 = from + i * step;
        const tD = interpolate(f, [t0, t0 + 8], [0, 1], { ...cl, easing: outBack });
        const tT = interpolate(f, [t0 + 5, t0 + 14], [0, 1], { ...cl, easing: outCubic });
        const pulse = (Math.sin((f - t0) / 5) + 1) / 2;
        const right = x < (z.left + z.right) / 2;
        const label = pr.price ? `${pr.name} · ${pr.price}` : pr.name;
        return (
          <React.Fragment key={id}>
            <div style={{ position: 'absolute', left: x - 34 * c.S, top: y - 34 * c.S, width: 68 * c.S, height: 68 * c.S, borderRadius: '50%', border: `${4 * c.S}px solid ${c.brand.accent}`, opacity: tD * (0.35 + 0.5 * pulse), transform: `scale(${(0.6 + 0.6 * pulse) * tD})` }} />
            <div style={{ position: 'absolute', left: x - 13 * c.S, top: y - 13 * c.S, width: 26 * c.S, height: 26 * c.S, borderRadius: '50%', background: c.brand.accent, border: `${4 * c.S}px solid #fff`, transform: `scale(${tD})` }} />
            <div style={{ position: 'absolute', top: y - 34 * c.S, ...(right ? { left: x + 36 * c.S } : { right: c.W - x + 36 * c.S }), opacity: tT, transform: `translateX(${(1 - tT) * (right ? -20 : 20) * c.S}px)`, background: '#fff', color: '#111', fontFamily: c.body, fontWeight: 800, fontSize: 40 * c.S, padding: `${12 * c.S}px ${22 * c.S}px`, borderRadius: 14 * c.S, whiteSpace: 'nowrap', boxShadow: '0 10px 28px rgba(0,0,0,0.3)' }}>{label}</div>
          </React.Fragment>
        );
      })}
    </>
  );
};

const HotspotCallouts: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const m = c.media[seg.props.assetId];
  const caps = (seg.accents.find((a) => a.kind === 'fact_captions')?.items) || [];
  const badge = seg.accents.find((a) => a.kind === 'stat_badge');
  const ids: string[] = seg.props.productIds || [];
  const tagsEnd = 10 + Math.floor((seg.durationInFrames - 30) * 0.6);
  return (
    <AbsoluteFill>
      <Photo m={m} dur={seg.durationInFrames} still />
      <AbsoluteFill style={{ background: 'rgba(0,0,0,0.12)' }} />
      <Hotspots ids={ids} c={c} m={m} from={10} span={seg.durationInFrames - 30} />
      {badge ? <Badge text={badge.text || ''} c={c} from={tagsEnd} /> : null}
      <CaptionRun items={caps} c={c} from={tagsEnd + 6} len={seg.durationInFrames - tagsEnd - 8} m={m} />
    </AbsoluteFill>
  );
};

const Swatches: React.FC<{ m?: MotionMedia; count: number; c: Ctx }> = ({ m, count, c }) => {
  const f = useCurrentFrame();
  const sw = (m?.swatches || []).slice(0, count);
  const z = safe(c);
  const gap = 18 * c.S;
  const size = Math.min(170 * c.S, ((z.right - z.left) - gap * (sw.length - 1)) / Math.max(1, sw.length));
  return (
    <div style={{ position: 'absolute', left: z.left, top: z.bottom - size - 70 * c.S, display: 'flex', gap }}>
      {sw.map((s, i) => {
        const t = interpolate(f, [i * 7, i * 7 + 10], [0, 1], { ...cl, easing: outBack });
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 * c.S, opacity: t, transform: `translateY(${(1 - t) * 60 * c.S}px)` }}>
            <div style={{ width: size, height: size, borderRadius: 22 * c.S, background: s.hex, border: `${5 * c.S}px solid #fff`, boxShadow: '0 12px 30px rgba(0,0,0,0.3)' }} />
            <div style={{ fontFamily: c.body, fontWeight: 700, fontSize: 30 * c.S, color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.6)' }}>{s.hex}</div>
          </div>
        );
      })}
    </div>
  );
};

const PaletteExtract: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const m = c.media[seg.props.assetId];
  const caps = (seg.accents.find((a) => a.kind === 'fact_captions')?.items) || [];
  const z = safe(c);
  const swFrom = 24;
  const capFrom = swFrom + (seg.props.swatchCount || 4) * 7 + 18;
  return (
    <AbsoluteFill>
      <Photo m={m} dur={seg.durationInFrames} variant={0} />
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 45%)' }} />
      <Sequence from={swFrom} layout="none"><Swatches m={m} count={seg.props.swatchCount || 4} c={c} /></Sequence>
      {caps.length ? (
        // the swatches own the bottom: the material line goes up top
        caps.map((t, i) => {
          const per = Math.floor((seg.durationInFrames - capFrom) / caps.length);
          return per > 12 ? (
            <Sequence key={i} from={capFrom + i * per} durationInFrames={per} layout="none">
              <Caption text={t} c={c} top={z.top + 30 * c.S} dur={per} i={i} />
            </Sequence>
          ) : null;
        })
      ) : null}
    </AbsoluteFill>
  );
};

const GridBuild: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const f = useCurrentFrame();
  const tiles: { assetId: string; label?: string }[] = seg.props.tiles || [];
  const labels = (seg.accents.find((a) => a.kind === 'fact_captions')?.items) || [];
  const poll = seg.accents.find((a) => a.kind === 'poll_sticker');
  const z = safe(c);
  const gap = 16 * c.S;
  const gw = z.right - z.left;
  const tw = (gw - gap) / 2;
  const th = Math.min(tw * 1.3, ((z.bottom - z.top) - gap) / 2);
  const gy = z.top + ((z.bottom - z.top) - (th * 2 + gap)) / 2;
  const land = Math.floor(seg.durationInFrames * 0.42 / 4);
  const allIn = land * 4 + 8;
  return (
    <AbsoluteFill style={{ background: c.brand.ground }}>
      {tiles.map((tile, i) => {
        const t = interpolate(f, [i * land, i * land + 10], [0, 1], { ...cl, easing: outBack });
        const x = z.left + (i % 2) * (tw + gap);
        const y = gy + Math.floor(i / 2) * (th + gap);
        const m = c.media[tile.assetId];
        const label = tile.label || labels[i] || (seg.props.variant === 'options' ? `Option ${i + 1}` : '');
        return (
          <div key={i} style={{ position: 'absolute', left: x, top: y, width: tw, height: th, borderRadius: 26 * c.S, overflow: 'hidden', opacity: t, transform: `scale(${1.18 - 0.18 * t})`, boxShadow: '0 16px 40px rgba(0,0,0,0.22)' }}>
            {m ? <Img src={m.src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: m.focal ? `${m.focal.x + m.focal.w / 2}% ${m.focal.y + m.focal.h / 2}%` : '50% 50%' }} /> : null}
            {label ? <div style={{ position: 'absolute', left: 16 * c.S, bottom: 16 * c.S, background: 'rgba(12,12,12,0.72)', color: '#fff', fontFamily: c.body, fontWeight: 800, fontSize: 36 * c.S, padding: `${8 * c.S}px ${18 * c.S}px`, borderRadius: 999, opacity: interpolate(f, [i * land + 8, i * land + 16], [0, 1], cl) }}>{label}</div> : null}
          </div>
        );
      })}
      {poll ? (() => {
        const t = interpolate(f, [allIn, allIn + 10], [0, 1], { ...cl, easing: outBack });
        return (
          <div style={{ position: 'absolute', left: c.W * 0.5 - 300 * c.S, top: gy + th - 70 * c.S, width: 600 * c.S, background: '#fff', borderRadius: 34 * c.S, padding: `${26 * c.S}px ${30 * c.S}px`, boxShadow: '0 20px 50px rgba(0,0,0,0.35)', opacity: t, transform: `scale(${0.7 + 0.3 * t}) rotate(-2deg)`, textAlign: 'center' }}>
            <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: 56 * c.S, color: '#111' }}>{poll.question || 'Which one?'}</div>
            <div style={{ display: 'flex', gap: 14 * c.S, marginTop: 18 * c.S, justifyContent: 'center' }}>
              {[1, 2, 3, 4].map((k) => <div key={k} style={{ flex: 1, fontFamily: c.body, fontWeight: 800, fontSize: 40 * c.S, padding: `${12 * c.S}px 0`, borderRadius: 16 * c.S, background: c.brand.accent, color: c.brand.accentInk }}>{k}</div>)}
            </div>
          </div>
        );
      })() : null}
    </AbsoluteFill>
  );
};

const Badge: React.FC<{ text: string; c: Ctx; from: number }> = ({ text, c, from }) => {
  const f = useCurrentFrame();
  const t = interpolate(f, [from, from + 10], [0, 1], { ...cl, easing: outBack });
  const z = safe(c);
  return (
    <div style={{ position: 'absolute', right: c.W - z.right, top: z.top + 10 * c.S, opacity: t, transform: `scale(${0.6 + 0.4 * t}) rotate(${(1 - t) * 8}deg)`, transformOrigin: '100% 0%', background: c.brand.accent, color: c.brand.accentInk, fontFamily: c.head, fontWeight: 900, fontSize: 50 * c.S, padding: `${16 * c.S}px ${28 * c.S}px`, borderRadius: 20 * c.S, boxShadow: '0 14px 34px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>{text}</div>
  );
};

const EndCard: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const f = useCurrentFrame();
  const m = c.media[seg.props.backgroundAssetId];
  const tBg = interpolate(f, [0, 10], [0, 1], { ...cl, easing: outCubic });
  const tL = interpolate(f, [6, 18], [0, 1], { ...cl, easing: outBack });
  const tH = interpolate(f, [14, 24], [0, 1], { ...cl, easing: outCubic });
  const z = safe(c);
  return (
    <AbsoluteFill>
      {m ? <Photo m={m} dur={seg.durationInFrames} variant={1} blur={6} /> : null}
      {/* without a picture the ground is there from the first frame (never a black flash) */}
      <AbsoluteFill style={{ background: c.brand.ground, opacity: m ? 0.86 * tBg : 1 }} />
      <div style={{ position: 'absolute', left: z.left, width: z.right - z.left, top: z.top, height: z.bottom - z.top, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40 * c.S }}>
        <div style={{ width: `${interpolate(f, [10, 24], [0, 22], { ...cl, easing: outCubic })}%`, height: 10 * c.S, background: c.brand.accent, borderRadius: 5 }} />
        <div style={{ fontFamily: c.head, fontWeight: 900, fontSize: 104 * c.S, lineHeight: 1.02, letterSpacing: -2 * c.S, color: c.brand.fg, opacity: tL, transform: `translateY(${(1 - tL) * 40 * c.S}px)` }}>{seg.props.cta}</div>
        {seg.props.handle ? <div style={{ alignSelf: 'flex-start', fontFamily: c.body, fontWeight: 800, fontSize: 48 * c.S, color: c.brand.accentInk, background: c.brand.accent, padding: `${16 * c.S}px ${34 * c.S}px`, borderRadius: 999, opacity: tH, transform: `scale(${0.85 + 0.15 * tH})`, transformOrigin: '0% 50%' }}>{seg.props.handle}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const Story: React.FC<{ seg: MotionSegment; c: Ctx }> = ({ seg, c }) => {
  const beats: Beat[] = Array.isArray(seg.props.beats) ? seg.props.beats : [];
  if (!beats.length) return <KineticHook seg={seg} c={c} />;
  return <MotionStory beats={beats} c={c} dur={seg.durationInFrames} />;
};

const MAIN: Record<string, React.FC<{ seg: MotionSegment; c: Ctx }>> = {
  motion_story: Story,
  before_after_wipe: BeforeAfter,
  ken_burns: KenBurns,
  stat_counter: StatCounter,
  listicle_tips: Listicle,
  hotspot_callouts: HotspotCallouts,
  palette_extract: PaletteExtract,
  grid_build: GridBuild,
  kinetic_hook: KineticHook,
};

export const MotionReel: React.FC<{ reel: ReelSpec }> = ({ reel }) => {
  const { width, height } = useVideoConfig();
  const mo = reel.motion!;
  const c: Ctx = {
    media: mo.media, products: mo.products, brand: { ...reel.brand, ground: reel.brand.ground || '#F4F1EA', fg: reel.brand.fg || '#141414' },
    head: resolveFont(reel.brand.headlineFont || 'Montserrat', 'display'),
    body: resolveFont(reel.brand.bodyFont || 'Inter', 'sans'),
    S: width / 1080, W: width, H: height,
  };
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {mo.segments.map((s, i) => {
        if (s.type === 'intro') {
          return (
            <Sequence key={i} from={s.from} durationInFrames={s.durationInFrames}>
              <KineticHook seg={s} c={c} />
            </Sequence>
          );
        }
        if (s.type === 'outro') {
          return (
            <Sequence key={i} from={s.from} durationInFrames={s.durationInFrames}>
              <EndCard seg={s} c={c} />
            </Sequence>
          );
        }
        const Comp = MAIN[s.formatId] || KenBurns;
        return (
          <Sequence key={i} from={s.from} durationInFrames={s.durationInFrames}>
            <Comp seg={s} c={c} />
          </Sequence>
        );
      })}
      {reel.audio?.musicSrc ? <Audio src={reel.audio.musicSrc} volume={reel.audio.musicVolume ?? 0.9} /> : null}
    </AbsoluteFill>
  );
};

