import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  defaultEarlyAccessQuery,
  listEarlyAccessRequests,
  type EarlyAccessQuery,
} from '../../services/earlyAccess/repository'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import { EarlyAccessIcon } from '../../components/icons'
import '../intelligence/intelligence.css'
import '../competitors/competitors.css'
import './earlyAccess.css'

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
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function EarlyAccessPage() {
  const [query, setQuery] = useState<EarlyAccessQuery>(defaultEarlyAccessQuery)

  const list = useQuery({
    queryKey: ['early-access', query],
    queryFn: () => listEarlyAccessRequests(query),
  })

  const rows = list.data?.rows ?? []

  return (
    <div className="ea-page">
      {list.data && (
        <div className="comp-stats-row ea-stats">
          <StatCard
            icon={<EarlyAccessIcon />}
            tone="orange"
            label="Early access requests"
            value={list.data.total}
            detail="from the login page"
          />
        </div>
      )}

      <div className="comp-filters" role="search">
        <input
          type="search"
          className="comp-search"
          placeholder="Search by name or Instagram handle…"
          aria-label="Search early access requests"
          value={query.search}
          onChange={(e) => setQuery({ ...query, search: e.target.value, page: 1 })}
        />
      </div>

      <div className="panel">
        {list.isPending || !list.data ? (
          <div className="dashboard-loading" role="status" aria-label="Loading early access requests">
            {Array.from({ length: 3 }, (_, i) => (
              <div className="skeleton-card" key={i} />
            ))}
          </div>
        ) : list.isError ? (
          <EmptyState
            icon={<EarlyAccessIcon />}
            title="Could not load requests"
            description="Refresh the page and try again."
          />
        ) : rows.length === 0 ? (
          <p className="panel-empty">
            {query.search
              ? 'No requests match that search.'
              : 'No early access requests yet.'}
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Instagram</th>
                    <th>Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="comp-ident">
                          <span className="comp-avatar" aria-hidden="true">
                            {initials(row.name || row.instagramHandle)}
                          </span>
                          <div>
                            <div className="comp-name">{row.name || 'Unnamed'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {row.instagramHandle ? (
                          <a
                            className="ea-handle"
                            href={`https://instagram.com/${row.instagramHandle}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            @{row.instagramHandle}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className="ea-date">{formatDate(row.createdAt)}</span>
                        {formatTime(row.createdAt) && (
                          <span className="ea-time">{formatTime(row.createdAt)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {list.data.pageCount > 1 && (
              <div className="comp-pagination">
                <span className="comp-pagination-info">
                  Page {list.data.page} of {list.data.pageCount}
                </span>
                <div className="comp-pagination-controls">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={query.page <= 1}
                    onClick={() => setQuery({ ...query, page: query.page - 1 })}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={query.page >= list.data.pageCount}
                    onClick={() => setQuery({ ...query, page: query.page + 1 })}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
