import type { WeeklyPlan } from '../../services/customers/repository'

/*
 * Recommended weekly plan for the selected customer.
 *
 * Two separate calculations drive it, so they are explained separately:
 *   what to post — the pillar this customer scores lowest on versus
 *                  comparable competitors;
 *   when to post — this account's own audience-activity data.
 * Each gets its own note; neither is asserted without its basis.
 */

const WHY_FOCUS =
  'How the focus is chosen: we score this customer on the three authority pillars from their own ' +
  'posts, then score comparable competitors — accounts in the same market, size band and category — ' +
  'the same way. The pillar with the largest shortfall becomes the focus. The content types come ' +
  'from what those competitors already publish successfully on that pillar.'

const WHY_TIMING =
  'How the times are chosen: Instagram reports when this account’s own followers are online. ' +
  'We place posts in those windows because the first 30–60 minutes after publishing carry the ' +
  'early signals Instagram uses to decide whether to show the post to more people. These windows ' +
  'are specific to this audience, so they differ from generic best-time-to-post charts.'

const pillarLabels: Record<string, string> = {
  discovery: 'Discovery',
  credibility: 'Credibility',
  trust: 'Trust',
}

/** One tooltip implementation — no native title on top of the custom one. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-badge" tabIndex={0} role="note" aria-label={text}>
      i<span className="info-tip">{text}</span>
    </span>
  )
}

export function WeeklyPlanPanel({ plan }: { plan: WeeklyPlan }) {
  const gap = plan.primaryGap
  const pillar = pillarLabels[gap.pillar]
  const behind = Math.abs(gap.gap)

  return (
    <section className="weekly-plan" aria-labelledby="weekly-plan-title">
      <div className="panel-head weekly-plan-head">
        <h2 id="weekly-plan-title">Recommended weekly plan — {plan.customerName}</h2>
      </div>

      <div className="plan-focus">
        <p className="plan-focus-line">
          <span className="plan-focus-label">This week focuses on {pillar}</span>
          <InfoTip text={WHY_FOCUS} />
        </p>
        <p className="plan-focus-explain">
          {gap.mode === 'close-gap' ? (
            <>
              This customer scores <strong>{gap.value} out of 100</strong> on {pillar.toLowerCase()}{' '}
              content. {plan.evidence.competitorCount} similar competitors average{' '}
              <strong>{gap.benchmark}</strong> — so they are <strong>{behind} points behind</strong>,
              their largest shortfall of the three pillars.
            </>
          ) : (
            <>
              This customer is ahead of similar competitors on all three pillars.{' '}
              {pillar} is the narrowest lead (<strong>{gap.value}</strong> vs{' '}
              <strong>{gap.benchmark}</strong> across {plan.evidence.competitorCount} competitors),
              so the week reinforces it.
            </>
          )}{' '}
          Based on the last {plan.evidence.windowDays} days of posts.
        </p>
      </div>

      <div className="plan-timing-note">
        <span>Times below are when this account’s followers are most active</span>
        <InfoTip text={WHY_TIMING} />
      </div>

      <div className="plan-grid">
        {plan.days.map((d) => (
          <div className="plan-day" key={d.day}>
            <div className="plan-day-head">
              <span className="plan-day-name">{d.day}</span>
              <span className="plan-day-time">{d.bestTime}</span>
            </div>
            <div className="plan-activity" aria-hidden="true">
              <div className="plan-activity-fill" style={{ width: `${d.audienceActivityPct}%` }} />
            </div>
            <span className="plan-activity-label">
              {d.audienceActivityPct}% of followers online then
            </span>
            <span className={`pillar-tag pillar-tag--${d.pillar}`}>{pillarLabels[d.pillar]}</span>
            <p className="plan-content">{d.contentType}</p>
            <p className="plan-format">{d.format}</p>
          </div>
        ))}
      </div>

      <p className="panel-foot-note weekly-plan-basis">{plan.basis}</p>
    </section>
  )
}
