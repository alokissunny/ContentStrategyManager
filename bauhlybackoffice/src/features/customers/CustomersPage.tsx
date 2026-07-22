import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  defaultCustomerQuery,
  listCustomers,
  type CustomerQuery,
} from '../../services/customers/repository'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import {
  CustomersIcon,
  EditIcon,
  SendIcon,
  ThumbUpIcon,
  TrendUpIcon,
} from '../../components/icons'
import { Delta, Sparkline } from '../intelligence/bits'
import { PeriodFilter } from '../../components/PeriodFilter'
import { CustomerDetail } from './CustomerDetail'
import { WeeklyPlanPanel } from './WeeklyPlan'
import { OutcomeHistory } from './OutcomeHistory'
import { getWeeklyPlan } from '../../services/customers/repository'
import { Modal } from '../../components/Modal'
import { mockCustomers, type FunnelStage } from '../../services/customers/mockData'
import './customers.css'

const lifecycleLabels: Record<string, { label: string; tone: 'positive' | 'negative' | 'neutral' | 'warning' }> = {
  active: { label: 'Active', tone: 'positive' },
  onboarding: { label: 'Onboarding', tone: 'neutral' },
  'at-risk': { label: 'At risk', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  churned: { label: 'Churned', tone: 'negative' },
}

const statusLabels: Record<string, { label: string; tone: 'positive' | 'negative' | 'neutral' }> = {
  improving: { label: 'Improving', tone: 'positive' },
  stable: { label: 'Stable', tone: 'neutral' },
  declining: { label: 'At Risk', tone: 'negative' },
  'new-or-insufficient-data': { label: 'New', tone: 'neutral' },
  'collection-error': { label: 'Collection Error', tone: 'negative' },
}

/** Median across comparable competitors, per pillar. */
const GAP_BENCHMARK = { discovery: 62, credibility: 66, trust: 60 } as const
const GAP_LABEL = { discovery: 'Discovery', credibility: 'Credibility', trust: 'Trust' } as const

/**
 * The gap shown is the one being filtered on; with no pillar filter it falls
 * back to whichever pillar the customer is furthest behind.
 */
function renderGap(
  row: { authorityGap: { discovery: number | null; credibility: number | null; trust: number | null } | null },
  pillar: 'all' | 'discovery' | 'credibility' | 'trust',
) {
  if (!row.authorityGap) return <span className="cust-stage">—</span>
  const scored = (['discovery', 'credibility', 'trust'] as const).map((p) => ({
    pillar: p,
    gap: Math.round(((row.authorityGap![p] ?? 0) - GAP_BENCHMARK[p]) * 10) / 10,
  }))
  const worst = pillar === 'all' ? [...scored].sort((a, b) => a.gap - b.gap)[0] : scored.find((s) => s.pillar === pillar)!
  return (
    <span className="cust-gap">
      <span className={`pillar-dot pillar-dot--${worst.pillar}`} aria-hidden="true" />
      <span className="cust-gap-pillar">{GAP_LABEL[worst.pillar]}</span>
      <span className={`pillar-gap pillar-gap--${worst.gap < 0 ? 'down' : 'up'}`}>
        {worst.gap > 0 ? '+' : ''}
        {worst.gap}
      </span>
    </span>
  )
}

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

export function CustomersPage() {
  const [query, setQuery] = useState<CustomerQuery>(defaultCustomerQuery)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stage, setStage] = useState<{ stage: FunnelStage; index: number } | null>(null)

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['customers', query],
    queryFn: () => listCustomers(query),
    placeholderData: (prev) => prev,
  })

  const set = <K extends keyof CustomerQuery>(key: K, value: CustomerQuery[K]) =>
    setQuery((prev) => ({ ...prev, [key]: value, page: 1 }))

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load customers"
        description="Something went wrong loading the customer list."
        action={<button type="button" className="filter-clear" onClick={() => refetch()}>Retry</button>}
      />
    )
  }

  if (isPending || !data) {
    return (
      <div className="dashboard-loading" role="status" aria-label="Loading customers">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skeleton-card" key={i} />
        ))}
      </div>
    )
  }

  const selected = selectedId
    ? (data.rows.find((r) => r.id === selectedId) ??
       mockCustomers.find((r) => r.id === selectedId) ??
       null)
    : null
  /** True when the selected customer is not on the page being viewed. */
  const selectedOffPage = selected != null && !data.rows.some((r) => r.id === selected.id)
  const empty = data.total === 0

  return (
    <div className={`cust-layout${selected ? ' cust-layout--detail' : ''}`}>
      <div className="cust-main">
      <div className="comp-filters filter-bar" role="group" aria-label="Customer filters">
          <input
            type="search"
            className="comp-search"
            placeholder="Search by customer name or account…"
            aria-label="Search customers"
            value={query.search}
            onChange={(e) => set('search', e.target.value)}
          />
          <div className="filter-field">
            <label htmlFor="c-country">Location</label>
            <select id="c-country" value={query.country} onChange={(e) => set('country', e.target.value)}>
              {['all', 'Spain', 'Netherlands', 'Germany', 'Denmark'].map((c) => (
                <option key={c} value={c}>{c === 'all' ? 'All' : c}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="c-status">Performance</label>
            <select id="c-status" value={query.status} onChange={(e) => set('status', e.target.value)}>
              <option value="all">All</option>
              {Object.entries(statusLabels).map(([value, s]) => (
                <option key={value} value={value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="c-lifecycle">Lifecycle</label>
            <select
              id="c-lifecycle"
              value={query.lifecycle}
              onChange={(e) => set('lifecycle', e.target.value as CustomerQuery['lifecycle'])}
            >
              <option value="all">All</option>
              {Object.entries(lifecycleLabels).map(([value, l]) => (
                <option key={value} value={value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="c-pillar">Authority Pillar</label>
            <select
              id="c-pillar"
              value={query.pillar}
              onChange={(e) => set('pillar', e.target.value as CustomerQuery['pillar'])}
            >
              <option value="all">All</option>
              <option value="discovery">Discovery</option>
              <option value="credibility">Credibility</option>
              <option value="trust">Trust</option>
            </select>
          </div>
          <div className="filter-field">
            <label htmlFor="c-followers">Follower Range</label>
            <select
              id="c-followers"
              value={query.followerRange}
              onChange={(e) => set('followerRange', e.target.value)}
            >
              {['all', 'Under 1K', '1K – 5K', '5K – 20K', '20K – 50K', 'Over 50K'].map((r) => (
                <option key={r} value={r}>
                  {r === 'all' ? 'All' : r}
                </option>
              ))}
            </select>
          </div>
          <PeriodFilter
            id="c-period"
            value={query.period}
            onChange={(period) => set('period', period)}
            range={query.customRange}
            onRangeChange={(customRange) => set('customRange', customRange)}
          />
        </div>

        {empty && (
          <EmptyState
            title="No customers match these filters"
            description="Nothing below can be reported for an empty selection. Widen the lifecycle, market or follower range."
          />
        )}

        {!empty && (
        <>
        <div className="summary-cards summary-cards--six">
          <StatCard
            icon={<CustomersIcon />}
            tone="blue"
            label="Total Customers"
            value={data.stats.total}
            detail={<><Delta value={4} unit="" /> vs last month</>}
          >
            <Sparkline data={data.stats.series[0]} />
          </StatCard>
          <StatCard
            icon={<TrendUpIcon />}
            tone="green"
            label="Active This Month"
            value={data.stats.activeThisMonth}
            detail={`${data.stats.total > 0 ? Math.round((data.stats.activeThisMonth / data.stats.total) * 100) : 0}% of total`}
          >
            <Sparkline data={data.stats.series[1]} />
          </StatCard>
          <StatCard
            icon={<SendIcon />}
            tone="purple"
            label="Publishing Rate (Avg.)"
            value={`${data.stats.avgPublishingRate}%`}
            detail="generated posts published"
          >
            <Sparkline data={data.stats.series[2]} />
          </StatCard>
          <StatCard
            icon={<ThumbUpIcon />}
            tone="orange"
            label="Content Accepted (Avg.)"
            value={`${data.stats.contentAccepted}%`}
            detail="of delivered items"
          >
            <Sparkline data={data.stats.series[3]} />
          </StatCard>
          <StatCard
            icon={<EditIcon />}
            tone="blue"
            label="Edit Rate (Avg.)"
            value={`${data.stats.avgEditRate}%`}
            detail="cross-check with rejection rate"
          >
            <Sparkline data={data.stats.series[4]} />
          </StatCard>
        </div>

        <section className="panel trend-panel" aria-labelledby="trend-title">
          <div className="panel-head">
            <h2 id="trend-title">Overall Trend</h2>
            <span className="panel-head-note">
              {data.overallTrend.periodLabel} vs {data.overallTrend.previousLabel} · median across
              connected customers
            </span>
          </div>
          <div className="trend-body">
            <div className="trend-metrics" role="list">
              {data.overallTrend.metrics.map((m) => (
                <div className="trend-metric" key={m.label} role="listitem">
                  <p className="stat-label">{m.label}</p>
                  <p className={`trend-metric-value${m.deltaPp < 0 ? ' negative' : ''}`}>{m.value}</p>
                  <Sparkline
                    data={m.series}
                    color={m.deltaPp < 0 ? 'var(--negative)' : 'var(--trust-600)'}
                  />
                </div>
              ))}
            </div>
            <div className="trend-mix">
              <p className="trend-mix-title">Customer status mix</p>
              {data.overallTrend.statusMix.map((s) => (
                <div className="adoption-row" key={s.label}>
                  <span className="adoption-label">{s.label}</span>
                  <div className="adoption-bar">
                    <div
                      className={`adoption-fill adoption-fill--${s.tone === 'positive' ? 'positive' : s.tone === 'negative' ? 'negative' : 'info'}`}
                      style={{ width: `${data.stats.total > 0 ? Math.round((s.count / data.stats.total) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="adoption-value">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="panel-foot-note">
            Medians, not averages — one unusual account cannot move the reported trend. Customers
            with under 30 days of connected data are excluded.
          </p>
        </section>

        <div className="panel">
          {selectedOffPage && selected && (
            <p className="cust-offpage-note">
              Showing <strong>{selected.name}</strong>, who is not on this page of results.{' '}
              <button type="button" className="link-button" onClick={() => setSelectedId(null)}>
                Clear selection
              </button>
            </p>
          )}

          {selected && (() => {
            const plan = getWeeklyPlan(selected.id, query.pillar)
            return (
              <>
                {plan ? <WeeklyPlanPanel plan={plan} /> : null}
                <OutcomeHistory customerId={selected.id} customerName={selected.name} />
              </>
            )
          })()}

          {data.rows.length === 0 ? (
            <p className="panel-empty">No customers match these filters.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table comp-table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Location</th>
                    <th scope="col">Followers</th>
                    <th scope="col">State</th>
                    <th scope="col">Authority gap</th>
                    <th scope="col">Publishing Rate</th>
                    <th scope="col">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => {
                    return (
                      <tr
                        key={row.id}
                        className={`cust-row${selectedId === row.id ? ' cust-row--active' : ''}`}
                        onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                      >
                        <td>
                          <div className="comp-ident">
                            <span className="comp-avatar" aria-hidden="true">{initials(row.name)}</span>
                            <div>
                              <span className="comp-name">{row.name}</span>
                              <span className="comp-handle">@{row.instagramUsername}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="comp-loc">{row.location.country}</span>
                          <span className="comp-loc-city">{row.location.city}</span>
                        </td>
                        <td className="num">
                          {row.latestFollowerCount != null ? `${(row.latestFollowerCount / 1000).toFixed(1)}K` : '—'}
                        </td>
                        <td>
                          <span className={`lifecycle-tag lifecycle-tag--${row.lifecycle}`}>
                            {lifecycleLabels[row.lifecycle].label}
                          </span>
                          <span className="cust-last-seen">
                            {row.daysSinceActivity === 0
                              ? 'today'
                              : `${row.daysSinceActivity}d ago`}
                          </span>
                        </td>
                        <td>{renderGap(row, query.pillar)}</td>
                        <td className="num">{row.publishingRate}%</td>
                        <td className="cust-trend">
                          <Sparkline
                            data={row.trendSeries}
                            color={row.periodDeltas.followers < 0 ? 'var(--negative)' : 'var(--positive)'}
                          />
                          <span
                            className={`cust-trend-delta cust-trend-delta--${
                              row.periodDeltas.followers > 0
                                ? 'positive'
                                : row.periodDeltas.followers < 0
                                  ? 'negative'
                                  : 'neutral'
                            }`}
                          >
                            {row.periodDeltas.followers > 0 ? '+' : ''}
                            {row.periodDeltas.followers}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="comp-pagination">
            <span className="comp-pagination-info">
              Showing {data.rows.length === 0 ? 0 : (data.page - 1) * query.pageSize + 1}–
              {(data.page - 1) * query.pageSize + data.rows.length} of {data.total} customers
            </span>
            <div className="comp-pagination-controls">
              <button type="button" disabled={data.page <= 1} onClick={() => setQuery({ ...query, page: data.page - 1 })} aria-label="Previous page">‹</button>
              <span>{data.page} / {data.pageCount}</span>
              <button type="button" disabled={data.page >= data.pageCount} onClick={() => setQuery({ ...query, page: data.page + 1 })} aria-label="Next page">›</button>
            </div>
          </div>
        </div>

        <div className="cust-bottom">
          <section className="panel" aria-labelledby="funnel-title">
            <div className="panel-head">
              <h2 id="funnel-title">User journey</h2>
              <span className="panel-head-note">
                where customers progress and drop off · select a step for detail
              </span>
            </div>
            <ol className="journey">
              {data.funnel.map((f, i) => {
                const entered = data.funnel[0].count
                const previous = i > 0 ? data.funnel[i - 1].count : 0
                const pct = entered > 0 ? Math.round((f.count / entered) * 100) : 0
                const dropped = i > 0 ? previous - f.count : 0
                const dropPct = previous > 0 ? Math.round((dropped / previous) * 100) : 0
                const worst =
                  dropped > 0 &&
                  dropped ===
                    Math.max(
                      ...data.funnel.map((s, j) => (j > 0 ? data.funnel[j - 1].count - s.count : 0)),
                    )
                return (
                  <li key={f.stage}>
                    <button
                      type="button"
                      className={`journey-step${worst ? ' journey-step--worst' : ''}`}
                      onClick={() => setStage({ stage: f, index: i })}
                    >
                      <span className="journey-index" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="journey-label">{f.stage}</span>
                      <span className="journey-bar">
                        <span className="journey-bar-fill" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="journey-count">
                        {f.count}
                        <span className="journey-pct">{pct}%</span>
                      </span>
                      <span className="journey-drop">
                        {dropped > 0 ? (
                          <>
                            −{dropped}
                            <span className="journey-drop-pct">{dropPct}% lost</span>
                          </>
                        ) : (
                          <span className="journey-drop-none">entry point</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="panel-foot-note">
              Biggest drop highlighted in red. Percentages are of the customers who reached the
              previous step.
            </p>
          </section>

          <section className="panel" aria-labelledby="adoption-title">
            <div className="panel-head">
              <h2 id="adoption-title">Content Adoption</h2>
              <span className="panel-head-note">Last 30 days · all customers</span>
            </div>
            <p className="adoption-total">
              Generated content delivered <strong>{data.adoption.delivered}</strong>
            </p>
            {(
              [
                ['Accepted', data.adoption.accepted, 'positive'],
                ['Edited', data.adoption.edited, 'info'],
                ['Rejected', data.adoption.rejected, 'negative'],
                ['Published', data.adoption.published, 'accent'],
              ] as const
            ).map(([label, value, tone]) => (
              <div className="adoption-row" key={label}>
                <span className="adoption-label">{label}</span>
                <div className="adoption-bar">
                  <div className={`adoption-fill adoption-fill--${tone}`} style={{ width: `${data.adoption.delivered > 0 ? Math.round((value / data.adoption.delivered) * 100) : 0}%` }} />
                </div>
                <span className="adoption-value">
                  {value} ({data.adoption.delivered > 0 ? Math.round((value / data.adoption.delivered) * 100) : 0}%)
                </span>
              </div>
            ))}
            <p className="panel-foot-note">
              A falling edit rate is not automatically positive — always cross-check with review
              completion and publication rate.
            </p>
          </section>
        </div>
        </>
        )}
      </div>

      {selected && <CustomerDetail customer={selected} onClose={() => setSelectedId(null)} />}

      {stage && (
        <Modal
          title={`${stage.stage.stage} — where customers drop off`}
          subtitle={`Step ${stage.index + 1} of ${data.funnel.length} · happens in: ${stage.stage.where}`}
          onClose={() => setStage(null)}
        >
          {stage.index > 0 && (
            <div className="drop-summary">
              <div className="drop-flow">
                <div className="drop-flow-node">
                  <strong>{data.funnel[stage.index - 1].count}</strong>
                  <span>reached {data.funnel[stage.index - 1].stage}</span>
                </div>
                <div className="drop-flow-arrow" aria-hidden="true">
                  →
                </div>
                <div className="drop-flow-node drop-flow-node--lost">
                  <strong>
                    −{data.funnel[stage.index - 1].count - stage.stage.count}
                  </strong>
                  <span>
                    dropped here (
                    {Math.round(
                      ((data.funnel[stage.index - 1].count - stage.stage.count) /
                        data.funnel[stage.index - 1].count) *
                        100,
                    )}
                    %)
                  </span>
                </div>
                <div className="drop-flow-arrow" aria-hidden="true">
                  →
                </div>
                <div className="drop-flow-node drop-flow-node--kept">
                  <strong>{stage.stage.count}</strong>
                  <span>continued</span>
                </div>
              </div>
            </div>
          )}

          <div className="stage-detail-grid">
            <div className="stage-detail-metric">
              <span>Median time in step</span>
              <strong>{stage.stage.medianTime}</strong>
            </div>
            <div className="stage-detail-metric">
              <span>Returned after leaving</span>
              <strong>{stage.stage.returnRate}%</strong>
            </div>
          </div>

          <h3 className="rail-title">Why customers left, and where</h3>
          {stage.stage.exits.length === 0 ? (
            <p className="panel-empty">
              No drop-off before this step — it is the journey entry point.
            </p>
          ) : (
            <ul className="stage-exit-list">
              {stage.stage.exits.map((e) => (
                <li key={e.reason}>
                  <span>
                    {e.reason}
                    <span className="stage-exit-where">Last seen: {e.where}</span>
                  </span>
                  <strong>{e.count}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="panel-foot-note">
            Derived from product events. Counts are customers, not sessions — a customer who left
            and returned is counted once.
          </p>
        </Modal>
      )}
    </div>
  )
}
