import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { useAuth } from '../context/AuthContext';
import SignalTerrain from '../components/SignalTerrain';
import RadarPulse from '../components/RadarPulse';
import StepList from '../components/StepList';
import { fetchInstagram, confirmReport as confirmReportApi } from '../api/instagram';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT,
} from '../theme';

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
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', padding: 'clamp(20px, 5vw, 40px) clamp(16px, 5vw, 48px) 64px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Link to="/dashboard" style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Skip for now <Glyph name="arrow-right" size={15} color={LS_T2} />
        </Link>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
  const isMobile = useIsMobile();
  return (
    <Shell max={1040}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '0.82fr 1.18fr', gap: isMobile ? 12 : 36, alignItems: 'center' }}>
        <div>
          <Eyebrow>Strategic signal intelligence</Eyebrow>
          <h1 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 'clamp(30px,3.6vw,46px)', lineHeight: 1.06, letterSpacing: '-0.025em', color: LS_INK, margin: 0 }}>
            See what&rsquo;s really happening in your content.
          </h1>
          <p style={{ fontFamily: LS_FONT, fontSize: 16.5, lineHeight: 1.6, color: LS_T2, margin: '20px 0 32px', maxWidth: 380 }}>
            WideSignals reads your Instagram and shows you what deserves attention next.
          </p>
          <PrimaryBtn onClick={onStart}>Analyze my Instagram <Glyph name="arrow-right" size={16} color="#fff" /></PrimaryBtn>
        </div>
        {!isMobile && <div style={{ minHeight: 380, margin: '0 -60px 0 0' }}><SignalTerrain /></div>}
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
      .then(({ report }) => {
        clearInterval(iv);
        if (cancelled) return;
        setStep(SCRAPE_STEPS.length);
        setTimeout(() => { if (!cancelled) onDone(report); }, 500);
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
          <button onClick={onError} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 14, fontWeight: 500, color: LS_T2 }}>Skip to dashboard →</button>
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

const FALLBACK_SUMMARY = {
  whoYouHelp: "You help a specific audience we'll sharpen as you post.",
  whatYouOffer: 'You offer a core product or service.',
  howYouSound: 'You want to sound clear, consistent, and recognizable.',
};

function HypoLine({ label, value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ padding: '16px 0', borderBottom: `1px solid ${LS_BORDER}` }}>
      <div style={{ fontFamily: LS_FONT, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: LS_MUTED, marginBottom: 6 }}>{label}</div>
      <div style={{ position: 'relative' }}>
        <textarea
          value={value}
          rows={2}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', resize: 'none', fontFamily: LS_FONT, fontSize: 17, lineHeight: 1.45, color: LS_INK,
            background: focused ? LS_SURFACE : 'transparent', border: `1px solid ${focused ? LS_SIGNAL : 'transparent'}`,
            borderRadius: 9, padding: '7px 34px 7px 9px', margin: '0 -9px', outline: 'none',
            boxShadow: focused ? `0 0 0 3px ${LS_SOFT}` : 'none',
          }}
        />
        {!focused && <Glyph name="pencil" size={14} color={LS_MUTED} style={{ position: 'absolute', right: 2, top: 10, pointerEvents: 'none' }} />}
      </div>
    </div>
  );
}

function ConfirmScreen({ initial, onConfirm, saving }) {
  const [lines, setLines] = useState(initial);
  const set = (key, val) => setLines((p) => ({ ...p, [key]: val }));

  return (
    <div>
      <Eyebrow>Here&rsquo;s what we understand</Eyebrow>
      <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 28, letterSpacing: '-0.02em', color: LS_INK, margin: '0 0 8px' }}>Our first hypothesis about you.</h2>
      <p style={{ fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.6, color: LS_T2, margin: '0 0 22px' }}>
        This is our best read from what you shared. Edit anything that&rsquo;s off &mdash; it shapes your first route.
      </p>
      <div style={{ background: LS_SURFACE, border: `1px solid ${LS_BORDER}`, borderRadius: 16, padding: '8px clamp(16px, 5vw, 30px) 24px' }}>
        <HypoLine label="Who you help" value={lines.whoYouHelp} onChange={(v) => set('whoYouHelp', v)} />
        <HypoLine label="What you offer" value={lines.whatYouOffer} onChange={(v) => set('whatYouOffer', v)} />
        <HypoLine label="How you sound" value={lines.howYouSound} onChange={(v) => set('howYouSound', v)} />
        <p style={{ fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED, margin: '14px 0 0', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Glyph name="sparkles" size={13} color={LS_MUTED} /> WideSignals refines this every week as it reads your real signals.
        </p>
      </div>
      <div style={{ marginTop: 26 }}>
        <PrimaryBtn onClick={() => onConfirm(lines)} disabled={saving}>
          {saving ? 'Saving…' : 'Looks right — open my dashboard'} <Glyph name="arrow-right" size={16} color="#fff" />
        </PrimaryBtn>
      </div>
    </div>
  );
}

export default function Onboarding() {
  const [screen, setScreen] = useState('welcome');
  const [handle, setHandle] = useState('');
  const [report, setReport] = useState(null);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.hasInstagramProfile) {
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate]);

  const goDashboard = () => navigate('/dashboard');

  async function handleConfirm(lines, initialSummary) {
    const changed = report && Object.keys(lines).some((key) => lines[key] !== initialSummary[key]);
    if (!changed) {
      goDashboard();
      return;
    }
    setConfirmSaving(true);
    try {
      await confirmReportApi(report.id, lines);
    } catch (err) {
      // Best-effort: still let the user continue even if the save failed.
    } finally {
      setConfirmSaving(false);
      goDashboard();
    }
  }

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
          onDone={(r) => { setReport(r); setScreen('confirm'); }}
          onError={goDashboard}
        />
      </Shell>
    );
  }

  const initialSummary = {
    whoYouHelp: report?.whoYouHelp || FALLBACK_SUMMARY.whoYouHelp,
    whatYouOffer: report?.whatYouOffer || FALLBACK_SUMMARY.whatYouOffer,
    howYouSound: report?.howYouSound || FALLBACK_SUMMARY.howYouSound,
  };

  return (
    <Shell max={620}>
      <ConfirmScreen initial={initialSummary} saving={confirmSaving} onConfirm={(lines) => handleConfirm(lines, initialSummary)} />
    </Shell>
  );
}
