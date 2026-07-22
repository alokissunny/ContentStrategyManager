import { useMemo, useState } from 'react'
import type { RecommendationOutcome } from '../../types'
import { getOutcomes, summariseOutcomes } from '../../services/outcomes/repository'
import './outcomes.css'

/*
 * "Did our advice work?" — asked per customer.
 *
 * The two numbers are kept apart on purpose. Adherence is about the
 * customer; success is about the recommendation. Merging them into one
 * "effectiveness" figure would let a good recommendation nobody followed
 * look identical to a bad one everybody did.
 */

const VERDICT: Record<
  RecommendationOutcome['verdict'],
  { label: string; tone: 'positive' | 'negative' | 'neutral' | 'muted' }
> = {
  'improved-after': { label: 'Improved after', tone: 'positive' },
  'declined-after': { label: 'Declined after', tone: 'negative' },
  'no-measurable-change': { label: 'No measurable change', tone: 'neutral' },
  'too-early': { label: 'Measuring', tone: 'muted' },
  'not-evaluable': { label: 'No result to report', tone: 'muted' },
}

const ADHERENCE_LABEL: Record<RecommendationOutcome['adherence'], string> = {
  followed: 'Followed',
  'partially-followed': 'Partly followed',
  'not-followed': 'Not followed',
  pending: 'This week',
}

export function OutcomeHistory({ customerId, customerName }: { customerId: string; customerName: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const outcomes = useMemo(() => getOutcomes(customerId), [customerId])
  const summary = useMemo(() => summariseOutcomes(outcomes), [outcomes])

  if (!outcomes.length) return null

  return (
    <section className="outcomes">
      <div className="outcomes-head">
        <h3 className="outcomes-title">Did our recommendations work?</h3>
        <p className="outcomes-sub">
          {customerName} · last {outcomes.length} weeks
        </p>
      </div>

      <div className="outcomes-summary">
        <div className="outcome-stat">
          <span className="outcome-stat-label">Acted on</span>
          <span className="outcome-stat-value">{summary.adherencePct}%</span>
          <span className="outcome-stat-detail">
            {summary.followed} of {summary.recommended} recommendations
          </span>
        </div>
        <div className="outcome-stat">
          <span className="outcome-stat-label">Improved after</span>
          <span className="outcome-stat-value">
            {summary.successPct != null ? `${summary.successPct}%` : '—'}
          </span>
          <span className="outcome-stat-detail">
            {summary.reportable
              ? `${summary.improvedAfter} of the ${summary.followed} they followed`
              : `only ${summary.followed} followed — too few to state a rate`}
          </span>
        </div>
      </div>

      <ol className="outcome-list">
        {outcomes.map((o) => {
          const v = VERDICT[o.verdict]
          const isOpen = expanded === o.id
          return (
            <li key={o.id} className={`outcome-row outcome-row--${v.tone}`}>
              <button
                type="button"
                className="outcome-row-main"
                onClick={() => setExpanded(isOpen ? null : o.id)}
                aria-expanded={isOpen}
              >
                <span className="outcome-date">{o.recommendedOn}</span>
                <span className="outcome-play">{o.contentType}</span>
                <span className="outcome-adherence">{ADHERENCE_LABEL[o.adherence]}</span>
                <span className={`outcome-verdict outcome-verdict--${v.tone}`}>{v.label}</span>
                <span className="outcome-change">
                  {o.metricChangePct != null
                    ? `${o.metricChangePct > 0 ? '+' : ''}${o.metricChangePct}% ${o.metricLabel.toLowerCase()}`
                    : '—'}
                </span>
              </button>

              {isOpen && (
                <div className="outcome-detail">
                  {o.metricChangePct != null ? (
                    <>
                      <p className="outcome-detail-line">
                        Recommended {o.contentType} ({o.pillar}). They published{' '}
                        {o.matchedPostCount} matching post{o.matchedPostCount === 1 ? '' : 's'}.{' '}
                        {o.metricLabel} moved {o.metricChangePct > 0 ? '+' : ''}
                        {o.metricChangePct}% over the {o.windowDays} days that followed.
                      </p>
                      <p className="outcome-caveat">
                        This is a sequence, not a cause. Nothing here was controlled for:
                      </p>
                      <ul className="outcome-confounders">
                        {o.confounders.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="outcome-detail-line">
                      {o.adherence === 'pending'
                        ? `Recommended on ${o.recommendedOn}. The ${o.windowDays}-day measurement window is still open.`
                        : 'Nothing matching this recommendation was published, so there is no result to report. This is not a zero — it was never tried.'}
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
