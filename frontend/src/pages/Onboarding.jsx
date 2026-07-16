import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Glyph from '../components/Glyph';
import { useAuth } from '../context/AuthContext';
import SignalTerrain from '../components/SignalTerrain';
import RadarPulse from '../components/RadarPulse';
import StepList from '../components/StepList';
import { fetchInstagram, confirmReport as confirmReportApi, getAuthorityFunnel } from '../api/instagram';
import AuthorityFunnel from '../components/AuthorityFunnel';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT, LS_DISPLAY,
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

function Shell({ children, max = 620, align = 'center' }) {
  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', padding: 'clamp(20px, 5vw, 40px) clamp(16px, 5vw, 48px) 64px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Link to="/dashboard" style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Skip for now <Glyph name="arrow-right" size={15} color={LS_T2} />
        </Link>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: align, justifyContent: 'center' }}>
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
          <Eyebrow>Content strategy for design studios</Eyebrow>
          <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 'clamp(30px,3.6vw,46px)', lineHeight: 1.04, letterSpacing: '-0.025em', color: LS_INK, margin: 0 }}>
            See the strategy behind your studio&rsquo;s feed.
          </h1>
          <p style={{ fontFamily: LS_FONT, fontSize: 16.5, lineHeight: 1.6, color: LS_T2, margin: '20px 0 32px', maxWidth: 380 }}>
            Bauhly reads your studio&rsquo;s Instagram and shows you what deserves attention next.
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

// The three quick-summary fields, asked one at a time as a conversation.
const QUESTIONS = [
  {
    key: 'whoYouHelp',
    ask: 'First up — who do you help?',
    placeholder: 'e.g. Independent architecture and interior studios who want more of the right client enquiries.',
  },
  {
    key: 'whatYouOffer',
    ask: 'Got it. And what do you actually offer them?',
    placeholder: 'e.g. Full-service branding and spatial design, from concept through to built environments.',
  },
  {
    key: 'howYouSound',
    ask: 'Last one — how do you want to come across?',
    placeholder: 'e.g. Considered and warm, confident without the jargon.',
  },
];

function AssistantRow({ children }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: LS_SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name="sparkles" size={15} color={LS_SIGNAL} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function BotBubble({ children }) {
  return (
    <div style={{
      display: 'inline-block', maxWidth: '100%', background: LS_SURFACE, color: LS_INK,
      border: `1px solid ${LS_BORDER}`, borderRadius: 16, borderTopLeftRadius: 5,
      padding: '11px 15px', fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.5,
    }}>{children}</div>
  );
}

function UserBubble({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
      <div style={{
        maxWidth: '82%', background: LS_SIGNAL, color: '#fff', borderRadius: 16, borderTopRightRadius: 5,
        padding: '11px 15px', fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.5,
      }}>{children}</div>
    </div>
  );
}

function TypingDots() {
  return (
    <BotBubble>
      <span style={{ display: 'inline-flex', gap: 4, padding: '2px 0' }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: LS_MUTED, animation: 'lsSpark 1.2s ease-in-out infinite', animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
    </BotBubble>
  );
}

function SuggestionCard({ text, onUse }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onUse}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer', background: LS_SURFACE,
        border: `1.5px solid ${hover ? LS_SIGNAL : LS_BORDER}`, borderRadius: 14, padding: '13px 15px',
        boxShadow: hover ? `0 0 0 3px ${LS_SOFT}` : 'none', transition: 'border-color 120ms, box-shadow 120ms',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <Glyph name="sparkles" size={13} color={LS_SIGNAL} />
        <span style={{ fontFamily: LS_FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: LS_SIGNAL }}>Suggested from your posts</span>
      </span>
      <span style={{ display: 'block', fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.5, color: LS_INK }}>{text}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_SIGNAL }}>
        Use this answer <Glyph name="arrow-right" size={14} color={LS_SIGNAL} />
      </span>
    </button>
  );
}

function WriteBox({ placeholder, value, onChange, onSend, onCancel }) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <textarea
        autoFocus
        rows={3}
        value={value}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && value.trim()) onSend(); }}
        style={{
          width: '100%', resize: 'vertical', fontFamily: LS_FONT, fontSize: 15, lineHeight: 1.5, color: LS_INK,
          background: LS_SURFACE, border: `1.5px solid ${focused ? LS_SIGNAL : LS_BORDER}`, borderRadius: 12,
          padding: '11px 13px', outline: 'none', boxShadow: focused ? `0 0 0 3px ${LS_SOFT}` : 'none',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <PrimaryBtn onClick={() => value.trim() && onSend()} disabled={!value.trim()}>
          Send <Glyph name="arrow-right" size={16} color="#fff" />
        </PrimaryBtn>
        <button type="button" onClick={onCancel} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Glyph name="corner-up-left" size={14} color={LS_T2} /> Back to suggestion
        </button>
      </div>
    </div>
  );
}

function GhostBtn({ onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 40, padding: '0 16px', borderRadius: 10,
        border: `1px solid ${hover ? LS_SIGNAL : LS_BORDER}`, background: LS_SURFACE, cursor: 'pointer',
        fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: hover ? LS_SIGNAL : LS_INK,
      }}
    >{children}</button>
  );
}

function ConversationScreen({ initial, onConfirm, saving }) {
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState('choose'); // 'choose' | 'writing'
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);
  const bottomRef = React.useRef(null);

  const done = step >= QUESTIONS.length;

  // Brief "typing" pause each time a new question (or the closing line) appears.
  useEffect(() => {
    setReady(false);
    const t = setTimeout(() => setReady(true), 650);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [step, mode, ready]);

  function commit(key, value) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setDraft('');
    setMode('choose');
    setStep((s) => s + 1);
  }

  const current = done ? null : QUESTIONS[step];
  const suggestion = current ? initial[current.key] : '';

  return (
    <Shell max={660} align="flex-start">
      <div style={{ marginBottom: 22 }}>
        <Eyebrow>Here&rsquo;s what we understand</Eyebrow>
        <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 26, letterSpacing: '-0.02em', color: LS_INK, margin: 0 }}>
          Let&rsquo;s confirm a few things.
        </h2>
        <p style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.6, color: LS_T2, margin: '8px 0 0' }}>
          I read your posts and drafted an answer for each. Tap to use mine, or write your own.
        </p>
      </div>

      {/* Answered questions */}
      {QUESTIONS.slice(0, step).map((q) => (
        <React.Fragment key={q.key}>
          <AssistantRow><BotBubble>{q.ask}</BotBubble></AssistantRow>
          <UserBubble>{answers[q.key]}</UserBubble>
        </React.Fragment>
      ))}

      {/* Current question */}
      {current && (
        <AssistantRow>
          <BotBubble>{current.ask}</BotBubble>
          {ready && (
            <div style={{ marginTop: 12 }}>
              {mode === 'choose' ? (
                <>
                  <SuggestionCard text={suggestion} onUse={() => commit(current.key, suggestion)} />
                  <div style={{ marginTop: 10 }}>
                    <GhostBtn onClick={() => setMode('writing')}>
                      <Glyph name="pencil" size={14} color="currentColor" /> Write my own answer
                    </GhostBtn>
                  </div>
                </>
              ) : (
                <WriteBox
                  placeholder={current.placeholder}
                  value={draft}
                  onChange={setDraft}
                  onSend={() => commit(current.key, draft.trim())}
                  onCancel={() => { setMode('choose'); setDraft(''); }}
                />
              )}
            </div>
          )}
          {!ready && <div style={{ marginTop: 12 }}><TypingDots /></div>}
        </AssistantRow>
      )}

      {/* Closing */}
      {done && (
        ready ? (
          <AssistantRow>
            <BotBubble>Perfect — that&rsquo;s everything I need. I&rsquo;ll use this to shape your first weekly route.</BotBubble>
            <div style={{ marginTop: 14 }}>
              <PrimaryBtn onClick={() => onConfirm(answers)} disabled={saving}>
                {saving ? 'Saving…' : 'Open my dashboard'} <Glyph name="arrow-right" size={16} color="#fff" />
              </PrimaryBtn>
            </div>
          </AssistantRow>
        ) : (
          <AssistantRow><TypingDots /></AssistantRow>
        )
      )}

      <div ref={bottomRef} />
    </Shell>
  );
}

export default function Onboarding() {
  const [searchParams] = useSearchParams();
  // Re-entry into onboarding to connect a different handle. Admins use `?add=1`
  // to connect an *additional* handle; any user can use `?change=1` to replace
  // their current handle. Both skip the first-run welcome screen and the
  // "already onboarded" redirect, and run the full analysis on the new account.
  const reentryMode = searchParams.get('add') === '1' || searchParams.get('change') === '1';
  const [screen, setScreen] = useState(reentryMode ? 'connect' : 'welcome');
  const [handle, setHandle] = useState('');
  const [report, setReport] = useState(null);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [funnelData, setFunnelData] = useState(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!reentryMode && user?.hasInstagramProfile) {
      navigate('/dashboard', { replace: true });
    }
  }, [reentryMode, user, navigate]);

  // Every onboarding completion — first run or an add/change re-entry — lands on
  // the dashboard.
  const goDashboard = () => navigate('/dashboard');

  // Save the confirmed summary (best-effort), then show the authority funnel
  // built from the Instagram analysis before landing on the dashboard.
  async function handleConfirm(lines, initialSummary) {
    const changed = report && Object.keys(lines).some((key) => lines[key] !== initialSummary[key]);
    setConfirmSaving(true);
    try {
      if (changed) {
        try {
          await confirmReportApi(report.id, lines);
        } catch (err) {
          // Best-effort: still continue even if the save failed.
        }
      }
      const data = await getAuthorityFunnel();
      if (data?.funnel?.length) {
        setFunnelData(data);
        setScreen('funnel');
        return;
      }
      goDashboard();
    } catch (err) {
      // No analysis to show (e.g. profile missing) — go straight through.
      goDashboard();
    } finally {
      setConfirmSaving(false);
    }
  }

  if (screen === 'funnel' && funnelData) {
    return <AuthorityFunnel data={funnelData} onStart={goDashboard} />;
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
    <ConversationScreen initial={initialSummary} saving={confirmSaving} onConfirm={(lines) => handleConfirm(lines, initialSummary)} />
  );
}
