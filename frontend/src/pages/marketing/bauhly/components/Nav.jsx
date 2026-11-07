import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../../../../brand/Icon.jsx'
import { LANGS, useDocumentLang, useLang } from '../lib/lang.js'
import { startCapture } from './HeroCapture.jsx'

/* in the order the page is in: `How it works` moved ahead of the planner
   (landing audit, S3/S5). The words are in lib/lang.js */
/* no `#pricing` in the live app: the page shows no prices while Bauhly is invite-only */
const HREFS = ['#problem', '#how', '#plan', '#questions']

/* ── ONE BAR, ALL THE WAY BACK TO THE TOP (Leon, Nov 5: "the same navbar naturally returning
   to its original position, with a smooth background fade"). At the top it belongs to the
   first section and scrolls away with it: CSS places it in the section (`data-nav='top'`),
   so the browser moves it and nothing here does. Past that section it is the white pill,
   which shows on the way up and hides on the way down. NOTHING ARRIVES WHILE SCROLLING DOWN
   FROM THE TOP: that read as the bar coming back (decision 633).
   Once the pill has come back into the first section it stays, in either direction, and its
   ground is drawn straight off the scroll over the last FADE px, so turning round part way
   simply runs it back. The pill and the section's bar stand in exactly the same place, so at
   the top of the page one becomes the other with nothing moving and nothing to see. */
const CLEAR = 120 // px from the window's top: the section's foot is above the pill's lower edge
const STICKY = 40 // px further up before the bar goes back to the section, so it cannot flicker
const DEEP = 120 // px past CLEAR before scrolling up brings the pill, or it would show and leave
const TURN = 6 // px of scroll in one direction before it counts: wheels and inertia wobble
const FADE = 120 // px of scroll before the top over which the pill's ground fades out

/* THE LANGUAGE MENU (Leon, Nov 5). The product's `.pe-menu`, opened in place the way
   FontField opens it. It closes on a press elsewhere, on Escape and on any scroll, rather
   than with `.pe-menu__scrim`: the bar's transform would keep a fixed scrim inside the bar.
   The arrow keys walk the rows, and the caret goes back to the button when it closes. */
function LangSelect({ lang, setLang, label }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const btn = useRef(null)
  const here = LANGS.find((l) => l.id === lang)

  const close = (refocus) => {
    setOpen(false)
    if (refocus) btn.current?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    box.current?.querySelector('[aria-checked="true"]')?.focus()
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const gone = () => setOpen(false)
    document.addEventListener('pointerdown', away)
    window.addEventListener('scroll', gone, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', away)
      window.removeEventListener('scroll', gone)
    }
  }, [open])

  const keys = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(true); return }
    if (e.key === 'Tab') { setOpen(false); return }
    const rows = [...box.current.querySelectorAll('[role="menuitemradio"]')]
    const at = rows.indexOf(document.activeElement)
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    rows[(to + rows.length) % rows.length]?.focus()
  }

  return (
    <span className="nav-lang" ref={box} onKeyDown={open ? keys : undefined}>
      <button
        ref={btn}
        type="button"
        className="nav-lang__btn"
        aria-label={`${label}: ${here.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {here.short}
        <Icon name="chevron-down" size={15} strokeWidth={2.25} />
      </button>
      {open && (
        <span className="pe-menu nav-lang__menu" role="menu" aria-label={label}>
          {LANGS.map((l) => (
            <button
              key={l.id}
              type="button"
              role="menuitemradio"
              lang={l.id}
              aria-checked={l.id === lang}
              onClick={() => { setLang(l.id); close(true) }}
            >
              <span className="pe-menu__grow">{l.name}</span>
              {l.id === lang && <Icon name="check" size={16} strokeWidth={2.5} />}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

export default function Nav() {
  const nav = useNavigate()
  const [lang, setLang, t] = useLang()
  useDocumentLang(lang)
  const bar = useRef(null)
  const [open, setOpen] = useState(false)

  const goLogin = () => nav('/auth')
  /* invite-only: there is no sign-up page to send anybody to. The primary press is the
     product itself, Capture, which asks for an account (or access) at the first send */
  const goSignup = () => startCapture()

  /* before the first paint, so a page restored part way down never shows the wrong state.
     Written on the element with no re-render. */
  useLayoutEffect(() => {
    const node = bar.current
    const hero = node.closest('.h1s')
    const set = (state) => { node.dataset.nav = state }
    const footOf = () => hero?.getBoundingClientRect().bottom ?? 0
    let last = window.scrollY
    /* placed with no animation: nothing about it can be seen to change at these moments, so
       the slide must not run */
    const place = (state) => {
      node.style.transition = 'none'
      set(state)
      node.getBoundingClientRect()
      node.style.transition = ''
    }
    const sync = () => {
      const y = Math.max(0, window.scrollY)
      const foot = footOf()
      const state = node.dataset.nav
      node.style.setProperty('--nav-ground', Math.min(1, y / FADE).toFixed(3))

      /* the top of the page, exactly: the section's bar is scrolled by whatever is left, so
         handing over at half a pixel moved it half a pixel (MEASURED). From the pill this is
         the same bar with its ground gone. From a pill slid out, a jump: `top` comes in by
         its own short fade */
      if (y <= 0) {
        last = y
        if (state === 'float') place('top')
        else if (state === 'away') set('top')
        return
      }

      if (state === 'top') {
        last = y
        if (foot > CLEAR) return
        setOpen(false)
        /* the section has already carried the bar off screen, so this cannot be seen, and
           it waits above the window for a scroll up */
        place('away')
        return
      }

      /* only got part way down and turned round: the section's bar comes back with the page */
      if (state === 'away' && foot > CLEAR + STICKY) {
        last = y
        place('top')
        return
      }

      const moved = y - last
      if (Math.abs(moved) < TURN) return
      last = y
      /* still in the first section, the pill stays whichever way the scroll goes */
      if (moved > 0) { if (foot <= 0) set('away') }
      else if (foot <= CLEAR - DEEP) set('float')
    }
    set(footOf() <= CLEAR ? 'float' : 'top')
    sync()
    /* both, as in HeroCapture: `lenis-scroll` fires in the frame the page moves, and the
       browser's `scroll` a frame later, which would leave the fade one frame behind */
    window.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('lenis-scroll', sync)
    return () => {
      window.removeEventListener('scroll', sync)
      window.removeEventListener('lenis-scroll', sync)
    }
  }, [])

  return (
    <nav ref={bar} data-nav="top" className={`nav ${open ? 'nav-open' : ''}`}>
      <span className="nav-mark">
        Bauhly<span className="nav-dot">.</span>
      </span>

      <div className="nav-links">
        {HREFS.map((href, i) => (
          <a key={href} href={href}>
            {t.links[i]}
          </a>
        ))}
      </div>

      <div className="nav-actions">
        <LangSelect lang={lang} setLang={setLang} label={t.language} />
        <button className="nav-login" onClick={goLogin}>
          {t.login}
        </button>
        <button className="cta cta-ink nav-cta" onClick={goSignup}>
          {t.start}
        </button>
      </div>

      <button
        className="nav-burger"
        aria-label={open ? t.closeMenu : t.openMenu}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div className="nav-panel">
          {HREFS.map((href, i) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {t.links[i]}
            </a>
          ))}
          <div className="nav-panel-actions">
            <button
              className="nav-login"
              onClick={() => {
                setOpen(false)
                goLogin()
              }}
            >
              {t.login}
            </button>
            <button
              className="cta cta-ink nav-cta"
              onClick={() => {
                setOpen(false)
                goSignup()
              }}
            >
              {t.start}
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
