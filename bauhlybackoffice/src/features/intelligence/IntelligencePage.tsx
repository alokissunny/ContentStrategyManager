import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { type FilterState } from '../../services/intelligence/filters'
import { getDashboard, type DashboardData } from '../../services/intelligence/repository'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from './FilterBar'
import {
  HooksSection,
  PatternMovementSection,
  HashtagsSection,
  StrongerAccounts,
  SummaryCards,
  TopicsSection,
  WeeklySection,
} from './sections'
import './intelligence.css'

function DashboardBody({
  query,
  filters,
  setFilters,
  running,
  onRun,
}: {
  query: UseQueryResult<DashboardData>
  filters: FilterState
  setFilters: (f: FilterState) => void
  running?: boolean
  onRun?: (filters: FilterState) => void
}) {
  const { data, isPending, isError, refetch } = query

  if (running) {
    return (
      <div className="analysis-loading panel" role="status" aria-live="polite">
        <span className="scrape-spinner" aria-hidden="true" />
        <p className="scrape-overlay-title">Running Claude analysis…</p>
        <p className="scrape-overlay-detail">
          Analysing {filters.location} · {filters.followerRangeLabel} · {filters.period} from
          collected posts. This usually takes about a minute.
        </p>
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load the dashboard"
        description="Something went wrong loading the intelligence view."
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
      <div className="dashboard-loading" role="status" aria-label="Loading dashboard">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="skeleton-card" key={i} />
        ))}
      </div>
    )
  }

  const empty =
    data.summary.accountsAnalyzed === 0 || data.findings.length + data.movements.length === 0

  return (
    <div className="dashboard">
      {!empty && <SummaryCards summary={data.summary} />}
      {empty ? (
        <EmptyState
          title="No competitor intelligence for these filters"
          description={
            data.sampleLabel ||
            'Run analysis with the current filters to fill this overview from collected posts.'
          }
          action={
            onRun ? (
              <button type="button" className="btn-primary" onClick={() => onRun(filters)}>
                Run analysis
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="dashboard-grid">
          <StrongerAccounts findings={data.findings} />
          <PatternMovementSection
            movements={data.movements}
            dimension={filters.dimension}
            onDimensionChange={(dimension) => setFilters({ ...filters, dimension })}
          />
          <HooksSection hooks={data.hooks} />
          <TopicsSection topics={data.topics} trendTopics={data.trendTopics} />
          <HashtagsSection hashtags={data.hashtags} basis={data.hashtagBasis} />
          <WeeklySection weekly={data.weekly} basis={data.weeklyBasis} />
        </div>
      )}
    </div>
  )
}

export function IntelligencePage({
  filters,
  onFiltersChange,
  running,
  onRun,
}: {
  filters: FilterState
  onFiltersChange: (f: FilterState) => void
  running?: boolean
  onRun?: (filters: FilterState) => void
}) {
  const query = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => getDashboard(filters),
    enabled: !running,
  })

  return (
    <div className="intelligence-main">
      <FilterBar filters={filters} onChange={onFiltersChange} />
      <DashboardBody
        query={query}
        filters={filters}
        setFilters={onFiltersChange}
        running={running}
        onRun={onRun}
      />
    </div>
  )
}
