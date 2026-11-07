import { Link } from 'react-router-dom'
import { useLang } from '../lib/lang.js'

const WORDS = {
  en: {
    tag: 'The content strategist for interior design studios.',
    product: 'Product',
    week: 'Your week',
    evidence: 'The evidence',
    results: 'Results',
    pricing: 'Pricing',
    company: 'Company',
    problem: 'The problem',
    questions: 'Questions',
    base: 'Made for interior design studios · No trend-chasing. No dancing.',
  },
  es: {
    tag: 'El estratega de contenidos para estudios de interiorismo.',
    product: 'Producto',
    week: 'Tu semana',
    evidence: 'La evidencia',
    results: 'Resultados',
    pricing: 'Precios',
    company: 'Empresa',
    problem: 'El problema',
    questions: 'Preguntas',
    base: 'Hecho para estudios de interiorismo · Sin perseguir tendencias. Sin bailes.',
  },
}

export default function Footer() {
  const [lang] = useLang()
  const t = WORDS[lang]
  return (
    <footer className="foot">
      <div className="container foot-grid">
        <div>
          <span className="foot-mark">
            Bauhly<span className="nav-dot">.</span>
          </span>
          <p className="foot-tag">
            {t.tag}
          </p>
        </div>
        <div className="foot-col">
          <span className="foot-h">{t.product}</span>
          <a href="#plan">{t.week}</a>
          <a href="#intelligence">{t.evidence}</a>
          <a href="#results">{t.results}</a>
        </div>
        <div className="foot-col">
          <span className="foot-h">{t.company}</span>
          <a href="#problem">{t.problem}</a>
          <a href="#questions">{t.questions}</a>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/data-deletion">Data deletion</Link>
          <a href="mailto:bauhly@gmail.com">bauhly@gmail.com</a>
        </div>
      </div>
      <div className="container foot-base">
        <span>© 2026 Bauhly</span>
        <span>{t.base}</span>
      </div>
    </footer>
  )
}
