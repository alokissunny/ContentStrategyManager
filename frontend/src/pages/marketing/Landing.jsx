/*
 * Landing — Bauhly marketing page.
 *
 * Ported from the standalone Bauhly landing build (design-system-creator/
 * stay-the-designer). All of its styling is scoped under the top-level
 * `.bauhly-landing` wrapper (see ./bauhly/styles/*.css) so it can never leak
 * into /auth, /onboarding, or /app — those keep the app's original design
 * system in src/styles/*.css untouched.
 */

import { useEffect } from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import Lenis from 'lenis';
import S1Hero from './bauhly/scenes/S1Hero.jsx';
import S1bProblem from './bauhly/scenes/S1bProblem.jsx';
import S2SecondJob from './bauhly/scenes/S2SecondJob.jsx';
import S3Reframe from './bauhly/scenes/S3Reframe.jsx';
import S10Intelligence from './bauhly/scenes/S10Intelligence.jsx';
import S9Memory from './bauhly/scenes/S9Memory.jsx';
import S4Strategist from './bauhly/scenes/S4Strategist.jsx';
import S5Journey from './bauhly/scenes/S5Journey.jsx';
import S7Pricing from './bauhly/scenes/S7Pricing.jsx';
import S8Faq from './bauhly/scenes/S8Faq.jsx';
import S6Invitation from './bauhly/scenes/S6Invitation.jsx';
import Footer from './bauhly/components/Footer.jsx';
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

  useEffect(() => {
    if (still) return undefined;
    const lenis = new Lenis({ autoRaf: true });
    return () => lenis.destroy();
  }, [still]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="bauhly-landing">
      <main>
        <S1Hero />
        <S1bProblem />
        <S2SecondJob />
        <S3Reframe />
        <S10Intelligence />
        <S9Memory />
        <S4Strategist />
        <S5Journey />
        <S7Pricing />
        <S8Faq />
        <S6Invitation />
        <Footer />
      </main>
    </div>
    </MotionConfig>
  );
}
