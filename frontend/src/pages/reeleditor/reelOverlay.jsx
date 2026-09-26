/*
 * Shared reel overlay renderers — the time-synced DOM layer drawn over the
 * <video>. Used by both the live preview (ReelEditor) and the manual timeline
 * editor (ReelEditView) so the two always render identically.
 */
import React from 'react';

// Inline safety sizing — applied even if the stylesheet chunk is slow/absent, so
// the <video> can never render at its natural (huge) resolution.
export const PHONE_STYLE = { width: '100%', maxWidth: 300, aspectRatio: '9 / 16', maxHeight: '72vh' };
export const SCREEN_STYLE = { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' };
export const VIDEO_BASE = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' };
export const TITLE_END = 2.8;
const placed = (position) => position && Number.isFinite(position.x) && Number.isFinite(position.y)
  ? { left: `${position.x}%`, top: `${position.y}%`, bottom: 'auto', right: 'auto', width: '86%', transform: 'translate(-50%, -50%)' } : {};

export function fmtTime(s) {
  const t = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, '0')}`;
}

export function CaptionLayer({ captions, time }) {
  if (!captions?.cues?.length) return null;
  const cue = captions.cues.find((c) => time >= c.start && time < c.end);
  if (!cue) return null;
  const frac = (time - cue.start) / Math.max(0.1, cue.end - cue.start);
  const words = String(cue.text || '').split(/\s+/).filter(Boolean);
  const emph = new Set((cue.emphasis || []).map((w) => w.toLowerCase().replace(/[^a-z0-9]/gi, '')));
  const style = captions.style || 'karaoke';

  let inner;
  if (style === 'word') {
    const idx = Math.min(words.length - 1, Math.floor(frac * words.length));
    const w = words[idx] || '';
    inner = <span className={`rl-cap__w is-lit ${emph.has(w.toLowerCase().replace(/[^a-z0-9]/gi, '')) ? 'is-emph' : ''}`}>{w}</span>;
  } else {
    const litCount = style === 'karaoke' ? Math.ceil(frac * words.length) : words.length;
    inner = words.map((w, i) => {
      const bare = w.toLowerCase().replace(/[^a-z0-9]/gi, '');
      const lit = style === 'karaoke' ? i < litCount : true;
      return (
        <span key={i} className={`rl-cap__w ${lit ? 'is-lit' : ''} ${emph.has(bare) ? 'is-emph' : ''}`}>
          {w}{' '}
        </span>
      );
    });
  }
  return (
    <div data-reel-text={`captions:${captions.cues.indexOf(cue)}`} style={placed(cue.position)} className={`rl-cap rl-cap--${captions.position || 'bottom'} rl-cap--${style}`}>
      <span className="rl-cap__box" style={style === 'pop' ? { animationPlayState: 'paused', animationDelay: `${-(time - cue.start)}s` } : undefined}>{inner}</span>
    </div>
  );
}

export function animOpacity(a, time) {
  const enter = Math.min(1, (time - a.start) / 0.4);
  const exit = Math.min(1, (a.end - time) / 0.35);
  return Math.max(0, Math.min(enter, exit));
}

export function motionTransform(a, time) {
  const p = Math.min(1, (time - a.start) / 0.4);
  const ease = 1 - Math.pow(1 - p, 3);
  switch (a.motion) {
    case 'slide-up': return `translateY(${(1 - ease) * 24}px)`;
    case 'pop': return `scale(${0.7 + ease * 0.3})`;
    case 'bounce': return `translateY(${(1 - ease) * -18}px)`;
    case 'shake': return `translateX(${Math.sin(time * 30) * (1 - ease) * 6}px)`;
    default: return 'none';
  }
}

export function AnimationLayer({ animations, time, duration }) {
  return (
    <>
      {(animations || []).map((a, i) => {
        if (['pointer', 'spotlight', 'label'].includes(a.type) && /\b(face|faces|head|heads|boy|girl|child|kid|person|speaker)\b/i.test(a.text || '')) return null;
        if (a.type === 'progress') {
          return (
            <div key={i} className="rl-anim rl-anim--progress">
              <i style={{ width: `${Math.min(100, (time / Math.max(1, duration)) * 100)}%` }} />
            </div>
          );
        }
        if (time < a.start || time > a.end) return null;
        if (a.type === 'zoom' || a.type === 'title') return null; // title → TitleCard; zoom → video wrapper
        const opacity = animOpacity(a, time);
        const x = a.position?.x ?? 50;
        const y = a.position?.y ?? 50;

        if (a.type === 'spotlight') {
          return (
            <div
              key={i}
              className="rl-anim rl-anim--spotlight"
              style={{ opacity, background: `radial-gradient(circle at ${x}% ${y}%, rgba(0,0,0,0) 0, rgba(0,0,0,0) 10%, rgba(0,0,0,0.55) 24%)` }}
            />
          );
        }
        if (a.type === 'pointer') {
          return (
            <div key={i} className="rl-anim rl-anim--pointer" style={{ left: `${x}%`, top: `${y}%`, opacity }}>
              <span className="rl-ring" style={{ animationPlayState: 'paused', animationDelay: `${-(time - a.start)}s` }} />
              <span className="rl-ring rl-ring--2" style={{ animationPlayState: 'paused', animationDelay: `${0.6 - (time - a.start)}s` }} />
              <span className="rl-dot" />
            </div>
          );
        }
        if (a.type === 'label') {
          return (
            <div data-reel-text={`animations:${i}`} key={i} className="rl-anim rl-anim--labelwrap" style={{ left: `${x}%`, top: `${y}%`, opacity }}>
              <span className="rl-label__pill" style={{ transform: `translate(-50%, calc(-100% - 20px)) ${motionTransform(a, time)}` }}>{a.text}</span>
              <span className="rl-label__leader" />
              <span className="rl-label__dot" />
            </div>
          );
        }

        const style = {
          left: `${x}%`,
          top: `${y}%`,
          opacity,
          transform: `translate(-50%, -50%) ${motionTransform(a, time)}`,
        };
        const cls = `rl-anim rl-anim--${a.type}${a.emphasis ? ' is-emph' : ''}`;
        if (a.type === 'emoji') return <div data-reel-text={`animations:${i}`} key={i} className={cls} style={style}>{a.emoji || '✨'}</div>;
        return <div data-reel-text={`animations:${i}`} key={i} className={cls} style={style}>{a.text}</div>;
      })}
    </>
  );
}

// Active zoom animation → a subtle scale on the video itself.
export function zoomScale(animations, time) {
  const z = (animations || []).find((a) => a.type === 'zoom' && time >= a.start && time <= a.end);
  if (!z) return 1;
  const mid = (z.start + z.end) / 2;
  const half = Math.max(0.1, (z.end - z.start) / 2);
  return 1 + (1 - Math.min(1, Math.abs(time - mid) / half)) * 0.12;
}

export function BrandBar({ brand }) {
  if (!brand?.name) return null;
  return (
    <div data-reel-text="brand:0" className="rl-brandbar" style={placed(brand.position)}>
      <span className="rl-brandbar__logo"><i className="rl-dotmark" />{brand.name}</span>
      {brand.tag && <span className="rl-brandbar__tag">{brand.tag}</span>}
    </div>
  );
}

export function TitleCard({ strategy, time }) {
  if (!strategy?.hook || time > TITLE_END) return null;
  const words = String(strategy.hook).toUpperCase().split(/\s+/).filter(Boolean);
  const opacity = Math.min(1, (TITLE_END - time) / 0.4);
  const cut = words.length > 2 ? words.length - 2 : Math.max(1, words.length - 1);
  const head = words.slice(0, cut).join(' ');
  const tail = words.slice(cut).join(' ');
  return (
    <div data-reel-text="strategy:0" className="rl-title" style={{ opacity, ...placed(strategy.position) }}>
      {strategy.hookEyebrow && <span className="rl-title__eyebrow">{strategy.hookEyebrow}</span>}
      <span className="rl-title__head">
        {head} {tail && <span className="rl-accent">{tail}</span>}
      </span>
      <span className="rl-title__rule" />
    </div>
  );
}

export function SectionCard({ sections, time }) {
  if (!sections?.length) return null;
  const s = sections.find((x) => time >= x.start && time < x.end);
  if (!s) return null;
  const pct = Math.min(100, Math.max(0, ((time - s.start) / Math.max(0.5, s.end - s.start)) * 100));
  const lit = Math.ceil((pct / 100) * (s.chips?.length || 0));
  return (
    <div data-reel-text={`sections:${sections.indexOf(s)}`} className="rl-section" style={placed(s.position)}>
      {s.eyebrow && <span className="rl-section__eyebrow">{s.eyebrow}</span>}
      {s.chips?.length ? (
        <div className="rl-section__chips">
          {s.chips.map((c, i) => (
            <span key={i} className={`rl-chip ${i < lit ? 'is-lit' : ''}`}>{c}</span>
          ))}
        </div>
      ) : (
        <b className="rl-section__headline">{s.headline}</b>
      )}
      <span className="rl-section__bar"><i style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

// The overlay stack drawn inside the phone screen, shared by preview + editor.
export function ReelOverlay({ spec, time }) {
  const duration = spec?.meta?.durationSec || 0;
  return (
    <div className="rl-overlay">
      {spec?.brandKit?.logo ? <img className={`rl-kit-logo rl-kit-logo--${spec.brandKit.logo.position}`} src={spec.brandKit.logo.url} crossOrigin="anonymous" alt={spec.brandKit.name || 'Brand logo'} /> : <BrandBar brand={spec?.brandKit ? { name: spec.brandKit.name, position: spec?.brand?.position } : spec?.brand} />}
      <AnimationLayer animations={spec?.animations} time={time} duration={duration} />
      <SectionCard sections={spec?.sections} time={time} />
      <CaptionLayer captions={spec?.captions} time={time} />
      <TitleCard strategy={spec?.strategy} time={time} />
    </div>
  );
}
