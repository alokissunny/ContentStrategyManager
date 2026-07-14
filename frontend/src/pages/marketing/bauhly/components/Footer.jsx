export default function Footer() {
  return (
    <footer className="foot">
      <div className="container foot-grid">
        <div>
          <span className="foot-mark">
            Bauhly<span className="nav-dot">.</span>
          </span>
          <p className="foot-tag">
            The content strategist for interior design studios.
          </p>
        </div>
        <div className="foot-col">
          <span className="foot-h">Product</span>
          <a href="#plan">Your week</a>
          <a href="#intelligence">The evidence</a>
          <a href="#results">Results</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="foot-col">
          <span className="foot-h">Company</span>
          <a href="#problem">The problem</a>
          <a href="#questions">Questions</a>
          <a href="mailto:hello@bauhly.com">hello@bauhly.com</a>
        </div>
      </div>
      <div className="container foot-base">
        <span>© 2026 Bauhly</span>
        <span>Made for interior design studios · No trend-chasing. No dancing.</span>
      </div>
    </footer>
  )
}
