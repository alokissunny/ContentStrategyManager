/*
 * The landing page's way into Capture — ONE element, always in the same place
 * (Leon, Nov 5 — landing audit, A4; position corrected the same day).
 *
 * "The chatfield should always stay fixed at the bottom, in exactly the same
 *  position. Right now, it moves up when scrolling down."
 *
 * WHAT THAT CORRECTS: this used to sit in the hero's flow and scroll with the
 * page until it passed under the nav, and only then lift out and travel to the
 * bottom. So it did two things nobody asked for: it left with the page, and it
 * crossed the screen to come back. It is fixed from the first frame now: its
 * bottom edge and its centre line never move, at any scroll, at any width.
 *
 * It has two forms on that one anchor:
 *   field   the chat field, over the hero
 *   pill    the same element, narrower, once the hero has mostly scrolled away
 *           (Leon's A4: "a smaller, centred button"). It shrinks IN PLACE.
 * Capture grows out of whichever is there and closes back into it — that half
 * lives in CaptureHost.jsx.
 *
 * ON A PHONE IT IS ALWAYS THE PILL (Leon, Nov 5: "don't show the full expanded
 * chatfield"). Not a second component: the same element, held in that form. A
 * press there opens Capture with the caret in its field and the same examples
 * typing in it, which is what the field shows everywhere else.
 *
 * ── WHAT IS REUSED ───────────────────────────────────────────────────────
 * In the live app the field is drawn here in the shape of Capture's own bar
 * (an input and the send disc — the reference reuses its onboarding composer,
 * which this app does not have). The box is the product's Capture modal,
 * opened through lib/captureUi.js and mounted by Landing.jsx's CaptureHost.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import Icon from '../../../../brand/Icon'
import { useTypedPlaceholder } from '../../../../components/ui/typing.js'
import { openCaptureIdea, useCaptureOpen, canTakeCaret, CAPTURE_CLOSE_MS } from '../../../../lib/captureUi'
import { useLang } from '../lib/lang.js'

/* it has finished shrinking once this share of the viewport is all that is left of the
   hero. It starts on the first pixel of scroll */
const HERO_LEFT = 0.55
/* the width `useIsPhone` means, and the width at which the pill's spacing changes */
const PHONE = '(max-width: 640px)'
/* a tablet: wide enough for the field, and the nav is the logo and the hamburger */
const TABLET = '(min-width: 641px) and (max-width: 1200px)'
const isPhone = () => window.matchMedia(PHONE).matches
const FADE_MS = 300

/* the nav's primary button and the page's other calls to action open the same box,
   growing out of this element wherever it stands */
let raiseNow = null
export const startCapture = () => raiseNow?.()

/* counts keystrokes that arrived before the box did — see `addDraft` in
   CaptureChat; module-level so two in a row are never the same number */
let typed = 0

export default function HeroCapture() {
  const [, , t] = useLang()
  /* the phrases are in lib/lang.js. The widest is what the bar is measured against, so
     its height never follows the typing */
  const EXAMPLES = t.examples
  const WIDEST = EXAMPLES.reduce((a, b) => (b.length > a.length ? b : a))
  const el = useRef(null)
  /* read at the start, not after the first paint: a phone never sees the field */
  const [form, setForm] = useState(() => (isPhone() ? 'pill' : 'field'))
  const open = useCaptureOpen()
  /* someone is on the field with the keyboard: the examples stop for them */
  const [held, setHeld] = useState(false)
  /* true while Capture is standing where this element was */
  const [covered, setCovered] = useState(false)
  /* true from the press until the box has gone: this is drawn above it */
  const [lifted, setLifted] = useState(false)

  /* ── THE SCROLL DRAWS IT, DIRECTLY (Leon, Nov 5: "directly synced with the scroll
     position, without any delay, easing, or transition") ──────────────────────────
     It used to wait until the hero was 45% gone, then flip a state, and the change ran
     for 420ms after the scroll, with the label 120ms behind that. Now `--hcap-p` runs
     0 to 1 in step with the scroll and CSS draws every frame from it, with no transition.
     Written on the element from inside the scroll event, so no render stands in between.
     `lenis-scroll` is the smooth scroll's own signal: it fires in the frame the page moves,
     where the browser's `scroll` event comes one frame later. The state only says which
     form takes the presses and the keyboard. */
  useLayoutEffect(() => {
    const node = el.current
    const hero = document.querySelector('.h1s')
    if (!node || !hero) return undefined
    const part = (p, from, to) => Math.min(1, Math.max(0, (p - from) / (to - from)))
    const sync = () => {
      const bottom = hero.getBoundingClientRect().bottom
      const start = bottom + window.scrollY
      const end = window.innerHeight * HERO_LEFT
      const p = isPhone() ? 1 : part(start - bottom, 0, Math.max(1, start - end))
      node.style.setProperty('--hcap-p', p.toFixed(4))
      setForm(p >= 0.5 ? 'pill' : 'field')
    }
    /* ON A TABLET THE FIELD RUNS FROM THE LOGO TO THE HAMBURGER (Leon, Nov 5). Measured, not
       worked out from the insets: the logo and the hamburger's lines are not the same distance
       from their edges (52 and 47 at 700, MEASURED), so the field is fitted to both and stands a
       little off centre, coming back to it as it shrinks to the pill. */
    const align = () => {
      const mark = document.querySelector('.nav-mark')?.getBoundingClientRect()
      const lines = document.querySelector('.nav-burger span')?.getBoundingClientRect()
      if (!window.matchMedia(TABLET).matches || !mark || !lines?.width) {
        node.style.removeProperty('--hcap-w')
        node.style.removeProperty('--hcap-dx')
        return
      }
      node.style.setProperty('--hcap-w', `${lines.right - mark.left}px`)
      node.style.setProperty('--hcap-dx', `${(mark.left + lines.right) / 2 - document.documentElement.clientWidth / 2}px`)
    }
    const resized = () => { align(); sync() }
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('lenis-scroll', sync)
    window.addEventListener('resize', resized)
    resized()
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('lenis-scroll', sync)
      window.removeEventListener('resize', resized)
    }
  }, [])

  /* The box is as tall as the composer inside it, and the composer decides
     that for itself (one row, or two on a phone where the placeholder needs
     them). Published as a property so the height can still be transitioned,
     which `auto` cannot — and the corner with it, because a two-row bar is not
     a full pill. */
  useEffect(() => {
    const node = el.current
    const bar = node?.querySelector('.obc')
    if (!bar || typeof ResizeObserver === 'undefined') return undefined
    const read = () => {
      const h = bar.offsetHeight
      const r = parseFloat(getComputedStyle(bar).borderTopLeftRadius) || 0
      node.style.setProperty('--hcap-h', `${h}px`)
      node.style.setProperty('--hcap-r', `${Math.min(r, h / 2)}px`)
    }
    const ro = new ResizeObserver(read)
    ro.observe(bar)
    read()
    return () => ro.disconnect()
  }, [])

  /* ── WHAT CAPTURE GROWS OUT OF, AND CLOSES BACK INTO ───────────────────
     Read by the box at both ends, so it is a function and not a rectangle:
     which form is there by the time Capture closes depends on the scroll. */
  const origin = useCallback(() => {
    const node = el.current
    if (!node) return null
    const r = node.getBoundingClientRect()
    const corner = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0
    /* the disc showing on the right, for the box's send to start on: it is the send in the
       field and the arrow in the pill, which differ in size and in their inset */
    const go = node.querySelector(node.classList.contains('hcap--pill') ? '.hcap__go' : '.obc__send').getBoundingClientRect()
    /* the box opens from the field and closes back into it */
    return {
      left: r.left, top: r.top, width: r.width, height: r.height, radius: Math.min(corner, r.height / 2),
      disc: { x: go.left + go.width / 2, y: go.top + go.height / 2 },
      el: node,
    }
  }, [])

  const raise = useCallback((text = '') => {
    /* read while the scrollbar is still there: see `--hcap-sb` in scenes.css */
    const root = document.documentElement
    root.style.setProperty('--hcap-sb', `${window.innerWidth - root.clientWidth}px`)
    /* the box is drawn before this returns, and the caret goes in here rather than in an
       effect, for a real pointer: see `canTakeCaret` for why a touch screen does not get it */
    flushSync(() => {
      openCaptureIdea({
        landing: {
          origin,
          draft: text ? { text, n: (typed += 1) } : null,
          /* the examples carry on in the box, in the focused field, from either form (Leon,
             Nov 5: "help users understand what they can share with Bauhly, even when the
             chatfield is active") */
          asks: EXAMPLES,
          example: t.example,
        },
      })
    })
    if (canTakeCaret()) document.querySelector('.cap-overlay--landing .capc__field')?.focus({ preventScroll: true })
  }, [origin, EXAMPLES, t.example])

  /* only while they can be seen and nobody is on the field. Every press on it opens
     Capture, and every key does, so `open` is what stops them for almost everyone */
  const [example, fading] = useTypedPlaceholder(EXAMPLES, form === 'field' && !open && !covered && !held)
  useEffect(() => {
    raiseNow = () => raise()
    return () => { raiseNow = null }
  }, [raise])

  /* ── AND IT CROSSES WITH THE BAR IN THE BOX (Leon, Nov 5: "as if it's the same component
     expanding"). The box's own bar opens exactly under this one, so this stays on top of it
     (`is-lifted`) and fades, from the frame of the press. Scattered timers used to leave the
     two side by side for 140ms. On the way back it is the same fade, ending as the box does.
     `FADE_MS` is `.hcap.is-lifted`'s transition. There is never a frame with neither. */
  if (open && !covered) setCovered(true)
  if (open && !lifted) setLifted(true)
  useEffect(() => {
    if (open || !lifted) return undefined
    const back = setTimeout(() => setCovered(false), CAPTURE_CLOSE_MS - FADE_MS)
    const down = setTimeout(() => setLifted(false), CAPTURE_CLOSE_MS)
    return () => { clearTimeout(back); clearTimeout(down) }
  }, [open, lifted])

  return (
    <div
      ref={el}
      className={`hcap hcap--${form} ${covered ? 'is-covered' : ''} ${lifted ? 'is-lifted' : ''} ${fading ? 'is-fading' : ''}`.replace(/\s+/g, ' ').trim()}
      onClick={() => raise()}
    >
      {/* the product's composer, as it is. Every control on it opens the box:
          there is nothing to send, attach or record until the conversation is
          there to receive it. A keystroke opens it too and is carried in, so a
          visitor who arrives by keyboard loses nothing. `inert` while it is not
          the form on screen — a hidden field must not take the Tab key. */}
      <div className="hcap__field" inert={form !== 'field' || covered ? '' : undefined}>
        {/* the shape of Capture's own bar: the sentence and the send. Every press on it
            opens the box, and a key typed into it is carried in */}
        <div className="obc obc--hero">
          <input
            className="obc__input"
            value=""
            onChange={(e) => raise(e.target.value)}
            onFocus={() => setHeld(true)}
            onBlur={() => setHeld(false)}
            /* null under reduced motion: the field's one sentence stands */
            placeholder={example ?? `${t.ask}…`}
            aria-label={t.ask}
          />
          <button type="button" className="obc__send" tabIndex={-1} aria-hidden="true">
            <Icon name="arrow-up" size={17} strokeWidth={2.4} />
          </button>
        </div>
      </div>
      <button
        type="button"
        className="hcap__pill"
        inert={form !== 'pill' || covered ? '' : undefined}
        aria-label={t.start}
      >
        <span className="obc__listen-wave hcap__wave" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <i key={i} style={{ '--i': i }} />)}
        </span>
        <span className="hcap__say">{t.start}</span>
        <span className="hcap__go" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </button>
    </div>
  )
}
