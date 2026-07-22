import type { CompetitorListResult, CompetitorQuery } from '../../services/competitors/repository'
import { PeriodFilter } from '../../components/PeriodFilter'

/* Table + filter row + pagination for the competitor list. */

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase()
}

export function CompetitorFilterRow({
  query,
  onChange,
}: {
  query: CompetitorQuery
  onChange: (q: CompetitorQuery) => void
}) {
  const set = <K extends keyof CompetitorQuery>(key: K, value: CompetitorQuery[K]) =>
    onChange({ ...query, [key]: value, page: 1 })
  const hasFilters =
    query.search !== '' || query.country !== 'all' || query.followerRange !== 'all'

  return (
    <div className="comp-filters" role="group" aria-label="Competitor filters">
      <input
        type="search"
        className="comp-search"
        placeholder="Search by username, name or website…"
        aria-label="Search competitors"
        value={query.search}
        onChange={(e) => set('search', e.target.value)}
      />
      <div className="filter-field">
        <label htmlFor="f-country">Location</label>
        <select id="f-country" value={query.country} onChange={(e) => set('country', e.target.value)}>
          {['all', 'Spain', 'Netherlands', 'Germany', 'Denmark'].map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'All' : c}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-field">
        <label htmlFor="f-followers">Follower Range</label>
        <select
          id="f-followers"
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
      <PeriodFilter id="f-period" value={query.period} onChange={(period) => set('period', period)} />
      {hasFilters && (
        <button
          type="button"
          className="filter-clear"
          onClick={() =>
            onChange({
              ...query,
              search: '',
              country: 'all',
              followerRange: 'all',
              page: 1,
            })
          }
        >
          Clear all
        </button>
      )}
    </div>
  )
}

export function CompetitorTable({
  result,
  query,
  onChange,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  activeId,
  onSelectRow,
  onShowRawJson,
}: {
  result: CompetitorListResult
  query: CompetitorQuery
  onChange: (q: CompetitorQuery) => void
  selected: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: () => void
  activeId: string | null
  onSelectRow: (id: string) => void
  onShowRawJson: (row: { id: string; username: string }) => void
}) {
  const sortBy = (col: CompetitorQuery['sort']) =>
    onChange({
      ...query,
      sort: col,
      sortDir: query.sort === col && query.sortDir === 'desc' ? 'asc' : 'desc',
      page: 1,
    })
  const sortIndicator = (col: CompetitorQuery['sort']) =>
    query.sort === col ? (query.sortDir === 'desc' ? ' ↓' : ' ↑') : ''
  const allOnPageSelected = result.rows.length > 0 && result.rows.every((r) => selected.has(r.id))

  return (
    <>
      <div className="table-scroll">
        <table className="data-table comp-table">
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label="Select all on page"
                  checked={allOnPageSelected}
                  onChange={onToggleSelectAll}
                />
              </th>
              <th scope="col">
                <button type="button" className="th-sort" onClick={() => sortBy('name')}>
                  Competitor{sortIndicator('name')}
                </button>
              </th>
              <th scope="col">
                <button type="button" className="th-sort" onClick={() => sortBy('followers')}>
                  Followers{sortIndicator('followers')}
                </button>
              </th>
              <th scope="col">Location</th>
              <th scope="col">
                <span className="visually-hidden">Raw data</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr
                key={row.id}
                className={`comp-row${activeId === row.id ? ' comp-row--active' : ''}`}
                onClick={() => onSelectRow(row.id)}
              >
                <td onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.displayName ?? row.username}`}
                    checked={selected.has(row.id)}
                    onChange={() => onToggleSelect(row.id)}
                  />
                </td>
                <td>
                  <div className="comp-ident">
                    <span className="comp-avatar" aria-hidden="true">
                      {initials(row.displayName ?? row.username)}
                    </span>
                    <div>
                      <span className="comp-name">{row.displayName}</span>
                      <span className="comp-handle">@{row.username}</span>
                    </div>
                  </div>
                </td>
                <td className="num">
                  {row.latestFollowerCount != null
                    ? row.latestFollowerCount >= 1000
                      ? `${(row.latestFollowerCount / 1000).toFixed(1)}K`
                      : row.latestFollowerCount
                    : '—'}
                </td>
                <td>
                  <span className="comp-loc">{row.location.country}</span>
                  <span className="comp-loc-city">{row.location.city}</span>
                </td>
                {/* Stop propagation: the row itself opens the detail panel. */}
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="rawjson-button"
                    onClick={() => onShowRawJson({ id: row.id, username: row.username })}
                    aria-label={`Show raw Apify JSON for @${row.username}`}
                    title="Raw Apify JSON"
                  >
                    JSON
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="comp-pagination">
        <span className="comp-pagination-info">
          Showing {result.rows.length === 0 ? 0 : (result.page - 1) * query.pageSize + 1}–
          {(result.page - 1) * query.pageSize + result.rows.length} of {result.total} competitors
        </span>
        <div className="comp-pagination-controls">
          <button
            type="button"
            disabled={result.page <= 1}
            onClick={() => onChange({ ...query, page: result.page - 1 })}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span>
            {result.page} / {result.pageCount}
          </span>
          <button
            type="button"
            disabled={result.page >= result.pageCount}
            onClick={() => onChange({ ...query, page: result.page + 1 })}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    </>
  )
}
