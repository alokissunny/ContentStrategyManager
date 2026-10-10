import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocale, setLocale } from '../../../../i18n'

const links = [
  ['#problem', 'The problem'],
  ['#plan', 'Your week'],
  ['#how', 'How it works'],
  ['#questions', 'Questions'],
]

export default function Nav() {
  const nav = useNavigate()
  const locale = useLocale()
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState(false)

  const goLogin = () => nav('/auth')

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

      <button
        type="button"
        className="nav-language"
        role="switch"
        aria-label="Español"
        aria-checked={locale === 'es'}
        onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
      >
        <span className="nav-language__thumb" aria-hidden="true" />
        <span lang="en" translate="no" aria-hidden="true">EN</span>
        <span lang="es" translate="no" aria-hidden="true">ES</span>
      </button>

      <div className="nav-actions">
        <button className="cta cta-ink nav-cta" onClick={goLogin}>
          Log in
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
              className="cta cta-ink nav-cta"
              onClick={() => {
                setOpen(false)
                goLogin()
              }}
            >
              Log in
            </button>
          </div>
        </div>
      )}
    </nav>
  )
}
