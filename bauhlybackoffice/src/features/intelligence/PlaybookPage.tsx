import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  defaultSegment,
  getPlaybook,
  segmentOptions,
  type PillarKey,
  type SegmentQuery,
} from '../../services/intelligence/playbook'
import type { EvidenceItem } from '../../services/intelligence/playbook'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import { CompetitorsIcon, CustomersIcon, SendIcon, TrendUpIcon } from '../../components/icons'
import { Delta } from './bits'
import { getTrackRecord } from '../../services/outcomes/repository'
import '../customers/outcomes.css'
import './playbook.css'

/*
 * Intelligence: the page that connects competitor evidence to customer output.
 *
 * A segment is (follower range × market × authority gap). Everything below the
 * selector answers one question for that segment — what do high-performing
 * competitors do that customers with this gap should copy, and on what
 * evidence.
 */

const pillarLabels: Record<PillarKey, string> = {
  discovery: 'Discovery',
  credibility: 'Credibility',
  trust: 'Trust',
}

function EvidenceList({
  items,
  focusLabel,
  comparisonLabel,
}: {
  items: EvidenceItem[]
  focusLabel: string
  comparisonLabel: string
}) {
  return (
    <ul className="evidence-list">
      {items.map((item) => (
        <li key={item.label}>
          <div className="evidence-head">
            <span className="evidence-label">{item.label}</span>
            <span className="evidence-figures">
              <strong>{item.focusPct}%</strong>
              <span className="evidence-vs">vs {item.comparisonPct}%</span>
              <Delta value={Math.round((item.focusPct - item.comparisonPct) * 10) / 10} />
            </span>
          </div>
          <div className="evidence-bars" aria-hidden="true">
            <div className="evidence-bar">
              <div className="evidence-bar-fill evidence-bar-fill--focus" style={{ width: `${item.focusPct}%` }} />
            </div>
            <div className="evidence-bar">
              <div className="evidence-bar-fill" style={{ width: `${item.comparisonPct}%` }} />
            </div>
          </div>
          {item.detail && <span className="evidence-detail">{item.detail}</span>}
          <span className="evidence-legend">
            {focusLabel} vs {comparisonLabel}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function PlaybookPage() {
  const [segment, setSegment] = useState<SegmentQuery>(defaultSegment)
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['playbook', segment],
    queryFn: () => getPlaybook(segment),
    placeholderData: (prev) => prev,
  })

  const set = <K extends keyof SegmentQuery>(key: K, value: SegmentQuery[K]) =>
    setSegment((prev) => ({ ...prev, [key]: value }))

  if (isError) {
    return (
      <EmptyState
        title="Couldn't build the playbook"
        description="Something went wrong assembling this segment."
        action={
          <button type="button" className="filter-clear" onClick={() => refetch()}>
            Retry
          </button>
        }
      />
    )
  }

  if (isPending || !data) {
    return (
      <div className="dashboard-loading" role="status" aria-label="Loading playbook">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skeleton-card" key={i} />
        ))}
      </div>
    )
  }

  const { segment: seg, evidence, customers, benchmark } = data
  const focusLabel = 'high performers'
  const comparisonLabel = 'rest of group'

  return (
    <div className="playbook">
      <div className="comp-filters filter-bar" role="group" aria-label="Segment">
        <div className="filter-field">
          <label htmlFor="pb-range">Follower range</label>
          <select id="pb-range" value={segment.followerRange} onChange={(e) => set('followerRange', e.target.value)}>
            {segmentOptions.followerRange.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="pb-country">Market</label>
          <select id="pb-country" value={segment.country} onChange={(e) => set('country', e.target.value)}>
            {segmentOptions.country.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor="pb-gap">Customer gap</label>
          <select id="pb-gap" value={segment.gap} onChange={(e) => set('gap', e.target.value as PillarKey)}>
            {segmentOptions.gap.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The claim this page makes, stated in one sentence with its evidence. */}
      <section className="playbook-claim">
        <p className="playbook-claim-line">
          For customers with <strong>{seg.followerRange}</strong> followers in{' '}
          <strong>{seg.country}</strong> who are behind on{' '}
          <strong>{seg.gapLabel}</strong>, we recommend the plan below.
        </p>
        <p className="playbook-claim-evidence">
          Built from the <strong>top {evidence.highPerformers} of {evidence.comparisonAccounts}</strong>{' '}
          comparable competitors in that same range and market —{' '}
          {evidence.postsAnalyzed.toLocaleString('en-US')} posts over the last {evidence.windowDays}{' '}
          days.
          <span className={`evidence-tag evidence-tag--${evidence.strength}`}>
            {evidence.strength} evidence
          </span>
        </p>
        <p className="playbook-definition">
          <strong>High performer:</strong> {evidence.highPerformerDefinition}
        </p>
      </section>

      {evidence.belowThreshold && (
        <p className="source-notice">
          This segment has too few accounts to recommend from confidently. Widen the follower range
          or market before acting on it.
        </p>
      )}

      <div className="summary-cards">
        <StatCard
          icon={<CustomersIcon />}
          tone="blue"
          label="Customers this applies to"
          value={customers.count}
          detail={customers.examples.length ? customers.examples.slice(0, 2).join(', ') : 'none in this segment'}
        />
        <StatCard
          icon={<CompetitorsIcon />}
          tone="green"
          label="High performers"
          value={evidence.highPerformers}
          detail={`top 25% of ${evidence.comparisonAccounts} comparable accounts`}
        />
        <StatCard
          icon={<SendIcon />}
          tone="purple"
          label="Their posts / week"
          value={benchmark.postsPerWeek}
          detail="median for high performers"
        />
        <StatCard
          icon={<TrendUpIcon />}
          tone="teal"
          label={`Posts about ${seg.gapLabel.toLowerCase()}`}
          value={`${benchmark.gapPillarSharePct}%`}
          detail={`of high performers' posts · rest of group ${benchmark.gapPillarComparisonPct}%`}
        />
      </div>

      <section className="panel playbook-plan" aria-labelledby="plan-title">
        <div className="panel-head">
          <h2 id="plan-title">Recommended weekly plan</h2>
          <span className="panel-head-note">
            for customers in this segment with a {seg.gapLabel} gap
          </span>
        </div>
        <p className="plan-note">
          Four of seven slots carry {seg.gapLabel.toLowerCase()} content — high performers never
          published one pillar all week. Posting times are not shown here: they are set per customer
          from that account’s own audience-activity data.
        </p>
        <ol className="playbook-days">
          {data.plan.map((p) => (
            <li className="playbook-day" key={p.day}>
              <div className="playbook-day-head">
                <span className="playbook-day-name">{p.day}</span>
                <span className={`pillar-tag pillar-tag--${p.pillar}`}>{pillarLabels[p.pillar]}</span>
              </div>
              <p className="playbook-day-content">{p.contentType}</p>
              <p className="playbook-day-format">{p.format}</p>
              <p className="playbook-day-adoption">{p.adoptionPct}% of high performers publish this</p>
              <p className="playbook-day-requires">Needs: {p.requires}</p>
              {(() => {
                const record = getTrackRecord(p.contentType)
                if (!record) return null
                return record.reportable ? (
                  <p className="play-record">
                    Our record: <strong>{record.followed}</strong> customers ran it,{' '}
                    <strong>{record.improvedAfter}</strong> improved after
                    {record.medianChangePct != null && (
                      <> · median {record.medianChangePct > 0 ? '+' : ''}{record.medianChangePct}%</>
                    )}
                  </p>
                ) : (
                  <p className="play-record play-record--thin">
                    Our record: only {record.followed} customers have run it — too few to report a rate.
                  </p>
                )
              })()}
            </li>
          ))}
        </ol>
      </section>

      <div className="playbook-grid">
        <section className="panel" aria-labelledby="pb-topics">
          <div className="panel-head">
            <h2 id="pb-topics">Topics that carry it</h2>
          </div>
          <EvidenceList items={data.topics} focusLabel={focusLabel} comparisonLabel={comparisonLabel} />
        </section>

        <section className="panel" aria-labelledby="pb-hooks">
          <div className="panel-head">
            <h2 id="pb-hooks">Hooks that open it</h2>
          </div>
          <EvidenceList items={data.hooks} focusLabel={focusLabel} comparisonLabel={comparisonLabel} />
        </section>

        <section className="panel" aria-labelledby="pb-tags">
          <div className="panel-head">
            <h2 id="pb-tags">Hashtags they use</h2>
          </div>
          <EvidenceList items={data.hashtags} focusLabel={focusLabel} comparisonLabel={comparisonLabel} />
        </section>

        <section className="panel" aria-labelledby="pb-stop">
          <div className="panel-head">
            <h2 id="pb-stop">What to stop doing</h2>
            <span className="panel-head-note">capacity is finite — drop these first</span>
          </div>
          <EvidenceList items={data.stopDoing} focusLabel={focusLabel} comparisonLabel={comparisonLabel} />
        </section>
      </div>

    </div>
  )
}
