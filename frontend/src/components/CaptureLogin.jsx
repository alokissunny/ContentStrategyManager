import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { useAuth } from '../context/AuthContext';
import { requestEarlyAccess } from '../api/earlyAccess';
import { canTakeCaret } from '../lib/captureUi';

/**
 * The account step INSIDE the landing page's Capture (bauhly-v3 SignupStep,
 * Nov 6: "display the existing sign-up component within the Capture modal as a
 * temporary step"). The conversation stays mounted underneath with the
 * visitor's words and photos where they were, so going back loses nothing.
 *
 * Bauhly is invite-only for now, so this is the real Log in — the same
 * `/auth/login` the /auth page uses — and a visitor without an account can
 * request early access from here instead of an account being made for them.
 */
export default function CaptureLogin({ forWhat = 'turn this into your first post', onBack, onDone }) {
  const { login } = useAuth();
  const [mode, setMode] = useState('signin'); // signin | early | requested
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [already, setAlready] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef(null);
  /* one account is one send: nothing behind this may run twice */
  const done = useRef(false);

  useEffect(() => {
    if (canTakeCaret()) root.current?.querySelector('input')?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    /* before Capture's own Escape, which would close the conversation behind this */
    const keys = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      onBack();
    };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      if (done.current) return;
      done.current = true;
      onDone();
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  const askAccess = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = await requestEarlyAccess({ name, instagramHandle: handle });
      setAlready(Boolean(result?.alreadyRequested));
      setMode('requested');
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (next) => { setError(''); setMode(next); };

  return (
    <div className="ck-signup" ref={root}>
      <div className="ck-signup__top">
        <button type="button" className="btn btn--quiet btn--sm ck-signup__back" onClick={onBack}>
          <Icon name="arrow-left" size={15} />
          Back to your capture
        </button>
      </div>
      <div className="ck-signup__form">
        {mode === 'signin' && (
          <form className="ckl" onSubmit={signIn}>
            <h2 className="ckl__head">Log in to {forWhat}.</h2>
            <label className="ckl__field">
              <span className="ckl__label">Email</span>
              <input className="ckl__input" type="email" required autoComplete="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="ckl__field">
              <span className="ckl__label">Password</span>
              <input className="ckl__input" type="password" required minLength={6} autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="ckl__error" role="alert">{error}</p>}
            <button type="submit" className="ckl__go" disabled={busy}>
              {busy ? 'Please wait…' : 'Log in'}
              <Icon name="arrow-right" size={16} />
            </button>
            <p className="ckl__ask">
              New to Bauhly?{' '}
              <button type="button" className="ckl__link" onClick={() => switchTo('early')}>Request early access</button>
            </p>
          </form>
        )}
        {mode === 'early' && (
          <form className="ckl" onSubmit={askAccess}>
            <h2 className="ckl__head">Request early access.</h2>
            <p className="ckl__sub">Bauhly is invite-only for now. Tell us your name and Instagram handle and we&rsquo;ll be in touch.</p>
            <label className="ckl__field">
              <span className="ckl__label">Your name</span>
              <input className="ckl__input" type="text" required maxLength={80} autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ckl__field">
              <span className="ckl__label">Instagram handle</span>
              <input className="ckl__input" type="text" required maxLength={32} autoComplete="username" placeholder="@yourstudio" value={handle} onChange={(e) => setHandle(e.target.value)} />
            </label>
            {error && <p className="ckl__error" role="alert">{error}</p>}
            <button type="submit" className="ckl__go" disabled={busy}>
              {busy ? 'Sending…' : 'Send request'}
              <Icon name="arrow-right" size={16} />
            </button>
            <p className="ckl__ask">
              Already have an account?{' '}
              <button type="button" className="ckl__link" onClick={() => switchTo('signin')}>Log in</button>
            </p>
          </form>
        )}
        {mode === 'requested' && (
          <div className="ckl" role="status">
            <h2 className="ckl__head">{already ? 'You are already on the list.' : 'Request received.'}</h2>
            <p className="ckl__sub">We&rsquo;ll be in touch. Your capture can&rsquo;t be saved until you have an account, so keep the words somewhere for now.</p>
            <button type="button" className="ckl__go" onClick={onBack}>Back to your capture</button>
          </div>
        )}
      </div>
    </div>
  );
}
