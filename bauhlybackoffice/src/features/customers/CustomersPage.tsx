import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  defaultCustomerQuery,
  getCustomerDetail,
  listCustomers,
  type CustomerQuery,
  type CustomerWeeklyPlan,
} from '../../services/customers/liveRepository'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import { CustomersIcon } from '../../components/icons'
import './customers.css'

const PILLAR_LABELS: Record<string, string> = {
  discovery: 'Discovery',
  credibility: 'Credibility',
  trust: 'Trust',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function pillarLabel(pillar: string | null | undefined): string {
  if (!pillar) return '—'
  const key = pillar.toLowerCase()
  return PILLAR_LABELS[key] ?? pillar.charAt(0).toUpperCase() + pillar.slice(1)
}

function shortDay(day: string): string {
  const trimmed = day.trim()
  if (/^(mon|tue|wed|thu|fri|sat|sun)/i.test(trimmed)) return trimmed.slice(0, 3)
  return trimmed.slice(0, 3)
}

/**
 * Calendar view of the weekly plan presented to the customer — Mon–Fri cards
 * with time, pillar, title and format (matches the Recommended weekly plan mock).
 */
function WeeklyPlanCalendar({
  plan,
  customerName,
  handle,
}: {
  plan: CustomerWeeklyPlan
  customerName: string
  handle: string | null
}) {
  const focusPillar = plan.focus?.pillar ? pillarLabel(plan.focus.pillar) : null

  return (
    <section className="weekly-plan" aria-labelledby="weekly-plan-title">
      <div className="panel-head weekly-plan-head">
        <h2 id="weekly-plan-title">
          Recommended weekly plan — {customerName || 'Customer'}
          {plan.weekLabel ? ` · ${plan.weekLabel}` : ''}
        </h2>
      </div>

      {plan.focus && (
        <div className="plan-focus">
          <p className="plan-focus-line">
            <span className="plan-focus-label">
              This week focuses on {focusPillar}
              {plan.focus.headline ? ` — ${plan.focus.headline}` : ''}
            </span>
          </p>
          {(plan.focus.recommendation || plan.focus.whyMatters || plan.focus.observation) && (
            <p className="plan-focus-explain">
              {plan.focus.recommendation || plan.focus.whyMatters || plan.focus.observation}
            </p>
          )}
        </div>
      )}

      {plan.days.some((d) => d.time) && (
        <div className="plan-timing-note">
          <span>Scheduled posting times from the plan presented to this customer</span>
        </div>
      )}

      {plan.days.length === 0 ? (
        <p className="section-note">This plan has no scheduled days.</p>
      ) : (
        <div className="plan-grid" role="list">
          {plan.days.map((day, i) => {
            const pillar = (day.pillar || 'discovery').toLowerCase()
            return (
              <div className="plan-day" role="listitem" key={`${day.day}-${i}`}>
                <div className="plan-day-head">
                  <span className="plan-day-name">{shortDay(day.day)}</span>
                  <span className="plan-day-time">{day.time || '—'}</span>
                </div>
                {day.dateLabel && <span className="plan-activity-label">{day.dateLabel}</span>}
                <span className={`pillar-tag pillar-tag--${pillar}`}>{pillarLabel(pillar)}</span>
                <p className="plan-content">{day.title || day.contentType || 'Untitled'}</p>
                <p className="plan-format">
                  {day.format}
                  {day.published ? ' · published' : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}

      <p className="panel-foot-note weekly-plan-basis">
        {handle ? `@${handle}` : customerName}
        {plan.generatedAt ? ` · presented ${formatDate(plan.generatedAt)}` : ''}
        {plan.instagramUsername ? ` · plan for @${plan.instagramUsername}` : ''}
      </p>
    </section>
  )
}

export function CustomersPage() {
  const [query, setQuery] = useState<CustomerQuery>(defaultCustomerQuery)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['customers', query],
    queryFn: () => listCustomers(query),
    placeholderData: (prev) => prev,
  })

  const detail = useQuery({
    queryKey: ['customer-detail', selectedId],
    queryFn: () => (selectedId ? getCustomerDetail(selectedId) : null),
    enabled: selectedId != null,
  })

  const planRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId) return
    if (detail.isPending) return
    planRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId, detail.isPending, detail.dataUpdatedAt])

  if (list.isError) {
    return (
      <EmptyState
        title="Couldn't load customers"
        description="Something went wrong loading Bauhly signups."
        action={
          <button type="button" className="filter-clear" onClick={() => list.refetch()}>
            Retry
          </button>
        }
      />
    )
  }

  const stats = list.data?.stats
  const rows = list.data?.rows ?? []
  const selectedRow = rows.find((r) => r.id === selectedId)

  return (
    <div className="cust-layout">
      <div className="cust-main">
        {stats && (
          <div className="comp-stats-row">
            <StatCard
              icon={<CustomersIcon />}
              tone="blue"
              label="Total customers"
              value={stats.totalSignedUp}
              detail="signed up in Bauhly"
            />
          </div>
        )}

        <div className="comp-filters" role="search">
          <input
            type="search"
            className="comp-search"
            placeholder="Search by name or email…"
            aria-label="Search customers"
            value={query.search}
            onChange={(e) => setQuery({ ...query, search: e.target.value, page: 1 })}
          />
        </div>

        <div className="panel">
          {list.isPending || !list.data ? (
            <div className="dashboard-loading" role="status" aria-label="Loading customers">
              {Array.from({ length: 3 }, (_, i) => (
                <div className="skeleton-card" key={i} />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="panel-empty">No customers signed up yet.</p>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Instagram</th>
                    <th>Signed up</th>
                    <th>Weekly plan</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className={`cust-row${selectedId === row.id ? ' cust-row--active' : ''}`}
                      onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                    >
                      <td>
                        <div className="comp-ident">
                          <span className="comp-avatar" aria-hidden="true">
                            {initials(row.name || row.email)}
                          </span>
                          <div>
                            <div className="comp-name">{row.name || 'Unnamed'}</div>
                            <div className="comp-handle">{row.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {row.instagramUsername ? (
                          <>
                            @{row.instagramUsername}
                            {row.followersCount != null
                              ? ` · ${row.followersCount.toLocaleString('en-US')}`
                              : ''}
                          </>
                        ) : (
                          <span className="cust-stage">—</span>
                        )}
                      </td>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>
                        {row.hasWeeklyPlan ? (
                          <span className="cust-stage">
                            {row.weekLabel || 'Plan ready'}
                            {row.focusPillar ? ` · ${pillarLabel(row.focusPillar)}` : ''}
                          </span>
                        ) : (
                          <span className="cust-stage">Not presented</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {list.data.pageCount > 1 && (
                <div className="table-pager">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={query.page <= 1}
                    onClick={() => setQuery({ ...query, page: query.page - 1 })}
                  >
                    Previous
                  </button>
                  <span>
                    Page {list.data.page} of {list.data.pageCount}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={query.page >= list.data.pageCount}
                    onClick={() => setQuery({ ...query, page: query.page + 1 })}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {selectedId && detail.isPending && (
          <div className="weekly-plan" role="status" ref={planRef}>
            <p className="section-note">Loading weekly plan…</p>
          </div>
        )}

        {selectedId && detail.isError && (
          <div className="weekly-plan" role="alert" ref={planRef}>
            <div className="panel-head weekly-plan-head">
              <h2>Recommended weekly plan</h2>
            </div>
            <p className="section-note">
              Couldn’t load this customer’s weekly plan.
              {detail.error instanceof Error ? ` ${detail.error.message}` : ''}
            </p>
            <button type="button" className="btn-secondary" onClick={() => detail.refetch()}>
              Retry
            </button>
          </div>
        )}

        {selectedId && detail.data?.weeklyPlan && (
          <div ref={planRef}>
            <WeeklyPlanCalendar
              plan={detail.data.weeklyPlan}
              customerName={detail.data.name || selectedRow?.name || ''}
              handle={
                detail.data.profiles[0]?.username ??
                detail.data.weeklyPlan.instagramUsername ??
                selectedRow?.instagramUsername ??
                null
              }
            />
          </div>
        )}

        {selectedId && detail.data && !detail.data.weeklyPlan && !detail.isPending && !detail.isError && (
          <section className="weekly-plan" ref={planRef}>
            <div className="panel-head weekly-plan-head">
              <h2>Recommended weekly plan — {detail.data.name || 'Customer'}</h2>
            </div>
            <p className="section-note">No weekly plan has been presented to this customer yet.</p>
          </section>
        )}
      </div>
    </div>
  )
}
