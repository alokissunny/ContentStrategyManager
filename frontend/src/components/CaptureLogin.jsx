import React, { useEffect, useRef, useState } from 'react';
import Icon from '../brand/Icon';
import { useAuth } from '../context/AuthContext';
import { canTakeCaret } from '../lib/captureUi';

/* what a sign-up agrees to (bauhly-v3 AuthForm `TERMS_VERSION`); recorded on the account */
const TERMS_VERSION = '2026-11';

/**
 * The account step INSIDE the landing page's Capture (bauhly-v3 SignupStep / AuthForm, Nov 6–10), and
 * the landing header's Log in box (`bare`). The conversation stays mounted underneath with the visitor's
 * words and photos where they were, so going back loses nothing.
 *
 *   signup  `Create an account`: name, email, password, the Terms (required) and news from Bauhly
 *           (optional, off by default), as the mock's — the same `/auth/register` the app uses. What was
 *           agreed is kept on the account (`legal`).
 *   signin  the real Log in, `/auth/login`.
 * Sign-up is open now (Nov 10, the user's call); it replaced `Request early access`.
 * There is no Google button: Google sign-in is not set up in this app's frontend.
 */
export default function CaptureLogin({ start = 'signin', forWhat = 'turn this into your first post', backLabel = 'Back to your capture', bare = false, onBack, onDone }) {
  /* `bare`: the landing page's own Log in box: the box's × is the way out, so no back row */
  const { login, register } = useAuth();
  const [mode, setMode] = useState(start); // signin | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
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

  const go = async (e, act) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await act();
      if (done.current) return;
      done.current = true;
      onDone({ created: mode === 'signup' });
    } catch (err) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  const signIn = (e) => go(e, () => login(email, password));
  const signUp = (e) => go(e, () => register(name.trim(), email, password, { acceptTerms: agreed, termsVersion: TERMS_VERSION, marketing }));

  const switchTo = (next) => { setError(''); setMode(next); };

  return (
    <div className={`ck-signup${mode === 'signup' ? ' is-signup' : ''}`} ref={root}>
      {!bare && (
        <div className="ck-signup__top">
          <button type="button" className="btn btn--quiet btn--sm ck-signup__back" onClick={onBack}>
            <Icon name="arrow-left" size={15} />
            {backLabel}
          </button>
        </div>
      )}
      <div className="ck-signup__form">
        {mode === 'signin' && (
          <form className="ckl" onSubmit={signIn}>
            <h2 className="ckl__head">{bare ? 'Welcome back' : `Log in to ${forWhat}.`}</h2>
            {bare && <p className="ckl__sub">Sign in to pick up this week&rsquo;s plan.</p>}
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
              {busy ? 'Please wait…' : bare ? 'Sign in' : 'Log in'}
              <Icon name="arrow-right" size={16} />
            </button>
            <p className="ckl__ask">
              New to Bauhly?{' '}
              <button type="button" className="ckl__link" onClick={() => switchTo('signup')}>Create an account</button>
            </p>
          </form>
        )}
        {mode === 'signup' && (
          <form className="ckl" onSubmit={signUp}>
            <h2 className="ckl__head">Create an account</h2>
            <p className="ckl__sub">Create your account to continue and save your work.</p>
            <label className="ckl__field">
              <span className="ckl__label">Your name</span>
              <input className="ckl__input" type="text" required maxLength={80} autoComplete="name" placeholder="Mara Jansen" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="ckl__field">
              <span className="ckl__label">Email</span>
              <input className="ckl__input" type="email" required autoComplete="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="ckl__field">
              <span className="ckl__label">Password</span>
              <input className="ckl__input" type="password" required minLength={6} autoComplete="new-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label className="ckl__tick">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span className="ckl__box" aria-hidden="true"><Icon name="check" size={12} strokeWidth={2.8} /></span>
              <span>I agree to the <a className="ckl__link" href="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a></span>
            </label>
            <label className="ckl__tick">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
              <span className="ckl__box" aria-hidden="true"><Icon name="check" size={12} strokeWidth={2.8} /></span>
              <span>Email me news from Bauhly (optional)</span>
            </label>
            <p className="ckl__note">Read our <a className="ckl__link" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
            {error && <p className="ckl__error" role="alert">{error}</p>}
            <button type="submit" className="ckl__go" disabled={busy || !agreed}>
              {busy ? 'Please wait…' : 'Create account'}
              <Icon name="arrow-right" size={16} />
            </button>
            <p className="ckl__ask">
              Already have an account?{' '}
              <button type="button" className="ckl__link" onClick={() => switchTo('signin')}>Log in</button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
