import React, { useEffect, useRef, useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import Icon from '../brand/Icon';
import { useAuth } from '../context/AuthContext';
import { canTakeCaret } from '../lib/captureUi';
import { IS_NATIVE } from '../native/platform';
import { checkInviteCode, joinWaitlist } from '../api/earlyAccess';
import JoinedArt from './JoinedArt';
import './captureLogin.css';

/* what a sign-up agrees to (bauhly-v3 AuthForm `TERMS_VERSION`); recorded on the account */
const TERMS_VERSION = '2026-11';
/* the backend's own rule (models/User.js `minlength`) */
const PASSWORD_MIN = 6;

/* Google needs a client id, and its popup does not run inside the iOS app's web view */
const HAS_GOOGLE = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID) && !IS_NATIVE;

/* ══ THE WORDS (bauhly-v3 AuthForm, the Early Access brief, Nov 12–15; decisions 875–906, 992) ══════════════════════
   One set for every place the form appears: the landing's Log in box, `/auth`, and Capture's account step. */
const ACCOUNT_COPY = {
  signup: { head: 'Create your account', sub: 'You’re invited! Create your account to get started with Bauhly.', go: 'Create account', busy: 'Creating your account…', ask: 'Already have an account? ', other: 'Sign in' },
  signin: { head: 'Welcome back', sub: 'Sign in to continue where you left off.', go: 'Sign in', busy: 'Signing in…', ask: 'New to Bauhly? ', other: 'Create an account' },
};
const INVITE_COPY = {
  head: 'Your invitation to Bauhly',
  sub: 'Bauhly is currently available by invitation. Enter your code to get started.',
  go: 'Continue',
};
const INVITE_SAY = {
  empty: 'Enter your invitation code.',
  invalid: 'This code isn’t valid. Check it and try again.',
  redeemed: 'This invitation has already been used.',
  limited: 'Too many tries. Try again in an hour.',
  offline: 'You’re offline. Check your connection and try again.',
  error: 'We couldn’t check your code. Try again.',
};
const RETRY = new Set(['offline', 'error']);
const WAITLIST_COPY = {
  head: 'Join the waitlist',
  sub: 'Leave your email and we’ll let you know when there’s a place for you.',
  go: 'Join the waitlist',
  doneHead: 'You’re on the list!',
  doneSub: 'Thanks for joining Bauhly.',
  doneMore: 'We’ll email you when your early access is ready.',
};
const WAITLIST_SAY = {
  email: 'Enter a valid email address.',
  limited: 'Too many requests today. Try again tomorrow.',
  offline: 'You’re offline. Check your connection and try again.',
  error: 'We couldn’t add you just now. Try again.',
};
/* where a capture is waiting for the account (Capture's step, after `Build post`): say what happens to it
   (bauhly-v3 decision 903, `postWaits`) */
const POST_WAITS_SAY = {
  invite: 'Building your post needs an invitation code. Your capture is kept here until you close Capture.',
  wait: 'Leave your email and we’ll let you know when there’s a place for you. Your capture is kept here until you close Capture.',
};
const RULE_SAY = `At least ${PASSWORD_MIN} characters`;
const RULE_MISSED = `Use at least ${PASSWORD_MIN} characters.`;

/* a checked invitation, held for this tab so the code is never asked for twice (bauhly-v3 lib/invites.js `heldInvite`).
   It is only USED when the account is made: /auth/register claims it atomically (backend withInviteCode). */
const HELD_KEY = 'bauhly.invite';
const heldInvite = () => { try { return sessionStorage.getItem(HELD_KEY) || ''; } catch { return ''; } };
const holdInvite = (code) => { try { if (code) sessionStorage.setItem(HELD_KEY, code); else sessionStorage.removeItem(HELD_KEY); } catch { /* this visit only */ } };

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
function GoogleButton({ disabled, busy, onToken, onFail }) {
  const start = useGoogleLogin({
    flow: 'implicit',
    scope: 'openid email profile',
    onSuccess: (t) => onToken(t.access_token),
    onError: () => onFail('Google sign-in did not finish. Please try again.'),
    onNonOAuthError: (e) => { if (e?.type !== 'popup_closed') onFail('Google sign-in could not open. Please try again.'); },
  });
  return (
    <button type="button" className="btn btn--secondary au__wide" disabled={disabled} aria-busy={busy || undefined} onClick={() => start()}>
      <GoogleG />
      {busy ? ACCOUNT_COPY.signup.busy : 'Continue with Google'}
    </button>
  );
}

/**
 * The account form (bauhly-v3 AuthForm + SignupStep, Nov 12–15): the account step INSIDE the landing
 * page's Capture, the landing header's Log in box (`bare`) and the /auth page (`bare`).
 * The conversation stays mounted underneath with the visitor's words and photos where they were, so
 * going back loses nothing.
 *
 *   invite    a new account starts with a one-use invitation code (backoffice), checked before Create account
 *             is shown (`/early-access/invite/check`); held for the tab once good.
 *   signup    name, email, password (shown/hidden, its rule on screen), Terms (required) and news (optional);
 *             `/auth/register` uses the held code. A code gone bad meanwhile goes back to `invite` saying why;
 *             an address that has an account says so beside the field.
 *   waitlist  no code: an email, kept (`/early-access/waitlist`), then the joined screen.
 *   signin    the real Log in, `/auth/login`. Never asks for a code.
 */
export default function CaptureLogin({ start = 'signin', backLabel = 'Back', bare = false, onBack, onDone }) {
  const { login, register, googleLogin } = useAuth();
  /* asking for sign-up without a checked invitation is asking for the invitation */
  const [mode, setMode] = useState(() => (start === 'signup' && !heldInvite() ? 'invite' : start));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwMissed, setPwMissed] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [waitEmail, setWaitEmail] = useState('');
  const [waitError, setWaitError] = useState(null);
  const [joining, setJoining] = useState(false);
  const [listed, setListed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null); // null | 'email' | 'google'
  const root = useRef(null);
  const moved = useRef(false);
  /* one account is one send: nothing behind this may run twice */
  const done = useRef(false);
  /* Capture's step, after `Build post`: the words say what happens to the capture */
  const postWaits = !bare && start === 'signup';

  const signup = mode === 'signup';
  const signin = mode === 'signin';
  const inviting = mode === 'invite';
  const waiting = mode === 'waitlist';

  /* a step that replaces another takes the keyboard with it: the first field on a pointer, the heading on touch */
  useEffect(() => {
    const el = root.current;
    const field = el?.querySelector('input:not([type="checkbox"])');
    if (field && canTakeCaret()) field.focus({ preventScroll: true });
    else if (moved.current) el?.querySelector('h2')?.focus({ preventScroll: true });
  }, [mode, listed]);

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

  /* every way between the steps; one address, typed once (the waitlist's is the account's and back) */
  const go = (next) => {
    setCodeError(null);
    setWaitError(null);
    setListed(false);
    setPwMissed(false);
    setEmailTaken(false);
    setError('');
    setShowPw(false);
    if ((next === 'signup' || next === 'invite') && !email.trim() && waitEmail.trim()) setEmail(waitEmail.trim());
    if (next === 'waitlist' && !waitEmail.trim() && email.trim()) setWaitEmail(email.trim());
    moved.current = true;
    setMode(next === 'signup' && !heldInvite() ? 'invite' : next);
  };

  const check = () => {
    if (checking) return;
    const raw = code.replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!raw) { setCodeError('empty'); return; }
    setCodeError(null);
    setChecking(true);
    checkInviteCode(raw).then((res) => {
      setChecking(false);
      if (res?.ok) { holdInvite(res.code || raw); go('signup'); return; }
      setCodeError(res?.reason || 'error');
    });
  };

  const join = () => {
    if (joining) return;
    setWaitError(null);
    setJoining(true);
    joinWaitlist(waitEmail.trim(), bare ? 'login' : 'capture').then((res) => {
      setJoining(false);
      if (res?.ok) { moved.current = true; setListed(true); return; }
      setWaitError(res?.reason || 'error');
    });
  };

  /* the account is made, or signed into: only a success leaves */
  const finish = async (method, act) => {
    if (busy) return;
    setError('');
    setEmailTaken(false);
    setBusy(method);
    try {
      const data = await act();
      if (done.current) return;
      done.current = true;
      if (signup) holdInvite('');
      onDone({ created: typeof data?.created === 'boolean' ? data.created : signup });
    } catch (err) {
      setBusy(null);
      const res = err?.response;
      const data = res?.data;
      if (!res) { setError('You’re offline. Check your connection and try again.'); return; }
      if (res.status === 409) { setEmailTaken(true); return; }
      /* the invitation went bad between the two steps (or Google with no account yet): back to it, saying why */
      if (data?.code === 'INVITE_INVALID' || data?.code === 'INVITE_REQUIRED') {
        const was = heldInvite();
        holdInvite('');
        go('invite');
        setCode(was);
        if (data.code === 'INVITE_INVALID') setCodeError('invalid');
        return;
      }
      setError(data?.message || 'Something went wrong. Please try again.');
    }
  };
  const legal = () => ({ acceptTerms: agreed, termsVersion: TERMS_VERSION, marketing, inviteCode: heldInvite() });
  const ruleHolds = () => {
    if (password.length >= PASSWORD_MIN) return true;
    setPwMissed(true);
    root.current?.querySelector('#au-password')?.focus();
    return false;
  };
  const withGoogle = (accessToken) => finish('google', () => googleLogin({ accessToken }, signup ? legal() : {}));

  const proceed = (e) => {
    e?.preventDefault();
    if (inviting) { check(); return; }
    if (waiting) { if (!listed) join(); return; }
    if (signup) {
      if (!agreed || !ruleHolds()) return;
      finish('email', () => register(name.trim(), email, password, legal()));
      return;
    }
    finish('email', () => login(email, password));
  };

  const say = inviting
    ? (postWaits ? { ...INVITE_COPY, sub: POST_WAITS_SAY.invite } : INVITE_COPY)
    : waiting
      ? (listed ? { head: WAITLIST_COPY.doneHead, sub: WAITLIST_COPY.doneSub, more: WAITLIST_COPY.doneMore } : (postWaits ? { ...WAITLIST_COPY, sub: POST_WAITS_SAY.wait } : WAITLIST_COPY))
      : ACCOUNT_COPY[mode];
  const held = signup && !agreed;
  const joined = waiting && listed;

  const passwordField = () => {
    const met = password.length >= PASSWORD_MIN;
    return (
      <div className="field">
        <label className="field__label" htmlFor="au-password">Password</label>
        <div className="au__pw">
          <input
            id="au-password"
            className="input"
            type={showPw ? 'text' : 'password'}
            required
            placeholder="Password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            value={password}
            readOnly={Boolean(busy)}
            onChange={(e) => { setPassword(e.target.value); if (pwMissed && e.target.value.length >= PASSWORD_MIN) setPwMissed(false); }}
            aria-invalid={pwMissed ? 'true' : undefined}
            aria-describedby={[signup && 'au-password-rule', pwMissed && 'au-password-error'].filter(Boolean).join(' ') || undefined}
          />
          <button type="button" className="au__eye" onClick={() => setShowPw((on) => !on)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>
            <Icon name={showPw ? 'eye-off' : 'eye'} size={16} />
          </button>
        </div>
        {signup && (
          <p id="au-password-rule" className="field__hint au__rule">
            {RULE_SAY}
            <span className={`au__rule-mark ${met ? 'is-met' : ''}`} aria-hidden="true"><Icon name="check" size={12} strokeWidth={2.5} /></span>
          </p>
        )}
        {pwMissed && <p id="au-password-error" className="field__error" role="alert">{RULE_MISSED}</p>}
      </div>
    );
  };

  return (
    <div className={`ck-signup${signup ? ' is-signup' : ''}${bare ? ' ck-signup--bare' : ''}`}>
      {!bare && (
        <div className="ck-signup__top">
          <button type="button" className="btn btn--secondary btn--sm ck-signup__back" onClick={onBack}>
            <Icon name="arrow-left" size={15} />
            {backLabel}
          </button>
        </div>
      )}
      <div className="ck-signup__form">
        <form className={`au__form${joined ? ' au__form--done' : ''}`} onSubmit={proceed} ref={root} noValidate={inviting}>
          {joined && <JoinedArt />}
          <h2 className="au__head" tabIndex={-1}>{say.head}</h2>
          {say.sub && <p className={`au__sub${say.more || joined ? ' au__sub--tight' : ''}`}>{say.sub}</p>}
          {say.more && <p className="au__sub au__sub--tight">{say.more}</p>}

          {inviting && (
            <>
              <div className="field">
                <label className="field__label" htmlFor="au-code">Invitation code</label>
                <input
                  id="au-code"
                  className="input au__code"
                  type="text"
                  placeholder="Your code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  maxLength={9}
                  value={code}
                  readOnly={checking}
                  onChange={(e) => { setCode(e.target.value.toUpperCase()); if (codeError) setCodeError(null); }}
                  aria-invalid={codeError && !RETRY.has(codeError) ? 'true' : undefined}
                  aria-describedby={codeError ? 'au-code-error' : undefined}
                />
                {codeError && <p id="au-code-error" className="field__error" role="alert">{INVITE_SAY[codeError] || INVITE_SAY.error}</p>}
              </div>
              <button type="submit" className="btn btn--primary au__wide au__go" aria-busy={checking || undefined}>
                {checking ? 'Checking…' : codeError && RETRY.has(codeError) ? 'Try again' : INVITE_COPY.go}
                {!checking && <Icon name="arrow-right" size={16} />}
              </button>
              <p className="au__alt">
                {postWaits ? 'No code yet? ' : 'Don’t have a code? '}
                <button type="button" className="au__link" onClick={() => go('waitlist')}>Join the waitlist</button>
              </p>
              <p className="au__alt">
                Already have an account?{' '}
                <button type="button" className="au__link" onClick={() => go('signin')}>Sign in</button>
              </p>
            </>
          )}

          {waiting && !listed && (
            <>
              <div className="field">
                <label className="field__label" htmlFor="au-wait-email">Email</label>
                <input
                  id="au-wait-email"
                  className="input"
                  type="email"
                  required
                  placeholder="you@business.com"
                  autoComplete="email"
                  value={waitEmail}
                  readOnly={joining}
                  onChange={(e) => { setWaitEmail(e.target.value); if (waitError) setWaitError(null); }}
                  aria-invalid={waitError === 'email' ? 'true' : undefined}
                  aria-describedby={waitError ? 'au-wait-error' : undefined}
                />
                {waitError && <p id="au-wait-error" className="field__error" role="alert">{WAITLIST_SAY[waitError] || WAITLIST_SAY.error}</p>}
              </div>
              <button type="submit" className="btn btn--primary au__wide au__go" aria-busy={joining || undefined}>
                {joining ? 'Joining…' : waitError && RETRY.has(waitError) ? 'Try again' : WAITLIST_COPY.go}
                {!joining && <Icon name="arrow-right" size={16} />}
              </button>
            </>
          )}
          {waiting && (
            <>
              <p className="au__alt">
                Have an invitation code?{' '}
                <button type="button" className="au__link" onClick={() => go('invite')}>Enter it</button>
              </p>
              <p className="au__alt">
                Already have an account?{' '}
                <button type="button" className="au__link" onClick={() => go('signin')}>Sign in</button>
              </p>
            </>
          )}

          {(signup || signin) && (
            <>
              {HAS_GOOGLE && (
                <>
                  <GoogleButton disabled={Boolean(busy) || held} busy={busy === 'google'} onToken={withGoogle} onFail={setError} />
                  <div className="au__divider">or</div>
                </>
              )}
              <div className="au__fields">
                {signup && (
                  <div className="field">
                    <label className="field__label" htmlFor="au-name">Your name</label>
                    <input id="au-name" className="input" type="text" required maxLength={80} placeholder="Mara Jansen" autoComplete="name" value={name} readOnly={Boolean(busy)} onChange={(e) => setName(e.target.value)} />
                  </div>
                )}
                <div className="field">
                  <label className="field__label" htmlFor="au-email">Email</label>
                  <input
                    id="au-email"
                    className="input"
                    type="email"
                    required
                    placeholder="you@business.com"
                    autoComplete="email"
                    value={email}
                    readOnly={Boolean(busy)}
                    onChange={(e) => { setEmail(e.target.value); if (emailTaken) setEmailTaken(false); }}
                    aria-invalid={emailTaken ? 'true' : undefined}
                    aria-describedby={emailTaken ? 'au-email-error' : undefined}
                  />
                  {emailTaken && (
                    <p id="au-email-error" className="field__error" role="alert">
                      An account with this email already exists.{' '}
                      <button type="button" className="au__link" onClick={() => go('signin')}>Sign in instead</button>
                    </p>
                  )}
                </div>
                {passwordField()}
              </div>

              {signup && (
                <>
                  <label className="au__terms">
                    <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                    <span className="au__box" aria-hidden="true"><Icon name="check" size={13} strokeWidth={2.6} /></span>
                    <span>I agree to the <a className="au__link" href="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a></span>
                  </label>
                  <label className="au__terms">
                    <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
                    <span className="au__box" aria-hidden="true"><Icon name="check" size={13} strokeWidth={2.6} /></span>
                    <span>Email me news from Bauhly (optional)</span>
                  </label>
                  <p className="au__terms-note">Read our <a className="au__link" href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</p>
                </>
              )}

              {error && <p className="field__error au__form-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn--primary au__wide au__go" disabled={held} aria-busy={busy === 'email' || undefined}>
                {busy === 'email' ? say.busy : say.go}
                {busy !== 'email' && <Icon name="arrow-right" size={16} />}
              </button>
              <p className="au__alt">
                {say.ask}
                <button type="button" className="au__link" onClick={() => go(signup ? 'signin' : 'signup')}>{say.other}</button>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
