import type { EvidenceStrength } from '../../types'

/* Small shared presentation pieces for the dashboard. */

/**
 * Pure-SVG sparkline. Deliberately not a charting library: it renders at its
 * final size on the first paint (no async container measuring), so table rows
 * and cards never jump.
 */
export function Sparkline({ data, color }: { data: number[]; color?: string }) {
  if (data.length < 2) return <div className="sparkline" aria-hidden="true" />
  const min = Math.min(...data)
  const range = Math.max(...data) - min || 1
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${25 - ((v - min) / range) * 20}`)
    .join(' ')
  return (
    <div className="sparkline" aria-hidden="true">
      <svg viewBox="0 0 100 28" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke={color ?? 'var(--trust-600)'}
          strokeWidth={1.8}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

const evidenceLabels: Record<EvidenceStrength, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  exploratory: 'Exploratory',
  inconclusive: 'Inconclusive',
}

const evidenceShortLabels: Record<EvidenceStrength, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  exploratory: 'Expl.',
  inconclusive: 'Inconcl.',
}

/** Evidence is never color-only: label text + colored dot. `short` fits the
 * badge into dense table columns without truncation. */
export function EvidenceBadge({ strength, short }: { strength: EvidenceStrength; short?: boolean }) {
  return (
    <span
      className={`evidence-badge evidence-badge--${strength}`}
      title={short ? evidenceLabels[strength] : undefined}
    >
      <span className="evidence-dot" aria-hidden="true" />
      {short ? evidenceShortLabels[strength] : evidenceLabels[strength]}
    </span>
  )
}

/** Signed change with direction arrow — never color alone. */
export function Delta({ value, unit = 'pp' }: { value: number; unit?: string }) {
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'
  return (
    <span className={`delta delta--${direction}`}>
      {value > 0 ? '+' : ''}
      {value}
      {unit} {arrow}
    </span>
  )
}

export function PillarTag({ pillar }: { pillar: string | null }) {
  if (!pillar) return null
  const label = pillar
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  return <span className={`pillar-tag pillar-tag--${pillar}`}>{label}</span>
}
