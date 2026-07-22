import './authority-pillars.css'

/*
 * Single presentation for authority pillars across the app.
 *
 * The comparison is stated numerically rather than drawn as a bar: the value,
 * the comparable-competitor figure, and the gap between them. A bar implies a
 * 0–100 scale that these numbers don't always have, and it competes visually
 * with the metric itself.
 *
 * "Comparable competitors" is the benchmark everywhere — competitors in the
 * same market, size band and category as the account being viewed.
 */

export type PillarKey = 'discovery' | 'credibility' | 'trust'

export interface PillarScore {
  pillar: PillarKey
  /** The account's value. */
  value: number
  /** Median across comparable competitors. */
  benchmark: number
}

const labels: Record<PillarKey, string> = {
  discovery: 'Discovery',
  credibility: 'Credibility',
  trust: 'Trust',
}

export function AuthorityPillars({
  scores,
  unit = 'score',
}: {
  scores: PillarScore[]
  /** 'score' = 0–100 index; 'share' = % of classified posts. */
  unit?: 'score' | 'share'
}) {
  const suffix = unit === 'share' ? '%' : ''
  return (
    <dl className="pillars">
      {scores.map((s) => {
        const gap = Math.round((s.value - s.benchmark) * 10) / 10
        const tone = gap >= 6 ? 'up' : gap <= -6 ? 'down' : 'flat'
        return (
          <div className="pillar-row" key={s.pillar}>
            <dt className="pillar-row-label">
              <span className={`pillar-dot pillar-dot--${s.pillar}`} aria-hidden="true" />
              {labels[s.pillar]}
            </dt>
            <dd className="pillar-row-figures">
              <span className="pillar-row-value">
                {Math.round(s.value * 10) / 10}
                {suffix}
              </span>
              <span className={`pillar-gap pillar-gap--${tone}`}>
                {gap > 0 ? '+' : ''}
                {gap}
                {suffix}
              </span>
              <span className="pillar-row-meta">
                comparable competitors {Math.round(s.benchmark * 10) / 10}
                {suffix}
              </span>
            </dd>
          </div>
        )
      })}
    </dl>
  )
}
