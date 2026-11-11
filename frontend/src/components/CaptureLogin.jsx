import React, { useEffect, useRef, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import Icon from '../brand/Icon';
import { useAuth } from '../context/AuthContext';
import { canTakeCaret } from '../lib/captureUi';
import { IS_NATIVE } from '../native/platform';

/* what a sign-up agrees to (bauhly-v3 AuthForm `TERMS_VERSION`); recorded on the account */
const TERMS_VERSION = '2026-11';

/* Google needs a client id, and its popup does not run inside the iOS app's web view */
const HAS_GOOGLE = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID) && !IS_NATIVE;

/* bauhly-v3 AuthForm's words. `page`: the /auth page and the landing's Log in box (`bare`);
   `step`: the account step inside Capture (SignupStep's COPY, Nov 6–9). */
const COPY = {
  page: {
    signup: { head: 'Start your analysis', sub: 'Create an account \u2014 building your first week takes a few minutes.', go: 'Create account', ask: 'Already have an account? ', other: 'Sign in' },
    signin: { head: 'Welcome back', sub: 'Sign in to pick up this week\u2019s plan.', go: 'Sign in', ask: 'New to Bauhly? ', other: 'Start your analysis' },
  },
  step: {
    signup: { head: 'Create an account', sub: 'Create your account to continue and save your work.', go: 'Create account', ask: 'Already have an account? ', other: 'Log in' },
    signin: { head: 'Log in to Bauhly', sub: 'Log in to continue and save your work.', go: 'Log in', ask: 'New to Bauhly? ', other: 'Create an account' },
  },
};

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.8H9v3.5h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.6z" />
      <path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H.9v2.3A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.9 10.7a5.4 5.4 0 0 1 0-3.4V5H.9a9 9 0 0 0 0 8z" />
      <path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.6-2.6A9 9 0 0 0 .9 5l3 2.3C4.6 5.2 6.6 3.6 9 3.6z" />
    </svg>
  );
}

/* its own component so the Google hook only mounts where a client id exists */
function GoogleButton({ disabled, onToken, onFail }) {
  const start = useGoogleLogin({
    flow: 'implicit',
    scope: 'openid email profile',
    onSuccess: (t) => onToken(t.access_token),
    onError: () => onFail('Google sign-in did not finish. Please try again.'),
    onNonOAuthError: (e) => { if (e?.type !== 'popup_closed') onFail('Google sign-in could not open. Please try again.'); },
  });
  return (
    <button type="button" className="ckl__google" disabled={disabled} onClick={() => start()}>
      <GoogleG />
      Continue with Google
    </button>
  );
}

/**
 * The account form (bauhly-v3 AuthForm / SignupStep, Nov 6–10): the account step INSIDE the landing
 * page's Capture, the landing header's Log in box (`bare`) and the /auth page (`bare`).
 * The conversation stays mounted underneath with the visitor's words and photos where they were, so
 * going back loses nothing.
 *
 *   signup  a one-use invitation code (4 letters/digits, made in the backoffice), name, email, password, the Terms (required) and news from Bauhly (optional, off by
 *           default), as the mock's — `/auth/register`. What was agreed is kept on the account (`legal`).
 *   signin  the real Log in, `/auth/login`.
 *   Google  "Continue with Google" in both (`/auth/google`, access-token flow); in sign-up it waits for
 *           the Terms like the mock's, and a new Google account keeps what was agreed too.
 */
export default function CaptureLogin({ start = 'signin', backLabel = 'Back to your capture', bare = false, onBack, onDone }) {
  /* `bare`: the landing page's own Log in box: the box's × is the way out, so no back row */
  const { login, register, googleLogin } = useAuth();
  const [mode, setMode] = useState(start); // signin | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [invite, setInvite] = useState('');
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
    e?.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const data = await act();
      if (done.current) return;
      done.current = true;
      onDone({ created: typeof data?.created === 'boolean' ? data.created : mode === 'signup' });
    } catch (err) {
      const data = err?.response?.data;
      /* Google on Log in with no account yet: making one needs an invitation code, so go to Create account */
      if (data?.code === 'INVITE_REQUIRED' && mode === 'signin') setMode('signup');
      setError(data?.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };
  const legal = () => ({ acceptTerms: agreed, termsVersion: TERMS_VERSION, marketing, inviteCode });
  const signIn = (e) => go(e, () => login(email, password));
  const signUp = (e) => go(e, () => register(name.trim(), email, password, legal()));

  const withGoogle = (accessToken) => go(null, () => googleLogin({ accessToken }, mode === 'signup' ? legal() : {}));
  const switchTo = (next) => { setError(''); setMode(next); };
  const say = COPY[bare ? 'page' : 'step'][mode];
  /* every new account needs a one-use invitation code: 4 letters/digits */
  const inviteCode = invite.replace(/[^a-z0-9]/gi, '').toUpperCase();
  const held = mode === 'signup' && (!agreed || inviteCode.length !== 4);

  const google = HAS_GOOGLE && (
    <>
      <GoogleButton disabled={busy || held} onToken={withGoogle} onFail={setError} />
      <div className="ckl__divider">or</div>
    </>
  );

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
            <h2 className="ckl__head">{say.head}</h2>
            <p className="ckl__sub">{say.sub}</p>
            {google}
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
              {busy ? 'Please wait…' : say.go}
              <Icon name="arrow-right" size={16} />
            </button>
            <p className="ckl__ask">
              {say.ask}
              <button type="button" className="ckl__link" onClick={() => switchTo('signup')}>{say.other}</button>
            </p>
          </form>
        )}
        {mode === 'signup' && (
          <form className="ckl" onSubmit={signUp}>
            <h2 className="ckl__head">{say.head}</h2>
            <p className="ckl__sub">{say.sub}</p>
            <label className="ckl__field ckl__field--invite">
              <span className="ckl__label">Invitation code</span>
              <input
                className="ckl__input ckl__input--code"
                type="text"
                required
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={4}
                pattern="[A-Za-z0-9]{4}"
                title="4 letters or digits"
                placeholder="e.g. K7PM"
                value={invite}
                onChange={(e) => setInvite(e.target.value.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 4))}
              />
            </label>
            {google}
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
            <button type="submit" className="ckl__go" disabled={busy || held}>
              {busy ? 'Please wait…' : say.go}
              <Icon name="arrow-right" size={16} />
            </button>
            <p className="ckl__ask">
              {say.ask}
              <button type="button" className="ckl__link" onClick={() => switchTo('signin')}>{say.other}</button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
