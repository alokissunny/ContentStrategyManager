/*
 * ── THE BAR'S `START CAPTURING` OPENS THE HERO'S CAPTURE (bauhly-v3, Nov 7; decision 686) ──────────
 * The same press as the hero field's and its pill's (`HeroCapture`'s `raise`), so Capture grows out of
 * the same place whichever was pressed. Its own file so the component files export only components.
 */
export const START_EVENT = 'bauhly:start-capturing';
export const LOGIN_EVENT = 'bauhly:log-in';

/* false when there is no hero field on the page to open it from */
export function startCapturing() {
  if (!document.querySelector('.hcap')) return false;
  window.dispatchEvent(new Event(START_EVENT));
  return true;
}

/* ── AND `LOG IN` OPENS A BOX ON THE PAGE (bauhly-v3, Nov 8–9 — decisions 706, 740) ──────────────────
 * "show the Sign In modal with a smooth, subtle fade-in… Keep the modal at its final size and position
 * throughout". The live app is invite-only, so the box is the real Log in with Request early access
 * (`CaptureLogin`), mounted by `LandingLogin`. Returns false where there is no landing page to show it
 * on, and the caller goes to `/auth`. */
export function openLogin() {
  if (!document.querySelector('.bauhly-landing')) return false;
  window.dispatchEvent(new Event(LOGIN_EVENT));
  return true;
}
