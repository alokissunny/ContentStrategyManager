/*
 * Bauhly brand mark.
 *
 * TODO(bauhly-identity): the previous mark (Mark/AppIcon below) was a
 * bespoke "signal route" glyph explicitly drawn as a stylized letter "W"
 * for WideSignals — see git history on this file if you want the old
 * design-rationale comment. It no longer means anything under the Bauhly
 * name, so it's stubbed out to a plain dot for now. Replace Mark/AppIcon
 * with a real Bauhly icon when one is designed; every call site already
 * goes through this file, so nothing else needs to change.
 *
 * Wordmark style matches the Bauhly landing page (src/pages/marketing/
 * bauhly/components/Nav.jsx): bold display type + a small accent dot.
 */

export function Mark({ size = 28, color = 'var(--ink-900)', accent = 'var(--signal-500)' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {/* placeholder stub — see TODO above */}
      <circle cx="32" cy="32" r="16" fill={accent} />
    </svg>
  );
}

export function Wordmark({ size = 20, color = 'var(--ink-900)' }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: size,
        letterSpacing: '-0.02em',
        color,
        lineHeight: 1,
      }}
    >
      Bauhly
      <span style={{ color: 'var(--signal-500)' }}>.</span>
    </span>
  );
}

export function Logo({ size = 26, color, to = '/', as: As = 'a' }) {
  return (
    <As
      href={As === 'a' ? to : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', whiteSpace: 'nowrap' }}
      aria-label="Bauhly home"
    >
      <Wordmark size={size} color={color} />
    </As>
  );
}

/* App icon — placeholder stub (see TODO above). Solid accent tile, no mark. */
export function AppIcon({ size = 40, radius = 0.24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect width="64" height="64" rx={64 * radius} fill="var(--signal-500)" />
      <circle cx="32" cy="32" r="14" fill="#fff" />
    </svg>
  );
}
