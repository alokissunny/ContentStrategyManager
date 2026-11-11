import React from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Glyph from '../components/Glyph';
import PanelMotif from '../components/PanelMotif';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import CaptureLogin from '../components/CaptureLogin';
import './checkin/checkin.css';
import { IS_NATIVE } from '../native/platform';

const SHOW_DEMO_LOGIN = import.meta.env.VITE_DEMO_LOGIN === '1';
import { LS_BG, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_FONT, LS_DISPLAY } from '../theme';

function Wordmark() {
  return (
    <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
      <span style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: LS_INK, lineHeight: 1 }}>
        Bauhly<span style={{ color: LS_SIGNAL }}>.</span>
      </span>
    </Link>
  );
}

/* `/auth` (Log in) and `/signup` (Create account — bauhly-v3's "Start your analysis"), one form: the
   landing's Log in box and Capture's account step use the same CaptureLogin. */
export default function Auth({ start }) {
  const { user, loading: authLoading, demoLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const mode = start
    || (location.state?.mode === 'signup' || new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin');

  if (authLoading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100vh', background: LS_BG }}>
      {isMobile ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px', paddingTop: 'calc(20px + env(safe-area-inset-top))', borderBottom: `1px solid ${LS_BORDER}` }}>
          <Wordmark />
          {/* The app has no marketing site to go back to. */}
          {!IS_NATIVE && <Link to="/" style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Glyph name="arrow-left" size={15} color={LS_T2} /> Back
          </Link>}
        </div>
      ) : (
        <div style={{ width: 440, flexShrink: 0, background: 'linear-gradient(165deg, #FFFFFF 0%, #F6F4EF 100%)', borderRight: `1px solid ${LS_BORDER}`, padding: '38px 44px', display: 'flex', flexDirection: 'column' }}>
          <Wordmark />
          <div style={{ marginTop: 'auto' }}>
            <PanelMotif />
            <p style={{ fontFamily: LS_FONT, fontWeight: 700, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: LS_SIGNAL, margin: '28px 0 14px' }}>Content strategy for design studios</p>
            <h1 style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 29, lineHeight: 1.14, letterSpacing: '-0.02em', color: LS_INK, margin: 0 }}>Your studio&rsquo;s Instagram, planned every Monday.</h1>
            <p style={{ fontFamily: LS_FONT, fontSize: 14.5, lineHeight: 1.6, color: LS_T2, margin: '16px 0 0', maxWidth: 320 }}>Log in to pick up this week&rsquo;s strategic route &mdash; captions, timing, and the reason behind each post.</p>
          </div>
          <div style={{ marginTop: 34, fontFamily: LS_FONT, fontSize: 12.5, color: LS_MUTED }}>We only read public signals. Nothing is posted on your behalf.</div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!isMobile && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '24px 40px' }}>
            <Link to="/" style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Glyph name="arrow-left" size={15} color={LS_T2} /> Back to site
            </Link>
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '32px 20px 40px' : '0 40px 60px' }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div className="ckl-page">
              <CaptureLogin key={mode} bare start={mode} onBack={() => {}} onDone={() => navigate('/dashboard')} />
            </div>

            {/* Local test builds only (VITE_DEMO_LOGIN=1) — never set in .env / .env.mobile. */}
            {SHOW_DEMO_LOGIN && (
              <button
                type="button"
                onClick={() => demoLogin().then(() => navigate('/dashboard')).catch(() => {})}
                style={{ display: 'block', width: '100%', marginTop: 12, padding: 12, border: 0, background: 'none', color: LS_T2, fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                Continue as demo user
              </button>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
