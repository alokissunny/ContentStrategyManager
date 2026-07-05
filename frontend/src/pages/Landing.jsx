import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import SignalTerrain from '../components/SignalTerrain';
import { Eyebrow, SignalBtn, TextLink, scrollTo } from '../components/ui';
import { IcoRings, IcoRising, IcoBars, IcoBrackets, IcoNode, IcoTarget } from '../components/Icons';
import { useIsMobile, useIsTablet } from '../hooks/useMediaQuery';
import { LS_BG, LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_FONT, LS_DISPLAY, LSC } from '../theme';

function Wordmark() {
  const xs = [4, 9, 14, 19, 24, 29];
  const ys = [15, 10, 4, 11, 7, 13];
  return (
    <button onClick={() => scrollTo('top')} style={{ display: 'inline-flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
      <svg width="32" height="26" viewBox="0 0 34 28" fill="none">
        {xs.map((x, i) => <line key={i} x1={x} y1={ys[i]} x2={x} y2="24" stroke={i === 2 ? LS_SIGNAL : LS_INK} strokeWidth="2" strokeLinecap="round" />)}
      </svg>
      <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 21, letterSpacing: '-0.03em' }}>
        <span style={{ color: LS_INK }}>wide</span><span style={{ color: LS_SIGNAL }}>signals</span>
      </span>
    </button>
  );
}

function Nav({ onGo }) {
  const links = ['How it works', 'Features', 'About', 'Resources', 'Pricing'];
  const isTablet = useIsTablet();
  const [menuOpen, setMenuOpen] = useState(false);

  if (isTablet) {
    return (
      <div style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(250,249,247,0.95)', backdropFilter: 'saturate(150%) blur(10px)', borderBottom: menuOpen ? `1px solid ${LS_BORDER}` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px' }}>
          <Wordmark />
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <SignalBtn onClick={onGo}>Get started</SignalBtn>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Toggle menu"
              style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}
            >
              <Glyph name={menuOpen ? 'x' : 'menu'} size={24} color={LS_INK} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav style={{ display: 'flex', flexDirection: 'column', padding: '4px 20px 20px', gap: 4 }}>
            {links.map((l) => (
              <button
                key={l}
                onClick={() => { setMenuOpen(false); scrollTo('how'); }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: '10px 0', fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_INK }}
              >
                {l}
              </button>
            ))}
            <button
              onClick={() => { setMenuOpen(false); onGo(); }}
              style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: '10px 0', fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_INK }}
            >
              Log in
            </button>
          </nav>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(250,249,247,0.9)', backdropFilter: 'saturate(150%) blur(10px)' }}>
      <div style={{ ...LSC, display: 'flex', alignItems: 'center', gap: 28, padding: '20px 48px' }}>
        <Wordmark />
        <nav style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 30 }}>
          {links.map((l) => (
            <button key={l} onClick={() => scrollTo('how')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: LS_INK, whiteSpace: 'nowrap' }}>{l}</button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <button onClick={onGo} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 11.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: LS_INK, whiteSpace: 'nowrap' }}>Log in</button>
          <SignalBtn onClick={onGo}>Get my weekly route <Glyph name="arrow-right" size={15} color="#fff" /></SignalBtn>
        </div>
      </div>
    </div>
  );
}

function Hero({ onGo }) {
  const isTablet = useIsTablet();
  return (
    <section id="top" style={{ background: LS_BG, overflow: 'hidden' }}>
      <div style={{ ...LSC, position: 'relative', padding: isTablet ? '32px 20px 40px' : '56px 48px 64px', display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '0.82fr 1.18fr', gap: 24, alignItems: 'center' }}>
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 800, fontSize: 'clamp(34px, 4.4vw, 62px)', lineHeight: 0.98, letterSpacing: '-0.02em', margin: 0 }}>
            <span style={{ color: LS_INK }}>STOP GUESSING</span><br />
            <span style={{ color: LS_SIGNAL }}>WHAT WILL GROW<br />YOUR BUSINESS.</span>
          </h1>
          <div style={{ width: 230, height: 2, background: LS_SIGNAL, margin: '26px 0 0' }} />
          <p style={{ fontFamily: LS_FONT, fontSize: 16, fontWeight: 500, lineHeight: 1.55, color: LS_INK, maxWidth: 360, margin: '26px 0 0' }}>WideSignals helps small businesses understand what deserves attention next.</p>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, maxWidth: 360, margin: '16px 0 0' }}>See what&rsquo;s changing around your business, identify what your customers care about, and get a weekly route built around the signals that matter.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 24, marginTop: 30 }}>
            <SignalBtn onClick={onGo}>Get my weekly route <Glyph name="arrow-right" size={15} color="#fff" /></SignalBtn>
            <TextLink onClick={() => scrollTo('how')}>See how it works</TextLink>
          </div>
        </div>
        {!isTablet && <div style={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 -80px 0 0' }}><SignalTerrain /></div>}
      </div>
    </section>
  );
}

function LogoStrip() {
  const brands = [
    { t: 'Aesthete', f: LS_FONT, w: 500, ls: '-0.01em' },
    { t: 'STUDIO NOIR', f: LS_DISPLAY, w: 500, ls: '0.04em' },
    { t: 'C O V E N', f: LS_FONT, w: 500, ls: '0.06em' },
    { t: 'northfolk', f: LS_FONT, w: 500, ls: '-0.01em' },
    { t: 'ID/ENTITY', f: LS_FONT, w: 500, ls: '0.06em' },
    { t: 'FORMA', f: LS_DISPLAY, w: 800, ls: '0.02em' },
  ];
  return (
    <section style={{ background: LS_BG, borderTop: `1px solid ${LS_BORDER}`, borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ ...LSC, padding: 'clamp(20px, 5vw, 28px) clamp(20px, 5vw, 48px)', display: 'flex', alignItems: 'center', gap: 40, flexWrap: 'wrap' }}>
        <p style={{ fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: LS_MUTED, lineHeight: 1.5, margin: 0, maxWidth: 200 }}>
          Most business owners don&rsquo;t need more content. They need <span style={{ color: LS_INK }}>more certainty.</span>
        </p>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          {brands.map((b) => <span key={b.t} style={{ fontFamily: b.f, fontWeight: b.w, fontSize: 18, letterSpacing: b.ls, color: '#3f4147' }}>{b.t}</span>)}
        </div>
      </div>
    </section>
  );
}

function Problem() {
  const items = [
    [<IcoRings />, 'What customers care about', "You don't always know what they're interested in right now."],
    [<IcoRising />, "What's changing", "It's hard to keep up with what's emerging in your market."],
    [<IcoBars />, 'What competitors are getting right', "You see them growing but don't know why."],
    [<IcoRings />, 'What content creates demand', 'Most content gets likes. Few create demand.'],
    [<IcoBrackets />, "What's being ignored", 'Big opportunities hide in the things others miss.'],
    [<IcoNode />, 'What should happen next', 'The next step is never completely clear.'],
  ];
  const noise = Array.from({ length: 46 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7) * 22) + (i % 5 === 0 ? 10 : 0));
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const cols = isMobile ? 1 : isTablet ? 2 : 3;
  return (
    <section style={{ background: LS_BG, borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ ...LSC, padding: isTablet ? '48px 20px' : '72px 48px', display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '0.74fr 1.26fr', gap: isTablet ? 32 : 56, alignItems: 'start' }}>
        <div>
          <Eyebrow>The real problem</Eyebrow>
          <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(26px, 2.7vw, 34px)', lineHeight: 1.12, letterSpacing: '-0.02em', margin: 0 }}>
            <span style={{ color: LS_INK }}>You&rsquo;re not short<br />on effort.</span><br /><span style={{ color: LS_SIGNAL }}>You&rsquo;re short on clarity.</span>
          </h2>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, margin: '28px 0 0', maxWidth: 320 }}>You post. You react. You try new ideas. You follow trends. You stay consistent. Yet growth still feels unpredictable.</p>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, margin: '16px 0 0', maxWidth: 320 }}>Not because you&rsquo;re doing too little. Because nobody has shown you what actually deserves your attention.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 0 }}>
          {items.map(([ico, t, b], i) => (
            <div key={i} style={{ padding: '24px 26px', textAlign: 'center', borderLeft: i % cols !== 0 ? `1px solid ${LS_BORDER}` : 'none', borderTop: i >= cols ? `1px solid ${LS_BORDER}` : 'none' }}>
              <div style={{ height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ico}</div>
              <h3 style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_INK, margin: '18px 0 8px' }}>{t}</h3>
              <p style={{ fontFamily: LS_FONT, fontSize: 12.5, lineHeight: 1.5, color: LS_T2, margin: '0 auto', maxWidth: 170 }}>{b}</p>
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...LSC, padding: isTablet ? '0 20px 40px' : '0 48px 56px' }}>
        <div style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 12, background: LS_SURFACE, padding: '22px 28px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', justifyContent: 'space-between', gap: isMobile ? 20 : 40 }}>
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, lineHeight: 1.6, color: LS_T2, margin: 0, maxWidth: 420 }}>So you create more content. More posts. More effort. More noise.<br />The result is more activity. Not necessarily more growth.</p>
          <svg width="100%" height="40" viewBox="0 0 340 40" fill="none" preserveAspectRatio="xMidYMid meet" style={{ maxWidth: isMobile ? '100%' : 340, flexShrink: 0 }}>
            {noise.map((h, i) => <line key={i} x1={i * 7.3 + 4} y1={38} x2={i * 7.3 + 4} y2={38 - h} stroke={i % 4 === 0 ? LS_SIGNAL : '#c7cad1'} strokeWidth="1.4" strokeLinecap="round" />)}
          </svg>
        </div>
      </div>
    </section>
  );
}

function Approach() {
  const cols = [
    [<IcoBars size={36} />, 'Audience signals', ["What people are interested in.", "What they're asking.", "What they're reacting to."]],
    [<IcoRising size={40} />, 'Market signals', ['What is changing.', 'What is emerging.', 'What is gaining momentum.']],
    [<IcoTarget size={36} />, 'Opportunity signals', ["What competitors aren't talking about.", 'What gaps exist.', 'Where attention can be earned.']],
  ];
  const isTablet = useIsTablet();
  return (
    <section id="how" style={{ background: LS_BG, borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ ...LSC, padding: isTablet ? '48px 20px' : '72px 48px', display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '0.74fr 1.26fr', gap: isTablet ? 32 : 56, alignItems: 'start' }}>
        <div>
          <Eyebrow>Our approach</Eyebrow>
          <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(26px, 2.7vw, 34px)', lineHeight: 1.12, letterSpacing: '-0.02em', color: LS_INK, margin: 0 }}>Find what others miss.</h2>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, margin: '24px 0 22px', maxWidth: 320 }}>WideSignals continuously looks for patterns around your business. Not to tell you what everyone else is doing. To show you what deserves your attention.</p>
          <TextLink onClick={() => scrollTo('philosophy')}>See how it works</TextLink>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isTablet ? '1fr' : 'repeat(3, 1fr)', gap: isTablet ? 28 : 40 }}>
          {cols.map(([ico, t, lines], i) => (
            <div key={i}>
              <div style={{ height: 44, display: 'flex', alignItems: 'center' }}>{ico}</div>
              <h3 style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_INK, margin: '18px 0 10px' }}>{t}</h3>
              {lines.map((l) => <p key={l} style={{ fontFamily: LS_FONT, fontSize: 13.5, lineHeight: 1.5, color: LS_T2, margin: '0 0 4px' }}>{l}</p>)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Philosophy() {
  const inputs = ['Your goals', 'Your audience', 'Your positioning', 'Market opportunities', 'Content gaps'];
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  return (
    <section id="philosophy" style={{ background: LS_BG, borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ ...LSC, padding: isTablet ? '48px 20px' : '72px 48px', display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '0.74fr 1.26fr', gap: isTablet ? 32 : 56, alignItems: 'center' }}>
        <div>
          <Eyebrow>Our philosophy</Eyebrow>
          <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(26px, 2.7vw, 34px)', lineHeight: 1.12, letterSpacing: '-0.02em', color: LS_INK, margin: 0 }}>Strategy before content.</h2>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.6, color: LS_T2, margin: '22px 0 16px', maxWidth: 330 }}>Most tools start with &ldquo;What should I post?&rdquo; We start with &ldquo;What business problem are we solving?&rdquo;</p>
          <p style={{ fontFamily: LS_FONT, fontSize: 14, fontWeight: 600, color: LS_INK, margin: '0 0 10px' }}>Every recommendation is connected to:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inputs.map((x) => (
              <div key={x} style={{ display: 'flex', alignItems: 'center', gap: 9, fontFamily: LS_FONT, fontSize: 14, color: LS_T2 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: LS_SIGNAL }} /> {x}
              </div>
            ))}
          </div>
        </div>
        <div style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 14, background: LS_SURFACE, padding: isMobile ? '26px 20px' : '34px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13, flexShrink: 0 }}>
              {inputs.map((x) => <span key={x} style={{ fontFamily: LS_FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: LS_T2, whiteSpace: 'nowrap' }}>{x}</span>)}
            </div>
            <svg width="120" height="150" viewBox="0 0 120 150" fill="none" style={{ flexShrink: 0 }}>
              {[14, 42, 71, 100, 128].map((y, i) => <path key={i} d={`M0 ${y} C 50 ${y}, 70 75, 116 75`} stroke="#cfd3da" strokeWidth="1" fill="none" />)}
              {[14, 42, 71, 100, 128].map((y, i) => <circle key={'c' + i} cx="2" cy={y} r="2" fill={LS_SIGNAL} />)}
            </svg>
            <div style={{ width: 78, height: 78, borderRadius: '50%', border: `1px solid ${LS_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><IcoBars size={34} /></div>
            <Glyph name="arrow-right" size={22} color={LS_MUTED} style={{ margin: '0 20px', flexShrink: 0 }} />
            <div style={{ flex: isMobile ? '0 0 140px' : 1, minWidth: isMobile ? 140 : 0 }}>
              <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_INK, lineHeight: 1.4 }}>Strategic content<br />that creates demand</div>
              <svg width="100" height="40" viewBox="0 0 100 40" fill="none" style={{ marginTop: 12 }}>
                {[0, 1, 2, 3, 4, 5].map((i) => <line key={i} x1={i * 16 + 6} y1={38} x2={i * 16 + 6} y2={38 - [16, 26, 12, 32, 20, 28][i]} stroke={i % 2 ? LS_SIGNAL : '#c7cad1'} strokeWidth="2" strokeLinecap="round" />)}
              </svg>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${LS_BORDER}`, marginTop: 26, paddingTop: 18, textAlign: 'center', fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: LS_INK }}>
            Content is not the strategy. <span style={{ color: LS_SIGNAL }}>Content is the outcome.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function RouteBody({ body }) {
  if (body === 'list') {
    return ['Market Shift', 'Emerging Opportunity', 'Content Gap'].map((x) => (
      <div key={x} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderTop: `1px solid ${LS_BORDER}` }}>
        <span style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_INK }}>{x}</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: LS_SIGNAL }} />
      </div>
    ));
  }
  if (body === 'chart') {
    return (
      <svg width="100%" height="84" viewBox="0 0 150 84" fill="none" preserveAspectRatio="none">
        <path d="M0 78 L30 62 L55 66 L85 40 L110 44 L150 14 L150 84 L0 84 Z" fill={LS_SIGNAL} opacity="0.08" />
        <path d="M0 78 L30 62 L55 66 L85 40 L110 44 L150 14" stroke={LS_SIGNAL} strokeWidth="1.6" fill="none" strokeLinejoin="round" />
        <circle cx="30" cy="62" r="2.6" fill={LS_SIGNAL} />
        <circle cx="85" cy="40" r="2.6" fill={LS_SIGNAL} />
        <circle cx="150" cy="14" r="2.6" fill={LS_SIGNAL} />
      </svg>
    );
  }
  if (body === 'todo') {
    return ['Educate', 'Prove', 'Engage'].map((x) => (
      <div key={x} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 0', borderTop: `1px solid ${LS_BORDER}` }}>
        <span style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_INK }}>{x}</span>
        <Glyph name="arrow-right" size={13} color={LS_MUTED} />
      </div>
    ));
  }
  const bars = [14, 20, 12, 26, 18, 30, 22];
  return (
    <div>
      <div style={{ fontFamily: LS_FONT, fontSize: 11, color: LS_T2, marginBottom: 2 }}>Performance This Week</div>
      <div style={{ fontFamily: LS_DISPLAY, fontWeight: 800, fontSize: 30, color: LS_SIGNAL, lineHeight: 1 }}>247</div>
      <div style={{ fontFamily: LS_FONT, fontSize: 11.5, color: LS_T2, margin: '4px 0 10px' }}>+18% vs last week</div>
      <svg width="100%" height="34" viewBox="0 0 120 34" fill="none" preserveAspectRatio="none">
        {bars.map((h, i) => <line key={i} x1={i * 17 + 6} y1="32" x2={i * 17 + 6} y2={32 - h} stroke={i > 4 ? LS_SIGNAL : '#c7cad1'} strokeWidth="3" strokeLinecap="round" />)}
      </svg>
    </div>
  );
}

function WeeklyRoute({ onGo }) {
  const cards = [
    { n: '1. What matters', d: 'Top opportunities detected this week.', foot: 'View all', body: 'list' },
    { n: '2. Why it matters', d: 'The signals behind each opportunity.', foot: 'View insight', body: 'chart' },
    { n: '3. What to do', d: 'A practical route built around your business.', foot: 'View route', body: 'todo' },
    { n: '4. What happened', d: 'Learn from results and improve every week.', foot: 'View reality check', body: 'perf' },
  ];
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const cardCols = isMobile ? 1 : isTablet ? 2 : 4;
  return (
    <section style={{ background: LS_BG, borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ ...LSC, padding: isTablet ? '48px 20px' : '72px 48px', display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '0.74fr 1.26fr', gap: isTablet ? 32 : 56, alignItems: 'start' }}>
        <div>
          <Eyebrow>Your weekly route</Eyebrow>
          <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(26px, 2.7vw, 34px)', lineHeight: 1.12, letterSpacing: '-0.02em', color: LS_INK, margin: 0 }}>A strategic route.<br />Not a content calendar.</h2>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, margin: '24px 0 22px', maxWidth: 300 }}>Every week WideSignals shows you exactly what deserves your attention.</p>
          <TextLink onClick={onGo}>Explore the weekly route</TextLink>
        </div>
        <div style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 14, background: LS_SURFACE, display: 'grid', gridTemplateColumns: `repeat(${cardCols}, 1fr)` }}>
          {cards.map((c, i) => (
            <div key={i} style={{ padding: '22px 20px', borderLeft: i % cardCols ? `1px solid ${LS_BORDER}` : 'none', borderTop: i >= cardCols ? `1px solid ${LS_BORDER}` : 'none', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 12.5, letterSpacing: '0.03em', textTransform: 'uppercase', color: LS_INK }}>{c.n}</div>
              <p style={{ fontFamily: LS_FONT, fontSize: 12.5, lineHeight: 1.5, color: LS_T2, margin: '8px 0 18px' }}>{c.d}</p>
              <div style={{ flex: 1 }}><RouteBody body={c.body} /></div>
              <div style={{ marginTop: 16, fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: LS_MUTED }}>{c.foot}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Authority({ onGo }) {
  const steps = [['01', 'Discovery', 'Helping more people find you.'], ['02', 'Credibility', 'Helping people learn from you.'], ['03', 'Trust', 'Helping people believe you can help them.']];
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  return (
    <section style={{ background: LS_BG, borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ ...LSC, padding: isTablet ? '48px 20px' : '72px 48px', display: 'grid', gridTemplateColumns: isTablet ? '1fr' : '0.74fr 1.26fr', gap: isTablet ? 32 : 56, alignItems: 'center' }}>
        <div>
          <Eyebrow>Built for authority</Eyebrow>
          <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(26px, 2.7vw, 34px)', lineHeight: 1.12, letterSpacing: '-0.02em', color: LS_INK, margin: 0 }}>Built around how<br />trust is actually created.</h2>
          <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.65, color: LS_T2, margin: '24px 0 22px', maxWidth: 320 }}>Most businesses focus on posting more. WideSignals focuses on building authority.</p>
          <TextLink onClick={onGo}>Learn more</TextLink>
        </div>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 20 : 12 }}>
          {steps.map(([n, t, b], i) => (
            <React.Fragment key={n}>
              <div style={{ textAlign: isMobile ? 'left' : 'center', flex: isMobile ? 'none' : 1, display: isMobile ? 'flex' : 'block', alignItems: isMobile ? 'center' : undefined, gap: isMobile ? 16 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}><IcoRings size={isMobile ? 36 : 44} /></div>
                <div style={isMobile ? { flex: 1, minWidth: 0 } : undefined}>
                  <div style={{ fontFamily: LS_FONT, fontSize: 11, color: LS_MUTED, margin: isMobile ? '0 0 4px' : '14px 0 4px' }}>{n}</div>
                  <h3 style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 12.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_INK, margin: '0 0 8px' }}>{t}</h3>
                  <p style={{ fontFamily: LS_FONT, fontSize: 12.5, lineHeight: 1.5, color: LS_T2, margin: isMobile ? 0 : '0 auto', maxWidth: isMobile ? 'none' : 130 }}>{b}</p>
                </div>
              </div>
              {i < 2 && !isMobile && <Glyph name="arrow-right" size={20} color={LS_MUTED} style={{ flexShrink: 0 }} />}
            </React.Fragment>
          ))}
          <div style={{ borderLeft: isMobile ? 'none' : `1px solid ${LS_BORDER}`, borderTop: isMobile ? `1px solid ${LS_BORDER}` : 'none', paddingLeft: isMobile ? 0 : 24, paddingTop: isMobile ? 20 : 0, marginLeft: isMobile ? 0 : 8, flexShrink: 0, width: isMobile ? '100%' : 150 }}>
            <p style={{ fontFamily: LS_FONT, fontSize: 14, lineHeight: 1.5, color: LS_INK, margin: 0 }}>Growth happens when people <span style={{ color: LS_SIGNAL }}>choose you.</span></p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Closing({ onGo }) {
  const flow = [[<IcoRings size={26} />, 'Clarity creates strategy.'], [<IcoRising size={28} />, 'Strategy creates positioning.'], [<IcoBars size={24} />, 'Positioning creates demand.'], [<IcoTarget size={26} />, 'Demand creates growth.']];
  return (
    <section style={{ background: LS_BG, position: 'relative', overflow: 'hidden' }}>
      <div style={{ ...LSC, padding: 'clamp(48px, 10vw, 80px) clamp(20px, 5vw, 48px) clamp(40px, 8vw, 72px)', textAlign: 'center', position: 'relative', zIndex: 2 }}>
        <Eyebrow center>Most businesses don&rsquo;t need more content</Eyebrow>
        <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(30px, 3.4vw, 44px)', letterSpacing: '-0.025em', color: LS_INK, margin: '0 0 14px' }}>They need better decisions.</h2>
        <p style={{ fontFamily: LS_FONT, fontSize: 16, color: LS_T2, margin: '0 auto 44px' }}>WideSignals helps you understand where effort should go next.</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 48 }}>
          {flow.map(([ico, t], i) => (
            <React.Fragment key={i}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>{ico}<span style={{ fontFamily: LS_FONT, fontSize: 13, color: LS_INK, maxWidth: 110, textAlign: 'left', lineHeight: 1.35 }}>{t}</span></div>
              {i < 3 && <Glyph name="arrow-right" size={17} color={LS_MUTED} />}
            </React.Fragment>
          ))}
        </div>
        <SignalBtn size="lg" onClick={onGo}>Get my weekly route <Glyph name="arrow-right" size={16} color="#fff" /></SignalBtn>
        <p style={{ fontFamily: LS_FONT, fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '34px 0 0' }}>
          <span style={{ color: LS_INK }}>Stop guessing. </span><span style={{ color: LS_SIGNAL }}>Follow the signal.</span>
        </p>
      </div>
    </section>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const onGo = () => navigate('/auth');

  return (
    <div style={{ background: LS_BG }}>
      <Nav onGo={onGo} />
      <Hero onGo={onGo} />
      <LogoStrip />
      <Problem />
      <Approach />
      <Philosophy />
      <WeeklyRoute onGo={onGo} />
      <Authority onGo={onGo} />
      <Closing onGo={onGo} />
    </div>
  );
}
