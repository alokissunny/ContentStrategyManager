/*
 * The landing page's Log in box (bauhly-v3, Nov 8–9 — decisions 706, 740): the header's `Log in` opens
 * it over the page instead of leaving for /auth. It fades in where it stands with the white overlay and
 * its blur, and fades out the same way. The form is the one Capture's account step uses (CaptureLogin):
 * the real Log in, and Request early access while Bauhly is invite-only.
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CaptureLogin from '../../../../components/CaptureLogin'
import Icon from '../../../../brand/Icon'
import { setCaptureOpen } from '../../../../lib/captureUi'
import { LOGIN_EVENT } from '../lib/start.js'
import '../../../checkin/checkin.css'

const OUT_MS = 300

export default function LandingLogin() {
  const [state, setState] = useState(null) // null | 'in' | 'out'
  const nav = useNavigate()
  const timer = useRef(0)

  useEffect(() => {
    const show = () => { clearTimeout(timer.current); setState('in') }
    window.addEventListener(LOGIN_EVENT, show)
    return () => { window.removeEventListener(LOGIN_EVENT, show); clearTimeout(timer.current) }
  }, [])

  /* the page's smooth scroll stands down while it is up, as it does for Capture */
  useEffect(() => {
    if (state !== 'in') return undefined
    setCaptureOpen(true)
    const root = document.documentElement
    const was = root.style.overflow
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = was; setCaptureOpen(false) }
  }, [state])

  const close = (then) => {
    setState('out')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { setState(null); then?.() }, OUT_MS)
  }

  if (!state) return null
  return (
    <div className={`lgm${state === 'out' ? ' is-out' : ''}`} role="dialog" aria-modal="true" aria-label="Log in" data-lenis-prevent>
      <div className="lgm__scrim" onClick={() => close()} aria-hidden="true" />
      <div className="lgm__box">
        <button type="button" className="lgm__x" onClick={() => close()} aria-label="Close">
          <Icon name="x" size={20} strokeWidth={2} />
        </button>
        <CaptureLogin
          bare
          forWhat="Bauhly"
          backLabel="Back"
          onBack={() => close()}
          onDone={() => close(() => nav('/dashboard'))}
        />
      </div>
    </div>
  )
}
