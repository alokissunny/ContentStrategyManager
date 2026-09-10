import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
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

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { user, loading: authLoading, login: doLogin } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  if (authLoading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await doLogin(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
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
            <h2 style={{ fontFamily: LS_FONT, fontWeight: 600, fontSize: 28, letterSpacing: '-0.02em', color: LS_INK, margin: '0 0 6px' }}>Welcome back</h2>
            <p style={{ fontFamily: LS_FONT, fontSize: 15, color: LS_T2, margin: '0 0 28px' }}>Log in to pick up your weekly route.</p>

            <form onSubmit={handleSubmit}>
              <TextInput icon="mail" type="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              <TextInput icon="lock" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required minLength={6} />
              <div style={{ textAlign: 'right', marginTop: -4, marginBottom: 16 }}>
                <a href="#" onClick={(e) => e.preventDefault()} style={{ fontFamily: LS_FONT, fontSize: 13, fontWeight: 600, color: LS_SIGNAL, textDecoration: 'none' }}>Forgot password?</a>
              </div>

              {error && <p style={{ fontFamily: LS_FONT, fontSize: 13, color: '#B91C1C', margin: '0 0 16px' }}>{error}</p>}

              <button
                type="submit"
                disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', height: 48,
                  border: 'none', borderRadius: 10, background: LS_SIGNAL, color: '#fff', cursor: loading ? 'default' : 'pointer',
                  fontFamily: LS_FONT, fontSize: 13.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Please wait…' : 'Log in'} <Glyph name="arrow-right" size={16} color="#fff" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
