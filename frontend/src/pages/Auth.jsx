import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import Glyph from '../components/Glyph';
import PanelMotif from '../components/PanelMotif';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useMediaQuery';
import { LS_BG, LS_SURFACE, LS_BORDER, LS_INK, LS_T2, LS_MUTED, LS_SIGNAL, LS_SOFT, LS_FONT, LS_DISPLAY } from '../theme';

function Wordmark() {
  return (
    <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
      <span style={{ fontFamily: LS_DISPLAY, fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', color: LS_INK, lineHeight: 1 }}>
        Bauhly<span style={{ color: LS_SIGNAL }}>.</span>
      </span>
    </Link>
  );
}

function TextInput({ icon, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: 'relative', marginBottom: 14 }}>
      {icon && (
        <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <Glyph name={icon} size={16} color={focused ? LS_SIGNAL : LS_MUTED} />
        </span>
      )}
      <input
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          border: `1px solid ${focused ? LS_SIGNAL : LS_BORDER}`,
          borderRadius: 10,
          padding: icon ? '12px 14px 12px 40px' : '12px 14px',
          fontSize: 15,
          color: LS_INK,
          background: LS_SURFACE,
          outline: 'none',
          boxShadow: focused ? `0 0 0 3px ${LS_SOFT}` : 'none',
        }}
      />
    </div>
  );
}

const ghostBtn = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', height: 46,
  border: `1px solid ${LS_BORDER}`, background: LS_SURFACE, borderRadius: 10,
  fontFamily: LS_FONT, fontSize: 14.5, fontWeight: 600, color: LS_INK,
};

const googleConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

function postLoginPath({ hasInstagramProfile, isSignup = false }) {
  if (isSignup || !hasInstagramProfile) return '/onboarding';
  return '/dashboard';
}

export default function Auth() {
  const [mode, setMode] = useState('login');
  const login = mode === 'login';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const { login: doLogin, register: doRegister, demoLogin: doDemoLogin, googleLogin: doGoogleLogin } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (login) {
        const data = await doLogin(email, password);
        navigate(postLoginPath(data));
      } else {
        await doRegister(name, email, password);
        navigate('/onboarding');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin() {
    setError('');
    setDemoLoading(true);
    try {
      const data = await doDemoLogin();
      navigate(postLoginPath(data));
    } catch (err) {
      setError(err.response?.data?.message || 'Could not start the demo');
    } finally {
      setDemoLoading(false);
    }
  }

  async function handleGoogleSuccess(credentialResponse) {
    setError('');
    setGoogleLoading(true);
    try {
      const data = await doGoogleLogin(credentialResponse.credential);
      navigate(postLoginPath(data));
    } catch (err) {
      setError(err.response?.data?.message || 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  }

  function handleGoogleError() {
    setError('Google sign-in was cancelled or failed');
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: '100vh', background: LS_BG }}>
      {isMobile ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px', borderBottom: `1px solid ${LS_BORDER}` }}>
          <Wordmark />
          <Link to="/" style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_T2, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Glyph name="arrow-left" size={15} color={LS_T2} /> Back
          </Link>
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
          <div style={{ width: '100%', maxWidth: 380 }}>
            <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 28, letterSpacing: '-0.02em', color: LS_INK, margin: '0 0 6px' }}>{login ? 'Welcome back' : 'Create your account'}</h2>
            <p style={{ fontFamily: LS_FONT, fontSize: 15, color: LS_T2, margin: '0 0 28px' }}>{login ? 'Log in to pick up your weekly route.' : 'A few seconds, then we build your first route.'}</p>

            {googleConfigured ? (
              <div style={{ position: 'relative', opacity: googleLoading ? 0.7 : 1, pointerEvents: googleLoading ? 'none' : 'auto' }}>
                <div style={{ ...ghostBtn, cursor: 'default', pointerEvents: 'none' }}>
                  <svg width="17" height="17" viewBox="0 0 18 18">
                    <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6z" />
                    <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z" />
                    <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8z" />
                    <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z" />
                  </svg>
                  {googleLoading ? 'Signing in…' : 'Continue with Google'}
                </div>
                <div style={{ position: 'absolute', inset: 0, opacity: 0, overflow: 'hidden' }}>
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    useOneTap={false}
                    width="380"
                    theme="outline"
                    size="large"
                    text="continue_with"
                  />
                </div>
              </div>
            ) : (
              <button type="button" title="Set VITE_GOOGLE_CLIENT_ID to enable Google sign-in" style={{ ...ghostBtn, cursor: 'not-allowed', opacity: 0.6 }}>
                <svg width="17" height="17" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6z" />
                  <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z" />
                  <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8z" />
                  <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z" />
                </svg>
                Continue with Google
              </button>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0' }}>
              <span style={{ flex: 1, height: 1, background: LS_BORDER }} />
              <span style={{ fontFamily: LS_FONT, fontSize: 12, color: LS_MUTED }}>or</span>
              <span style={{ flex: 1, height: 1, background: LS_BORDER }} />
            </div>

            <form onSubmit={handleSubmit}>
              {!login && <TextInput icon="user" type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />}
              <TextInput icon="mail" type="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <TextInput icon="lock" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
              {login && (
                <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 16 }}>
                  <a href="#" onClick={(e) => e.preventDefault()} style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_SIGNAL, textDecoration: 'none' }}>Forgot password?</a>
                </div>
              )}

              {error && <p style={{ fontFamily: LS_FONT, fontSize: 13, color: '#B91C1C', margin: '0 0 16px' }}>{error}</p>}

              <button
                type="submit"
                disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 48,
                  border: 'none', borderRadius: 10, background: LS_SIGNAL, color: '#fff', cursor: loading ? 'default' : 'pointer',
                  fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  marginTop: login ? 0 : 4, opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Please wait…' : login ? 'Log in' : 'Create account'} <Glyph name="arrow-right" size={16} color="#fff" />
              </button>
            </form>

            <p style={{ fontFamily: LS_FONT, fontSize: 14, color: LS_T2, textAlign: 'center', margin: '22px 0 0' }}>
              {login ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={() => setMode(login ? 'signup' : 'login')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: LS_FONT, fontSize: 14, fontWeight: 600, color: LS_SIGNAL, padding: 0 }}>
                {login ? 'Create one' : 'Log in'}
              </button>
            </p>

            <p style={{ fontFamily: LS_FONT, fontSize: 13.5, color: LS_T2, textAlign: 'center', margin: '14px 0 0' }}>
              Just exploring?{' '}
              <button onClick={handleDemoLogin} disabled={demoLoading} style={{ border: 'none', background: 'none', cursor: demoLoading ? 'default' : 'pointer', fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 600, color: LS_SIGNAL, padding: 0 }}>
                {demoLoading ? 'Loading demo…' : 'Continue as demo user'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
