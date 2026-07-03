import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import SignalTerrain from '../components/SignalTerrain';
import RadarPulse from '../components/RadarPulse';
import StepList from '../components/StepList';
import { fetchInstagram } from '../api/instagram';
import {
  LS_BG, LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_SOFT_BORDER, LS_FONT,
} from '../theme';

function Wordmark() {
  const xs = [4, 9, 14, 19, 24, 29];
  const ys = [15, 10, 4, 11, 7, 13];
  return (
    <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
      <svg width="30" height="24" viewBox="0 0 34 28" fill="none">
        {xs.map((x, i) => <line key={i} x1={x} y1={ys[i]} x2={x} y2="24" stroke={i === 2 ? LS_SIGNAL : LS_INK} strokeWidth="2" strokeLinecap="round" />)}
      </svg>
      <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 19, letterSpacing: '-0.03em' }}>
        <span style={{ color: LS_INK }}>wide</span><span style={{ color: LS_SIGNAL }}>signals</span>
      </span>
    </Link>
  );
}

function PrimaryBtn({ children, onClick, type, full, disabled }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: full ? '100%' : 'auto',
        height: 50, padding: '0 26px', borderRadius: 9, border: 'none', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: '0.05em',
        textTransform: 'uppercase', background: LS_SIGNAL, color: '#fff',
      }}
    >
      {children}
    </button>
  );
}

function Eyebrow({ children }) {
  return <p style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: LS_SIGNAL, margin: '0 0 16px' }}>{children}</p>;
}

const inputCss = { width: '100%', border: `1px solid ${LS_BORDER}`, borderRadius: 10, padding: '12px 14px', fontSize: 15, color: LS_INK, background: LS_SURFACE, outline: 'none' };
function Inp(props) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{ ...inputCss, borderColor: focused ? LS_SIGNAL : LS_BORDER, boxShadow: focused ? `0 0 0 3px ${LS_SOFT}` : 'none' }}
    />
  );
}

function Shell({ children, max = 620 }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: LS_BG }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '22px 40px' }}>
        <Wordmark />
        <Link to="/dashboard" style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Skip for now <Glyph name="arrow-right" size={15} color={LS_T2} />
        </Link>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 40px 64px' }}>
        <div style={{ width: '100%', maxWidth: max }}>{children}</div>
      </div>
    </div>
  );
}

function extractUsername(input) {
  return (input || '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .trim()
    .toLowerCase();
}

const SCRAPE_STEPS = [
  { icon: 'image', label: 'Fetching recent posts', note: 'Reels, carousels, photos' },
  { icon: 'hash', label: 'Reading captions & hashtags', note: 'Topics and keywords' },
  { icon: 'activity', label: 'Measuring engagement', note: 'Likes, comments, saves' },
  { icon: 'film', label: 'Checking content mix', note: 'Formats and patterns' },
  { icon: 'users', label: 'Collecting audience signals', note: 'What resonates' },
];

function WelcomeScreen({ onStart }) {
  return (
    <Shell max={1040}>
      <div style={{ display: 'grid', gridTemplateColumns: '0.82fr 1.18fr', gap: 36, alignItems: 'center' }}>
        <div>
          <Eyebrow>Strategic signal intelligence</Eyebrow>
          <h1 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(32px,3.6vw,46px)', lineHeight: 1.06, letterSpacing: '-0.025em', color: LS_INK, margin: 0 }}>
            See what&rsquo;s really happening in your content.
          </h1>
          <p style={{ fontFamily: LS_FONT, fontSize: 16.5, lineHeight: 1.6, color: LS_T2, margin: '20px 0 32px', maxWidth: 380 }}>
            WideSignals reads your Instagram and shows you what deserves attention next.
          </p>
          <PrimaryBtn onClick={onStart}>Analyze my Instagram <Glyph name="arrow-right" size={16} color="#fff" /></PrimaryBtn>
        </div>
        <div style={{ minHeight: 380, margin: '0 -60px 0 0' }}><SignalTerrain /></div>
      </div>
    </Shell>
  );
}

function ConnectScreen({ handle, setHandle, onAnalyze }) {
  return (
    <Shell max={460}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><RadarPulse size={120} /></div>
        <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em', color: LS_INK, margin: '0 0 8px' }}>Connect your Instagram</h2>
        <p style={{ fontFamily: LS_FONT, fontSize: 15, color: LS_T2, margin: '0 0 26px' }}>We read your public posts to understand your business. Nothing is posted on your behalf.</p>
        <label style={{ display: 'block', textAlign: 'left', fontFamily: LS_FONT, fontSize: 14, fontWeight: 600, color: LS_INK, marginBottom: 8 }}>Your Instagram profile URL or handle</label>
        <div style={{ display: 'flex', gap: 10 }}>
          <Inp
            placeholder="instagram.com/yourbrand"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && handle.trim()) onAnalyze(); }}
          />
          <PrimaryBtn onClick={() => handle.trim() && onAnalyze()} disabled={!handle.trim()}>Analyze</PrimaryBtn>
        </div>
      </div>
    </Shell>
  );
}

function AnalyzeScreen({ username, onDone, onError }) {
  const [step, setStep] = useState(0);
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    const iv = setInterval(() => {
      setStep((cur) => (cur < SCRAPE_STEPS.length - 1 ? cur + 1 : cur));
    }, 900);

    fetchInstagram(username)
      .then((profile) => {
        clearInterval(iv);
        if (cancelled) return;
        setStep(SCRAPE_STEPS.length);
        setTimeout(() => { if (!cancelled) onDone(profile); }, 500);
      })
      .catch((err) => {
        clearInterval(iv);
        if (cancelled) return;
        setErrMsg(err.response?.data?.message || 'Could not reach the server. Make sure it is running on port 5000.');
      });

    return () => { cancelled = true; clearInterval(iv); };
  }, [username]);

  if (errMsg) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 20 }}>
        <Glyph name="alert-circle" size={38} color={LS_SIGNAL} />
        <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 22, color: LS_INK, margin: '14px 0 8px' }}>Something went wrong</h2>
        <p style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.6, color: LS_T2, margin: '0 auto 24px', maxWidth: 360 }}>{errMsg}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <PrimaryBtn onClick={() => window.location.reload()}>Try again</PrimaryBtn>
          <button onClick={() => onError(errMsg)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 14, fontWeight: 500, color: LS_T2 }}>Skip to dashboard →</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, fontFamily: LS_FONT, fontWeight: 700, fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: LS_SIGNAL, margin: '0 0 14px' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: LS_SIGNAL, animation: 'lsSpark 1.2s ease-in-out infinite' }} /> Reading your account
      </p>
      <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em', color: LS_INK, textAlign: 'center', margin: '0 0 4px' }}>Reading your Instagram…</h2>
      <p style={{ fontFamily: LS_FONT, fontSize: 14.5, color: LS_T2, textAlign: 'center', margin: '0 0 26px' }}>Pulling recent posts from @{username}</p>
      <StepList steps={SCRAPE_STEPS} done={step} />
      <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, textAlign: 'center', marginTop: 18 }}>Usually takes 30–90 seconds depending on account size.</p>
    </div>
  );
}

function DNACard({ label, children, accent }) {
  return (
    <div style={{ background: accent ? LS_SOFT : LS_SURFACE, border: `1px solid ${accent ? LS_SOFT_BORDER : LS_BORDER}`, borderRadius: 14, padding: '20px 22px', marginBottom: 12 }}>
      <div style={{ fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent ? LS_SIGNAL : LS_MUTED, marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  );
}

function formatCount(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function ResultsScreen({ profile, error, onDash, onRetry }) {
  if (!profile) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 40 }}>
        <Glyph name="alert-circle" size={38} color={LS_SIGNAL} />
        <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 22, color: LS_INK, margin: '14px 0 8px' }}>Analysis failed</h2>
        <p style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.6, color: LS_T2, margin: '0 auto 24px', maxWidth: 360 }}>{error || 'Something went wrong. Try again or continue to the dashboard.'}</p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <PrimaryBtn onClick={onRetry}>Try again</PrimaryBtn>
          <button onClick={onDash} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 14, fontWeight: 500, color: LS_T2 }}>Continue to dashboard →</button>
        </div>
      </div>
    );
  }

  const posts = profile.posts || [];

  return (
    <div>
      <Eyebrow>Your Instagram signals</Eyebrow>
      <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(24px,3vw,32px)', letterSpacing: '-0.02em', color: LS_INK, margin: '0 0 24px' }}>
        Here&rsquo;s what WideSignals found for @{profile.username}.
      </h2>

      <DNACard label="Profile">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: LS_SOFT, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {profile.profilePicUrl ? (
              <img src={profile.profilePicUrl} alt={profile.username} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 20, color: LS_SIGNAL }}>{(profile.username || '?')[0]?.toUpperCase()}</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 16, color: LS_INK }}>{profile.fullName || profile.username}</div>
            <div style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, marginTop: 2 }}>{profile.biography || 'No bio available'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 18 }}>
          {[['Followers', profile.followersCount], ['Following', profile.followingCount], ['Posts', profile.postsCount]].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 18, color: LS_INK }}>{formatCount(val)}</div>
              <div style={{ fontFamily: LS_FONT, fontSize: 11.5, color: LS_MUTED, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            </div>
          ))}
        </div>
      </DNACard>

      <DNACard label={`Recent posts (${posts.length})`}>
        {posts.length === 0 ? (
          <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, margin: 0 }}>No recent posts were returned for this account.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {posts.slice(0, 12).map((p, i) => (
              <div key={p.externalId || i} style={{ border: `1px solid ${LS_BORDER}`, borderRadius: 10, overflow: 'hidden', background: LS_BG }}>
                {p.displayUrl && <img src={p.displayUrl} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} />}
                <div style={{ padding: '8px 10px' }}>
                  <p style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_INK, margin: '0 0 6px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.caption || 'No caption'}</p>
                  <div style={{ display: 'flex', gap: 10, fontFamily: LS_FONT, fontSize: 11, color: LS_MUTED }}>
                    <span>♥ {formatCount(p.likesCount)}</span>
                    <span>💬 {formatCount(p.commentsCount)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DNACard>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
        <PrimaryBtn onClick={onDash}>Open my dashboard <Glyph name="arrow-right" size={16} color="#fff" /></PrimaryBtn>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [screen, setScreen] = useState('welcome');
  const [handle, setHandle] = useState('');
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const goDashboard = () => navigate('/dashboard');

  if (screen === 'welcome') {
    return <WelcomeScreen onStart={() => setScreen('connect')} />;
  }

  if (screen === 'connect') {
    return <ConnectScreen handle={handle} setHandle={setHandle} onAnalyze={() => setScreen('analyze')} />;
  }

  if (screen === 'analyze') {
    return (
      <Shell max={560}>
        <AnalyzeScreen
          username={extractUsername(handle)}
          onDone={(p) => { setProfile(p); setScreen('results'); }}
          onError={(err) => { setError(err); setScreen('results'); }}
        />
      </Shell>
    );
  }

  return (
    <Shell max={720}>
      <ResultsScreen
        profile={profile}
        error={error}
        onDash={goDashboard}
        onRetry={() => { setProfile(null); setError(''); setScreen('connect'); }}
      />
    </Shell>
  );
}
