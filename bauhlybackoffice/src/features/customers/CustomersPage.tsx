import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultCustomerQuery,
  getCustomerDetail,
  listCustomers,
  updateCustomerCohort,
  type CustomerCohort,
  type CustomerQuery,
  type CustomerWeeklyPlan,
} from '../../services/customers/liveRepository'
import { getCompetitorLocations } from '../../services/competitors/repository'
import { filterOptions } from '../../services/intelligence/filters'
import { ApiError } from '../../services/api'
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

function formatFollowers(n: number | null | undefined): string {
  if (n == null) return ''
  return ` · ${n.toLocaleString('en-US')}`
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
    <section className="weekly-plan" aria-labelledby={`weekly-plan-title-${plan.id}`}>
      <div className="panel-head weekly-plan-head">
        <h2 id={`weekly-plan-title-${plan.id}`}>
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

/**
 * Assign a competitor cohort — Business Type + Location — to one Instagram
 * handle on this customer. Remounted per handle (keyed by customer+username)
 * so the selects reset when switching accounts.
 */
function CohortEditor({
  customerId,
  handle,
  cohort,
}: {
  customerId: string
  handle: string
  cohort: Pick<CustomerCohort, 'businessCategory' | 'location'> | null
}) {
  const queryClient = useQueryClient()
  const [businessCategory, setBusinessCategory] = useState(
    cohort?.businessCategory ?? 'interior-designer',
  )
  const [location, setLocation] = useState(cohort?.location ?? 'Global')

  const locations = useQuery({
    queryKey: ['competitor-locations'],
    queryFn: getCompetitorLocations,
    staleTime: 60_000,
  })
  const locationOptions = ['Global', ...(locations.data ?? [])]
  if (location && !locationOptions.includes(location)) locationOptions.push(location)

  const mutation = useMutation({
    mutationFn: () =>
      updateCustomerCohort(customerId, {
        businessCategory,
        location,
        instagramUsername: handle,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] })
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  // Unassigned handles are always "dirty" so Assign works with the default
  // dropdown values; assigned ones only enable Update when something changed.
  const dirty =
    cohort == null ||
    businessCategory !== cohort.businessCategory ||
    location !== cohort.location
  const fieldId = `${customerId}-${handle}`
  const businessLabel = cohort
    ? (filterOptions.businessCategory.find((o) => o.value === cohort.businessCategory)?.label ??
      cohort.businessCategory)
    : null

  return (
    <section className="weekly-plan cohort-editor">
      <div className="panel-head weekly-plan-head">
        <h2>Competitor cohort · @{handle}</h2>
      </div>

      {cohort ? (
        <p className="section-note cohort-status cohort-status--assigned">
          Assigned · {businessLabel} · {cohort.location}
        </p>
      ) : (
        <p className="section-note cohort-status cohort-status--empty">
          No cohort assigned — choose a business type and location below, then assign.
        </p>
      )}

      <div className="cohort-editor-fields">
        <div className="filter-field">
          <label htmlFor={`cohort-business-type-${fieldId}`}>Business type</label>
          <select
            id={`cohort-business-type-${fieldId}`}
            value={businessCategory}
            onChange={(e) => setBusinessCategory(e.target.value)}
          >
            {filterOptions.businessCategory.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-field">
          <label htmlFor={`cohort-location-${fieldId}`}>Location</label>
          <select
            id={`cohort-location-${fieldId}`}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          >
            {locationOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Saving…' : cohort ? 'Update cohort' : 'Assign cohort'}
        </button>
      </div>
      {mutation.isError && (
        <p className="section-note cohort-editor-error">
          {mutation.error instanceof ApiError
            ? mutation.error.message
            : 'Could not save the cohort.'}
        </p>
      )}
      {mutation.isSuccess && cohort && !dirty && (
        <p className="section-note">Saved.</p>
      )}
    </section>
  )
}

export function CustomersPage() {
  const [query, setQuery] = useState<CustomerQuery>(defaultCustomerQuery)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null)

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
  }, [selectedId, selectedHandle, detail.isPending, detail.dataUpdatedAt])

  function selectAccount(customerId: string, handle: string | null) {
    const same =
      selectedId === customerId &&
      (selectedHandle ?? null) === (handle ?? null)
    if (same) {
      setSelectedId(null)
      setSelectedHandle(null)
      return
    }
    setSelectedId(customerId)
    setSelectedHandle(handle)
  }

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
  const selectedRow = rows.find(
    (r) =>
      r.id === selectedId &&
      (r.instagramUsername ?? null) === (selectedHandle ?? null),
  )
  const profiles = detail.data?.profiles ?? []
  const activeProfile = selectedHandle
    ? profiles.find((p) => p.username.toLowerCase() === selectedHandle.toLowerCase())
    : profiles[0]
  const weeklyPlans =
    detail.data?.weeklyPlans?.length
      ? detail.data.weeklyPlans
      : detail.data?.weeklyPlan
        ? [detail.data.weeklyPlan]
        : []
  const activePlan = selectedHandle
    ? weeklyPlans.find(
        (p) => p.instagramUsername.toLowerCase() === selectedHandle.toLowerCase(),
      ) ?? null
    : weeklyPlans[0] ?? null

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
                  {rows.map((row) => {
                    const isActive =
                      selectedId === row.id &&
                      (selectedHandle ?? null) === (row.instagramUsername ?? null)
                    return (
                      <tr
                        key={`${row.id}:${row.instagramUsername ?? '_'}`}
                        className={[
                          'cust-row',
                          isActive ? 'cust-row--active' : '',
                          row.sameUserContinuation ? 'cust-row--continuation' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => selectAccount(row.id, row.instagramUsername)}
                      >
                        <td>
                          {row.sameUserContinuation ? (
                            <div className="comp-ident cust-ident--continued">
                              <span className="cust-continued-mark" aria-hidden="true" />
                              <div>
                                <div className="comp-name cust-continued-name">
                                  {row.name || 'Unnamed'}
                                </div>
                                <div className="comp-handle">same account</div>
                              </div>
                            </div>
                          ) : (
                            <div className="comp-ident">
                              <span className="comp-avatar" aria-hidden="true">
                                {initials(row.name || row.email)}
                              </span>
                              <div>
                                <div className="comp-name">{row.name || 'Unnamed'}</div>
                                <div className="comp-handle">{row.email}</div>
                              </div>
                            </div>
                          )}
                        </td>
                        <td>
                          {row.instagramUsername ? (
                            <>
                              @{row.instagramUsername}
                              {formatFollowers(row.followersCount)}
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
                    )
                  })}
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
            <p className="section-note">Loading customer…</p>
          </div>
        )}

        {selectedId && detail.isError && (
          <div className="weekly-plan" role="alert" ref={planRef}>
            <div className="panel-head weekly-plan-head">
              <h2>Customer detail</h2>
            </div>
            <p className="section-note">
              Couldn’t load this customer.
              {detail.error instanceof Error ? ` ${detail.error.message}` : ''}
            </p>
            <button type="button" className="btn-secondary" onClick={() => detail.refetch()}>
              Retry
            </button>
          </div>
        )}

        {selectedId && detail.data && !detail.isPending && !detail.isError && (
          <div ref={planRef}>
            {!selectedHandle || !activeProfile ? (
              <section className="weekly-plan">
                <div className="panel-head weekly-plan-head">
                  <h2>Competitor cohort</h2>
                </div>
                <p className="section-note">
                  This customer has no Instagram account connected yet.
                </p>
              </section>
            ) : (
              <CohortEditor
                key={`${selectedId}:${activeProfile.username}`}
                customerId={selectedId}
                handle={activeProfile.username}
                cohort={activeProfile.cohort ?? null}
              />
            )}

            {activePlan ? (
              <WeeklyPlanCalendar
                plan={activePlan}
                customerName={detail.data.name || selectedRow?.name || ''}
                handle={activePlan.instagramUsername || selectedHandle}
              />
            ) : (
              <section className="weekly-plan">
                <div className="panel-head weekly-plan-head">
                  <h2>
                    Recommended weekly plan —{' '}
                    {selectedHandle ? `@${selectedHandle}` : detail.data.name || 'Customer'}
                  </h2>
                </div>
                <p className="section-note">
                  No weekly plan has been presented for this Instagram account yet.
                </p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
