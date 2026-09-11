import React from 'react';
import {
  AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, Easing,
} from 'remotion';
import { resolveFont } from './fonts';
import { Primitive, VB } from './primitives';
import type { CoverSpec, Brand } from './schema';

function easeFn(name: string) {
  switch (name) {
    case 'inOutCubic': return Easing.inOut(Easing.cubic);
    case 'outExpo': return Easing.out(Easing.exp);
    case 'outCubic':
    default: return Easing.out(Easing.cubic);
  }
}

function fontsOf(brand: Brand) {
  const headline = resolveFont(brand.headlineFont || brand.serif || 'Playfair Display', 'serif');
  const body = resolveFont(brand.bodyFont || brand.sans || 'Inter', 'sans');
  return { headline, body };
}

// ── Background motion ────────────────────────────────────────────────────────
const Background: React.FC<{ brand: Brand; kind: string }> = ({ brand, kind }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (kind === 'none') return <AbsoluteFill style={{ background: brand.bg }} />;
  if (kind === 'grain') {
    return (
      <AbsoluteFill style={{ background: brand.bg }}>
        <svg style={{ width: '100%', height: '100%', opacity: 0.05 }}>
          <filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" /></filter>
          <rect width="100%" height="100%" filter="url(#n)" />
        </svg>
      </AbsoluteFill>
    );
  }
  const t = frame / Math.max(1, durationInFrames);
  if (kind === 'breathe') {
    const scale = 1 + 0.06 * Math.sin(t * Math.PI * 2);
    return (
      <AbsoluteFill style={{ background: brand.bg }}>
        <div style={{
          position: 'absolute', inset: '-20%',
          background: `radial-gradient(circle at 50% 40%, ${brand.accent}14, transparent 60%)`,
          transform: `scale(${scale})`,
        }} />
      </AbsoluteFill>
    );
  }
  // drift
  const x = interpolate(t, [0, 1], [-8, 8]);
  const y = interpolate(t, [0, 1], [6, -6]);
  return (
    <AbsoluteFill style={{ background: brand.bg }}>
      <div style={{
        position: 'absolute', inset: '-25%',
        background: `radial-gradient(60% 50% at 30% 30%, ${brand.accent}12, transparent 60%)`,
        transform: `translate(${x}%, ${y}%)`,
      }} />
    </AbsoluteFill>
  );
};

// ── Header ───────────────────────────────────────────────────────────────────
const Header: React.FC<{ brand: Brand; body: string; header: CoverSpec['header']; start: number; align?: 'row' | 'center' }> = ({ brand, body, header, start, align = 'row' }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  if (!header.eyebrow && !header.counter) return null;
  if (align === 'center') {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, opacity: t, transform: `translateY(${(1 - t) * -10}px)`, fontFamily: body }}>
        {header.eyebrow ? <span style={{ fontSize: 15, letterSpacing: 2.5, color: brand.muted, textTransform: 'uppercase' }}>{header.eyebrow}</span> : null}
        {header.counter ? <span style={{ fontSize: 14, letterSpacing: 2, color: brand.muted }}>{header.counter}</span> : null}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '3%', opacity: t, transform: `translateY(${(1 - t) * -10}px)`, fontFamily: body }}>
      <span style={{ fontSize: 15, letterSpacing: 2, color: brand.ink, fontWeight: 600, textTransform: 'uppercase' }}>{header.eyebrow}</span>
      <span style={{ flex: 1, height: 1, background: brand.hairline }} />
      {header.counter ? <span style={{ fontSize: 14, letterSpacing: 2, color: brand.muted }}>{header.counter}</span> : null}
    </div>
  );
};

// ── Headline (motion-aware) ──────────────────────────────────────────────────
const Headline: React.FC<{
  brand: Brand; family: string; headline: CoverSpec['headline'];
  start: number; stagger: number; motion: string; ease: (n: number) => number;
  size: number; align?: 'left' | 'center'; lineHeight?: number; ink?: string;
}> = ({ brand, family, headline, start, stagger, motion, ease, size, align = 'left', lineHeight = 1.02, ink }) => {
  return (
    <div style={{ textAlign: align }}>
      {headline.lines.map((line, i) => (
        <Line
          key={i}
          text={line.text}
          italic={line.italic}
          color={line.accent ? brand.accent : (ink || brand.ink)}
          family={family}
          start={start + i * stagger}
          motion={motion}
          ease={ease}
          size={size}
          align={align}
          lineHeight={lineHeight}
        />
      ))}
    </div>
  );
};

const Line: React.FC<{
  text: string; italic: boolean; color: string; family: string; start: number;
  motion: string; ease: (n: number) => number; size: number; align: string; lineHeight: number;
}> = ({ text, italic, color, family, start, motion, ease, size, align, lineHeight }) => {
  const frame = useCurrentFrame();
  const base: React.CSSProperties = {
    fontFamily: family, fontSize: size, lineHeight, fontStyle: italic ? 'italic' : 'normal',
    color, fontWeight: 600, letterSpacing: '-0.01em',
  };
  const t = interpolate(frame, [start, start + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

  if (motion === 'stagger-words' || motion === 'typewriter') {
    const words = text.split(' ');
    const per = motion === 'typewriter' ? 3 : 4;
    return (
      <div style={{ ...base, display: 'flex', flexWrap: 'wrap', gap: '0 0.28em', justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
        {words.map((w, i) => {
          const wt = interpolate(frame, [start + i * per, start + i * per + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
          return (
            <span key={i} style={{ display: 'inline-block', opacity: wt, transform: `translateY(${(1 - wt) * 0.4}em)` }}>{w}</span>
          );
        })}
      </div>
    );
  }
  if (motion === 'wipe') {
    const pct = Math.round(t * 100);
    return <div style={{ ...base, clipPath: `inset(0 ${100 - pct}% 0 0)`, opacity: t > 0 ? 1 : 0 }}>{text}</div>;
  }
  if (motion === 'fade-scale') {
    return <div style={{ ...base, opacity: t, transform: `scale(${0.94 + t * 0.06})`, transformOrigin: align === 'center' ? 'center' : 'left center' }}>{text}</div>;
  }
  // rise (default) — clip-mask slide up
  return (
    <div style={{ overflow: 'hidden', paddingBottom: '0.08em' }}>
      <div style={{ ...base, transform: `translateY(${(1 - t) * 100}%)`, opacity: t }}>{text}</div>
    </div>
  );
};

// ── Subtext ──────────────────────────────────────────────────────────────────
const Subtext: React.FC<{ brand: Brand; family: string; text: string; start: number; ease: (n: number) => number; align?: 'left' | 'center'; size?: number; maxWidth?: string }> = ({ brand, family, text, start, ease, align = 'left', size = 22, maxWidth = '82%' }) => {
  const frame = useCurrentFrame();
  if (!text) return null;
  const t = interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  return (
    <div style={{ fontFamily: family, fontSize: size, lineHeight: 1.35, color: brand.ink, maxWidth, opacity: t, transform: `translateY(${(1 - t) * 12}px)`, textAlign: align, marginInline: align === 'center' ? 'auto' : undefined }}>
      {text}
    </div>
  );
};

// ── Footer swipe cue ─────────────────────────────────────────────────────────
const Footer: React.FC<{ brand: Brand; headFamily: string; bodyFamily: string; footer: CoverSpec['footer']; start: number; fps: number; align?: 'left' | 'center' }> = ({ brand, headFamily, bodyFamily, footer, start, fps, align = 'left' }) => {
  const frame = useCurrentFrame();
  if (!footer.label && !footer.cta) return null;
  const t = interpolate(frame, [start, start + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const nudge = t >= 1 ? Math.sin((frame - start) / fps * 2.2) * 6 : 0;
  return (
    <div style={{ textAlign: align }}>
      {footer.label ? (
        <div style={{ fontFamily: headFamily, fontSize: 26, color: brand.ink, marginBottom: '2%', opacity: interpolate(frame, [start - 6, start + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{footer.label}</div>
      ) : null}
      {footer.cta ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: align === 'center' ? 'center' : 'flex-start' }}>
          <span style={{ fontFamily: bodyFamily, fontSize: 13, letterSpacing: 2, color: brand.accent, fontWeight: 700, textTransform: 'uppercase' }}>{footer.cta}</span>
          {footer.arrow ? <span style={{ color: brand.accent, fontSize: 18, transform: `translateX(${nudge}px)`, opacity: t }}>→</span> : null}
        </div>
      ) : null}
      <div style={{ marginTop: 10, height: 2, background: brand.hairline, position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, background: brand.accent, transformOrigin: 'left', transform: `scaleX(${t})` }} />
      </div>
    </div>
  );
};

// ── Illustration ─────────────────────────────────────────────────────────────
const Illustration: React.FC<{ brand: Brand; body: string; illustration: CoverSpec['illustration']; start: number }> = ({ brand, body, illustration, start }) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  if (illustration.mode === 'none') return null;
  return (
    <>
      {illustration.mode === 'primitives' && illustration.elements.length ? (
        <svg viewBox={`0 0 ${VB} ${VB}`} style={{ width: '100%', height: '100%', overflow: 'visible' }}>
          {illustration.elements.map((el, i) => <Primitive key={i} el={el} brand={brand} local={local} />)}
        </svg>
      ) : illustration.mode === 'image' && illustration.imageUrl ? (
        <Img src={illustration.imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: interpolate(local, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }} />
      ) : null}
      {illustration.caption ? (
        <div style={{ marginTop: '2%', fontFamily: body, fontSize: 12, letterSpacing: 1.5, color: brand.muted, textTransform: 'uppercase', opacity: interpolate(local, [4, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>{illustration.caption}</div>
      ) : null}
    </>
  );
};

// ── Composition ──────────────────────────────────────────────────────────────
export const AnimatedCover: React.FC<{ spec: CoverSpec }> = ({ spec }) => {
  const { fps } = useVideoConfig();
  const { brand, header, headline, subtext, stat, footer, illustration, timeline, motion, composition } = spec;
  const ease = easeFn(motion.ease);
  const { headline: headFamily, body: bodyFamily } = fontsOf(brand);
  const pad = '7.5% 7% 8%';

  const common = { brand, family: headFamily, headline, start: timeline.headline, stagger: motion.stagger, motion: motion.headline, ease };

  let inner: React.ReactNode;

  if (composition === 'centered') {
    inner = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'stretch', gap: '4%', padding: pad, color: brand.ink }}>
        <Header brand={brand} body={bodyFamily} header={header} start={timeline.header} align="center" />
        <Headline {...common} size={104} align="center" lineHeight={1.05} />
        <Subtext brand={brand} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} align="center" maxWidth="86%" />
        <div style={{ marginTop: '4%' }}>
          <Footer brand={brand} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} align="center" />
        </div>
      </div>
    );
  } else if (composition === 'statement-left') {
    inner = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '4%', padding: pad, color: brand.ink }}>
        <Header brand={brand} body={bodyFamily} header={header} start={timeline.header} />
        <div style={{ flex: 1 }} />
        <Subtext brand={brand} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} />
        <Headline {...common} size={110} lineHeight={1.0} />
        <Footer brand={brand} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} />
      </div>
    );
  } else if (composition === 'question') {
    inner = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6%', padding: pad, color: brand.ink }}>
        <Header brand={brand} body={bodyFamily} header={header} start={timeline.header} />
        <Headline {...common} size={120} lineHeight={1.03} />
        <Subtext brand={brand} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} size={24} />
        <div style={{ flex: 1 }} />
        <Footer brand={brand} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} />
      </div>
    );
  } else if (composition === 'stat') {
    const frame = timeline.headline;
    inner = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '3%', padding: pad, color: brand.ink, textAlign: 'center' }}>
        <Header brand={brand} body={bodyFamily} header={header} start={timeline.header} align="center" />
        <div style={{ flex: 1 }} />
        <StatBlock brand={brand} family={headFamily} stat={stat} start={frame} ease={ease} />
        <Headline {...common} size={52} align="center" lineHeight={1.1} />
        <Subtext brand={brand} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} align="center" maxWidth="80%" />
        <div style={{ flex: 1 }} />
        <Footer brand={brand} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} align="center" />
      </div>
    );
  } else if (composition === 'quote') {
    inner = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '3%', padding: pad, color: brand.ink }}>
        <Header brand={brand} body={bodyFamily} header={header} start={timeline.header} />
        <div style={{ flex: 1 }} />
        <QuoteMark brand={brand} family={headFamily} start={timeline.headline} />
        <Headline {...common} size={78} lineHeight={1.12} />
        <Subtext brand={brand} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} size={20} />
        <div style={{ flex: 1 }} />
        <Footer brand={brand} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} />
      </div>
    );
  } else if (composition === 'photo' && illustration.imageUrl) {
    // Full-bleed hook photo with a dark scrim and the headline over it.
    const local = timeline.illustration;
    inner = (
      <PhotoCover
        brand={brand} headFamily={headFamily} bodyFamily={bodyFamily}
        header={header} headline={headline} subtext={subtext} footer={footer}
        imageUrl={illustration.imageUrl} start={local} common={common} ease={ease}
        timeline={timeline} fps={fps} pad={pad}
      />
    );
  } else {
    // editorial-stack (default): header · headline · subtext · sketch · footer
    inner = (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: pad, color: brand.ink }}>
        <Header brand={brand} body={bodyFamily} header={header} start={timeline.header} />
        <div style={{ marginTop: '5%' }}>
          <Headline {...common} size={92} />
        </div>
        <div style={{ marginTop: '3.5%' }}>
          <Subtext brand={brand} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0, margin: '4% 0' }}>
          <Illustration brand={brand} body={bodyFamily} illustration={illustration} start={timeline.illustration} />
        </div>
        <Footer brand={brand} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} />
      </div>
    );
  }

  return (
    <AbsoluteFill style={{ fontFamily: bodyFamily }}>
      <Background brand={brand} kind={motion.background} />
      <AbsoluteFill>{inner}</AbsoluteFill>
    </AbsoluteFill>
  );
};

const StatBlock: React.FC<{ brand: Brand; family: string; stat: CoverSpec['stat']; start: number; ease: (n: number) => number }> = ({ brand, family, stat, start, ease }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start, start + 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
  if (!stat.value) return null;
  return (
    <div style={{ transform: `translateY(${(1 - t) * 20}px)`, opacity: t }}>
      <div style={{ fontFamily: family, fontSize: 200, lineHeight: 0.9, color: brand.accent, fontWeight: 700, letterSpacing: '-0.03em' }}>{stat.value}</div>
      {stat.label ? <div style={{ fontSize: 22, color: brand.muted, marginTop: 8 }}>{stat.label}</div> : null}
    </div>
  );
};

const PhotoCover: React.FC<{
  brand: Brand; headFamily: string; bodyFamily: string;
  header: CoverSpec['header']; headline: CoverSpec['headline']; subtext: CoverSpec['subtext']; footer: CoverSpec['footer'];
  imageUrl: string; start: number; common: any; ease: (n: number) => number;
  timeline: CoverSpec['timeline']; fps: number; pad: string;
}> = ({ brand, headFamily, bodyFamily, header, headline, subtext, footer, imageUrl, start, common, ease, timeline, fps, pad }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // Slow Ken-Burns zoom so the still photo has life.
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.14]);
  const imgIn = interpolate(frame, [start, start + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const white = '#FFFFFF';
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: imgIn, transform: `scale(${scale})` }}>
        <Img src={imageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      {/* readability scrim: darker at the bottom where the headline sits */}
      <AbsoluteFill style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.30) 42%, rgba(0,0,0,0.12) 70%, rgba(0,0,0,0.34) 100%)' }} />
      <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: pad, color: white }}>
        {/* header pinned to the top */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: `7.5% 7% 0` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3%' }}>
            {header.eyebrow ? <span style={{ fontFamily: bodyFamily, fontSize: 15, letterSpacing: 2, color: white, fontWeight: 600, textTransform: 'uppercase' }}>{header.eyebrow}</span> : null}
            <span style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.4)' }} />
            {header.counter ? <span style={{ fontFamily: bodyFamily, fontSize: 14, letterSpacing: 2, color: 'rgba(255,255,255,0.85)' }}>{header.counter}</span> : null}
          </div>
        </div>
        <Subtext brand={{ ...brand, ink: white }} family={bodyFamily} text={subtext.text} start={timeline.subtext} ease={ease} maxWidth="86%" />
        <div style={{ marginTop: '3%' }}>
          <Headline {...common} size={96} ink={white} lineHeight={1.02} />
        </div>
        <div style={{ marginTop: '5%' }}>
          <Footer brand={{ ...brand, ink: white, hairline: 'rgba(255,255,255,0.35)' }} headFamily={headFamily} bodyFamily={bodyFamily} footer={footer} start={timeline.footer} fps={fps} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const QuoteMark: React.FC<{ brand: Brand; family: string; start: number }> = ({ brand, family, start }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [start - 6, start + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ fontFamily: family, fontSize: 160, lineHeight: 0.6, color: brand.accent, opacity: t * 0.5, height: 90 }}>“</div>;
};
