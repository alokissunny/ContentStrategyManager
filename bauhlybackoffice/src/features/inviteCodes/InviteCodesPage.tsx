import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  defaultInviteQuery,
  deleteInviteCode,
  generateInviteCodes,
  listInviteCodes,
  setInviteRevoked,
  type InviteCodeRow,
  type InviteQuery,
} from '../../services/inviteCodes/repository'
import { ApiError } from '../../services/api'
import { EmptyState } from '../../components/EmptyState'
import { StatCard } from '../../components/StatCard'
import { CheckCircleIcon, InviteIcon, TrashIcon } from '../../components/icons'
import '../intelligence/intelligence.css'
import '../competitors/competitors.css'
import './inviteCodes.css'

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const STATUS_LABEL = { unused: 'Unused', used: 'Used', revoked: 'Revoked' } as const

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/* Admins make invitation codes here and hand them out; each one creates a single Bauhly account. */
export function InviteCodesPage() {
  const qc = useQueryClient()
  const [query, setQuery] = useState<InviteQuery>(defaultInviteQuery)
  const [count, setCount] = useState(5)
  const [note, setNote] = useState('')
  const [fresh, setFresh] = useState<InviteCodeRow[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  const list = useQuery({ queryKey: ['invite-codes', query], queryFn: () => listInviteCodes(query) })
  const refresh = () => qc.invalidateQueries({ queryKey: ['invite-codes'] })

  const generate = useMutation({
    mutationFn: () => generateInviteCodes({ count, note }),
    onSuccess: (rows) => {
      setFresh(rows)
      setNote('')
      refresh()
    },
  })
  const revoke = useMutation({
    mutationFn: ({ id, revoked }: { id: string; revoked: boolean }) => setInviteRevoked(id, revoked),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => deleteInviteCode(id), onSuccess: refresh })

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      /* clipboard blocked: the codes are still on screen */
    }
  }

  const rows = list.data?.rows ?? []
  const actionError = revoke.error || remove.error

  return (
    <div className="ic-page">
      {list.data && (
        <div className="comp-stats-row ic-stats">
          <StatCard icon={<InviteIcon />} tone="green" label="Unused" value={list.data.counts.unused} detail="ready to hand out" />
          <StatCard icon={<CheckCircleIcon />} tone="blue" label="Used" value={list.data.counts.used} detail="accounts created" />
          <StatCard icon={<TrashIcon />} tone="slate" label="Revoked" value={list.data.counts.revoked} detail="no longer accepted" />
        </div>
      )}

      <form
        className="panel ic-generate"
        onSubmit={(e) => {
          e.preventDefault()
          generate.mutate()
        }}
      >
        <div className="ic-generate-head">
          <h3>Generate invitation codes</h3>
          <p className="section-note">4 letters/digits each. A code creates one account and then stops working.</p>
        </div>
        <div className="ic-generate-fields">
          <div className="filter-field">
            <label htmlFor="ic-count">How many</label>
            <input
              id="ic-count"
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>
          <div className="filter-field ic-note-field">
            <label htmlFor="ic-note">Note (optional)</label>
            <input
              id="ic-note"
              type="text"
              maxLength={200}
              placeholder="Who or what these are for"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-primary" disabled={generate.isPending}>
            {generate.isPending ? 'Generating…' : `Generate ${count === 1 ? 'code' : `${count} codes`}`}
          </button>
        </div>
        {generate.isError && <p className="section-note ic-error">{errorText(generate.error, 'Could not generate codes.')}</p>}
        {fresh.length > 0 && (
          <div className="ic-fresh" role="status">
            <div className="ic-fresh-codes">
              {fresh.map((r) => (
                <code key={r.id}>{r.code}</code>
              ))}
            </div>
            <button type="button" className="btn-secondary" onClick={() => copy(fresh.map((r) => r.code).join('\n'), 'fresh')}>
              {copied === 'fresh' ? 'Copied' : 'Copy all'}
            </button>
          </div>
        )}
      </form>

      <div className="comp-filters" role="search">
        <input
          type="search"
          className="comp-search"
          placeholder="Search by code, note or email…"
          aria-label="Search invitation codes"
          value={query.search}
          onChange={(e) => setQuery({ ...query, search: e.target.value, page: 1 })}
        />
        <div className="filter-field">
          <label htmlFor="ic-status">Status</label>
          <select
            id="ic-status"
            value={query.status}
            onChange={(e) => setQuery({ ...query, status: e.target.value as InviteQuery['status'], page: 1 })}
          >
            <option value="all">All</option>
            <option value="unused">Unused</option>
            <option value="used">Used</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
      </div>

      {actionError && <p className="section-note ic-error">{errorText(actionError, 'That change did not go through.')}</p>}

      <div className="panel">
        {list.isPending ? (
          <div className="dashboard-loading" role="status" aria-label="Loading invitation codes">
            {Array.from({ length: 3 }, (_, i) => (
              <div className="skeleton-card" key={i} />
            ))}
          </div>
        ) : list.isError || !list.data ? (
          <EmptyState icon={<InviteIcon />} title="Could not load invitation codes" description="Refresh the page and try again." />
        ) : rows.length === 0 ? (
          <p className="panel-empty">
            {query.search || query.status !== 'all' ? 'No codes match these filters.' : 'No invitation codes yet. Generate some above.'}
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Note</th>
                    <th>Used by</th>
                    <th>Created</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <button
                          type="button"
                          className="ic-code"
                          title="Copy code"
                          onClick={() => copy(row.code, row.id)}
                        >
                          {row.code}
                          <span className="ic-copied">{copied === row.id ? 'Copied' : ''}</span>
                        </button>
                      </td>
                      <td>
                        <span className={`ic-status ic-status--${row.status}`}>{STATUS_LABEL[row.status]}</span>
                      </td>
                      <td className="ic-note">{row.note || '—'}</td>
                      <td>
                        {row.status === 'used' ? (
                          <>
                            <span className="ic-email">{row.usedByEmail || '—'}</span>
                            <span className="ic-sub">{formatDate(row.usedAt)}</span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <span className="ic-date">{formatDate(row.createdAt)}</span>
                        {row.createdBy && <span className="ic-sub">{row.createdBy}</span>}
                      </td>
                      <td className="ic-actions">
                        {row.status !== 'used' && (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={revoke.isPending}
                              onClick={() => revoke.mutate({ id: row.id, revoked: row.status === 'unused' })}
                            >
                              {row.status === 'unused' ? 'Revoke' : 'Restore'}
                            </button>
                            <button
                              type="button"
                              className="icon-button"
                              aria-label={`Delete code ${row.code}`}
                              disabled={remove.isPending}
                              onClick={() => {
                                if (window.confirm(`Delete code ${row.code}? This cannot be undone.`)) remove.mutate(row.id)
                              }}
                            >
                              <TrashIcon />
                            </button>
                          </>
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
                  <button type="button" className="btn-secondary" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>
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
