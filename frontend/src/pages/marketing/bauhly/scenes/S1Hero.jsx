import { motion } from 'motion/react'
import { heroPop } from '../lib/motion.js'
import Nav from '../components/Nav.jsx'
import PostCarousel from '../components/PostCarousel.jsx'
import { useLang } from '../lib/lang.js'

export default function S1Hero() {
  const [, , t] = useLang()
  return (
    /* ── CENTRED, AND IN THE ORDER IT IS READ (Leon, Nov 5 — A4) ──────────
        The headline, who it is for, what it does; then real posts between that
        and the chat field, which is fixed to the bottom of the window and is
        mounted by Landing.jsx rather than here (see HeroCapture.jsx).
        "The priority is to create a strong first impression through outstanding
         post designs, compelling imagery, and smooth motion, while keeping the
         main message and chatfield clearly visible." */
    <section className="h1s h1s--centre">
      <Nav />
      <span className="h1s-orb" aria-hidden="true" />
      <div className="container h1s-copy">
        {/* ── LEON'S OWN WORDS (Nov 5) ────────────────────────────────────────────
            "Turn your everyday work into stories worth sharing." Replaces decisions
            625 and 626's wording. Who it is for keeps its underline in the line
            below. "reach the right clients" is a promise to make good: [VALIDATE].
            No platform is named (CLAUDE.md §2). */}
        <motion.h1 className="h1s-title" {...heroPop(0)}>
          {t.title}
        </motion.h1>
        <motion.p className="h1s-sub" {...heroPop(0.05)}>
          {t.subBefore}
          <span className="hl-designers">
            {t.subWho}
            <svg viewBox="0 0 220 14" aria-hidden="true" preserveAspectRatio="none">
              <path
                d="M4 9 C 50 3, 110 12, 216 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="M14 12 C 70 8, 150 13, 205 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                opacity="0.55"
              />
            </svg>
          </span>
          {t.subAfter}
        </motion.p>
      </div>

      {/* WHAT USED TO BE HERE: a button to sign-up (Leon: "Do not redirect
          visitors to signup before Capture"); three pinned prints, which he did
          not like; and a line above this row reading `Illustrative posts ·
          Bauhly Demo`, which he asked to remove on Nov 5. */}
      <motion.div className="h1s-posts" {...heroPop(0.2)}>
        <PostCarousel />
      </motion.div>
    </section>
  )
}
