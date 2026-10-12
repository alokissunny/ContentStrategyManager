import { Fragment, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultCustomerQuery,
  getCustomerDetail,
  listCustomers,
  updateCustomerCohort,
  type CustomerCohort,
  type CustomerQuery,
} from '../../services/customers/liveRepository'
import { getCompetitorLocations } from '../../services/competitors/repository'
import { filterOptions } from '../../services/intelligence/filters'
import { ApiError } from '../../services/api'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import { CustomersIcon, TrashIcon } from '../../components/icons'
import { CustomerActivityPanel } from './CustomerActivity'
import { DeleteCustomerModal } from './DeleteCustomerModal'
import './customers.css'

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


function formatFollowers(n: number | null | undefined): string {
  if (n == null) return ''
  return ` · ${n.toLocaleString('en-US')}`
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
  includeAdmins,
}: {
  customerId: string
  handle: string
  cohort: Pick<CustomerCohort, 'businessCategory' | 'location'> | null
  includeAdmins: boolean
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
      updateCustomerCohort(
        customerId,
        {
          businessCategory,
          location,
          instagramUsername: handle,
        },
        { includeAdmins },
      ),
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
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)
  const queryClient = useQueryClient()

  const list = useQuery({
    queryKey: ['customers', query],
    queryFn: () => listCustomers(query),
    placeholderData: (prev) => prev,
  })

  const detail = useQuery({
    queryKey: ['customer-detail', selectedId, query.includeAdmins],
    queryFn: () =>
      selectedId ? getCustomerDetail(selectedId, { includeAdmins: query.includeAdmins }) : null,
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
  const profiles = detail.data?.profiles ?? []
  const activeProfile = selectedHandle
    ? profiles.find((p) => p.username.toLowerCase() === selectedHandle.toLowerCase())
    : profiles[0]

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
                    <th className="cust-row-actions"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    // a customer with several Instagram accounts gets a row of
                    // its own (name, email, signup, delete); every account —
                    // the first included — is listed under it the same way
                    const multi = rows.filter((r) => r.id === row.id).length > 1
                    const opensGroup = multi && rows.findIndex((r) => r.id === row.id) === i
                    const continued = multi
                    const isActive =
                      selectedId === row.id &&
                      (selectedHandle ?? null) === (row.instagramUsername ?? null)
                    const deleteButton = (
                      <button
                        type="button"
                        className="cust-row-del"
                        title="Delete customer"
                        aria-label={`Delete ${row.name || row.email}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleting({ id: row.id, name: row.name || row.email })
                        }}
                      >
                        <TrashIcon />
                      </button>
                    )
                    const ident = (
                      <div className="comp-ident">
                        <span className="comp-avatar" aria-hidden="true">
                          {initials(row.name || row.email)}
                        </span>
                        <div>
                          <div className="comp-name">{row.name || 'Unnamed'}</div>
                          <div className="comp-handle">{row.email}</div>
                        </div>
                      </div>
                    )
                    const accounts = rows.filter((r) => r.id === row.id).length
                    return (
                      <Fragment key={`${row.id}:${row.instagramUsername ?? '_'}`}>
                        {opensGroup && (
                          <tr className="cust-row cust-row--group">
                            <td>{ident}</td>
                            <td><span className="cust-stage">{`${accounts} Instagram accounts`}</span></td>
                            <td>{formatDate(row.createdAt)}</td>
                            <td className="cust-row-actions">{deleteButton}</td>
                          </tr>
                        )}
                        <tr
                          className={[
                            'cust-row',
                            isActive ? 'cust-row--active' : '',
                            continued ? 'cust-row--continuation' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => selectAccount(row.id, row.instagramUsername)}
                        >
                          <td>
                            {continued ? (
                              <div className="comp-ident cust-ident--continued">
                                <span className="cust-continued-mark" aria-hidden="true" />
                                <div>
                                  <div className="comp-name cust-continued-name">
                                    {row.name || 'Unnamed'}
                                  </div>
                                  <div className="comp-handle">same account</div>
                                </div>
                              </div>
                            ) : ident}
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
                          <td className="cust-row-actions">{!continued && deleteButton}</td>
                        </tr>
                      </Fragment>
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
                includeAdmins={query.includeAdmins}
              />
            )}

            <CustomerActivityPanel
              key={`${selectedId}:${selectedHandle ?? '_'}`}
              customerId={selectedId}
              handle={selectedHandle}
              includeAdmins={query.includeAdmins}
            />
          </div>
        )}
      </div>

      {deleting && (
        <DeleteCustomerModal
          customerId={deleting.id}
          fallbackName={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            if (selectedId === deleting.id) {
              setSelectedId(null)
              setSelectedHandle(null)
            }
            queryClient.invalidateQueries({ queryKey: ['customers'] })
            queryClient.removeQueries({ queryKey: ['customer-detail', deleting.id] })
          }}
        />
      )}
    </div>
  )
}
