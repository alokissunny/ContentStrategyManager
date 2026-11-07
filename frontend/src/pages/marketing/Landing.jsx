/*
 * Landing — Bauhly marketing page.
 *
 * Ported from the standalone Bauhly landing build (design-system-creator/
 * stay-the-designer). All of its styling is scoped under the top-level
 * `.bauhly-landing` wrapper (see ./bauhly/styles/*.css) so it can never leak
 * into /auth, /onboarding, or /app — those keep the app's original design
 * system in src/styles/*.css untouched.
 */

import { useEffect, useRef } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import Lenis from 'lenis';
import { useCaptureOpen } from '../../lib/captureUi';
import CaptureHost from '../../components/CaptureHost';
import S1Hero from './bauhly/scenes/S1Hero.jsx';
import S1bProblem from './bauhly/scenes/S1bProblem.jsx';
import S2SecondJob from './bauhly/scenes/S2SecondJob.jsx';
import S3Reframe from './bauhly/scenes/S3Reframe.jsx';
import S5Journey from './bauhly/scenes/S5Journey.jsx';
import S8Faq from './bauhly/scenes/S8Faq.jsx';
import S6Invitation from './bauhly/scenes/S6Invitation.jsx';
import Footer from './bauhly/components/Footer.jsx';
import HeroCapture from './bauhly/components/HeroCapture.jsx';
import './bauhly/styles/tokens.css';
import './bauhly/styles/base.css';
import './bauhly/styles/scenes.css';

export default function Landing() {
  /* The landing page does not touch the store (Leon, July 31 — audit finding 5).
   *
   * It used to call `resetState()` on mount, so a signed-in studio that clicked
   * the wordmark lost its plans, its projects and its brand profile — the two
   * environments punished moving between them, which is the exact seam the
   * design system exists to heal. Resetting belongs to the one place that asks
   * for it: choosing a demo persona in /onboarding. */

  /* Asked for less motion, given less motion (Leon, July 31 — audit finding 4).
   * The CSS block in base.css stills the transitions; this carries the same
   * preference into the scene entrances, which are JS, and leaves smooth
   * scrolling off — hijacked scrolling is itself motion nobody asked for. */
  const still = useReducedMotion();
  const smooth = useRef(null);
  useEffect(() => {
    if (still) return undefined;
    const lenis = new Lenis({ autoRaf: true });
    /* what is drawn from the scroll position hears it in the frame the page moves */
    lenis.on('scroll', () => window.dispatchEvent(new Event('lenis-scroll')));
    smooth.current = lenis;
    return () => { lenis.destroy(); smooth.current = null; };
  }, [still]);
  /* ── AND IT STANDS DOWN WHILE CAPTURE IS OPEN (Leon, Nov 5 — A4) ────────
   * Capture can be raised over this page now. The dialog locks the page by
   * hiding its overflow, which stops a finger and a scrollbar but not a
   * script — and smooth scrolling is a script: it moves the page itself on
   * every wheel event, so the landing page would have gone on travelling
   * behind a blurred dialog. Stopped while the box is up, started again when
   * it closes; the dialog marks itself `data-lenis-prevent` so its own
   * conversation still scrolls. */
  const capturing = useCaptureOpen();
  useEffect(() => {
    const lenis = smooth.current;
    if (!lenis) return;
    if (capturing) lenis.stop();
    else lenis.start();
  }, [capturing]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="bauhly-landing">
      <main>
        <S1Hero />
        <S1bProblem />
        {/* ── THE RESULT COMES BEFORE THE PRODUCT (Leon, Nov 5 — landing
            audit, S1) ──────────────────────────────────────────────────
            "Outcome: show the desired result before focusing on the
             product." `Found. Trusted. Hired.` stood eighth, after four
            sections about the weekly plan; it stands third now, straight
            after the problem it answers.
            WHAT USED TO BE HERE, between Memory and this: `S4Strategist`
            (`Applause is nice. Inquiries pay.`). Its claim was that Bauhly
            tracks enquiries and reviews them weekly, and the check-in that
            did that is retired (see docs/LANDING_AUDIT_PHASE1.md, claims
            audit). The one line in it that is true — likes from other
            designers do not book projects — is already what the Found card
            below says, so it was not repeated. The scene file is untouched
            and unmounted; KNOWN_ISSUES 11 lists it. */}
        <S5Journey />
        {/* ── THEN THE POST, THEN THE PLAN (Leon, Nov 5 — S3 and S5) ─────
            `How it works` tells the road from a project to a post and comes
            first; the planner follows as what Bauhly also does. Intelligence
            and Memory are two panels inside the planner now — their scene
            files are unmounted, not deleted (KNOWN_ISSUES 11). */}
        <S3Reframe />
        <S2SecondJob />
        {/* `S7Pricing` stays unmounted in the live app: no prices while Bauhly is invite-only */}
        <S8Faq />
        <S6Invitation />
        <Footer />
      </main>
      {/* the way into Capture: fixed to the window at every scroll, so it is not
          inside any section (Leon, Nov 5 — see HeroCapture.jsx) */}
      <HeroCapture />
      {/* the box the field opens — the same Capture the app uses, mounted here because the
          dashboard's own host lives inside the signed-in layout */}
      <CaptureHost />
    </div>
    </MotionConfig>
  );
}
