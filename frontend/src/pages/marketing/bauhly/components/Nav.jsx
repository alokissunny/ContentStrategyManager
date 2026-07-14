import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const links = [
  ['#problem', 'The problem'],
  ['#plan', 'Your week'],
  ['#how', 'How it works'],
  ['#pricing', 'Pricing'],
  ['#questions', 'Questions'],
]

export default function Nav() {
  const nav = useNavigate()
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)

  const goLogin = () => nav('/auth', { state: { mode: 'signin' } })
  const goSignup = () => nav('/auth', { state: { mode: 'signup' } })

  useEffect(() => {
    let last = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      setHidden(y > last && y > 140)
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <nav className={`nav ${hidden ? 'nav-hidden' : ''} ${open ? 'nav-open' : ''}`}>
      <span className="nav-mark">
        Bauhly<span className="nav-dot">.</span>
      </span>

      <div className="nav-links">
        {links.map(([href, label]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
      </div>

      <div className="nav-actions">
        <button className="nav-login" onClick={goLogin}>
          Log in
        </button>
        <button className="cta cta-ink nav-cta" onClick={goSignup}>
          Sign up
        </button>
      </div>

      <button
        className="nav-burger"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
        <span />
      </button>

      {open && (
        <div className="nav-panel">
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
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
              Log in
            </button>
            <button
              className="cta cta-ink nav-cta"
              onClick={() => {
                setOpen(false)
                goSignup()
              }}
            >
              Sign up
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
