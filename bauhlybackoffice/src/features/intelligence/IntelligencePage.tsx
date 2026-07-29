import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { type FilterState } from '../../services/intelligence/filters'
import { getDashboard, type DashboardData } from '../../services/intelligence/repository'
import { getCaptionAnalysis } from '../../services/intelligence/captionPatterns'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from './FilterBar'
import { CaptionKpis, CaptionPatternAnalysis } from './CaptionPatternAnalysis'
import { HooksSection, HashtagsSection, TopicsSection } from './sections'
import './intelligence.css'

/*
 * The Competitors overview: a public-caption research view. It reports what
 * competitors publish and how often — frequency, prevalence and change — and
 * never engagement or performance, which public data cannot support.
 *
 * The caption-pattern analysis is produced server-side (stored on the dashboard
 * as `captionAnalysis`); when the backend hasn't computed one yet we fall back
 * to the deterministic local model so the view is never blank.
 */

function DashboardBody({
  query,
  filters,
  running,
  onRun,
}: {
  query: UseQueryResult<DashboardData>
  filters: FilterState
  running?: boolean
  onRun?: () => void
}) {
  const { data, isPending, isError, refetch } = query

  if (running) {
    return (
      <div className="analysis-loading panel" role="status" aria-live="polite">
        <span className="scrape-spinner" aria-hidden="true" />
        <p className="scrape-overlay-title">Running Claude analysis…</p>
        <p className="scrape-overlay-detail">
          Condensing {filters.location} · {filters.followerRangeLabel} · {filters.businessCategory} ·{' '}
          {filters.period}, then analysing in batches. Larger registers take a few minutes.
        </p>
      </div>
    )
  }

  if (isError) {
    return (
      <EmptyState
        title="Couldn't load the research view"
        description="Something went wrong computing the competitor research."
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
      <div className="dashboard-loading" role="status" aria-label="Loading research">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="skeleton-card" key={i} />
        ))}
      </div>
    )
  }

  // The overview never runs analysis itself, but a scope with no saved report
  // returns an empty dashboard. Offer the Run action rather than an empty grid.
  const hasReport = data.summary.accountsAnalyzed > 0
  if (!hasReport && onRun) {
    return (
      <EmptyState
        title="No competitor research for these filters"
        description={
          data.sampleLabel ||
          'Run analysis with the current filters to fill this overview from collected posts.'
        }
        action={
          <button type="button" className="btn-primary" onClick={() => onRun()}>
            Run analysis
          </button>
        }
      />
    )
  }

  // Prefer the server-computed caption analysis; fall back to the local model so
  // the surface is populated even before a report exists.
  const caption = data.captionAnalysis ?? getCaptionAnalysis(filters)

  return (
    <div className="dashboard">
      <CaptionKpis kpis={caption.kpis} />
      <CaptionPatternAnalysis
        analysis={caption}
        patternLimit={5}
        showAllHref="/competitors-patterns"
      />
      <div className="dashboard-grid">
        <HooksSection hooks={data.hooks} limit={5} fullHref="/competitors-hooks" />
        <TopicsSection topics={data.topics} limit={5} fullHref="/competitors-topics" />
        <HashtagsSection
          hashtags={data.hashtags}
          basis={data.hashtagBasis}
          limit={5}
          fullHref="/competitors-hashtags"
        />
      </div>
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
  onRun?: () => void
}) {
  const query = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => getDashboard(filters),
    enabled: !running,
  })

  return (
    <div className="intelligence-main">
      <FilterBar filters={filters} onChange={onFiltersChange} />
      <DashboardBody query={query} filters={filters} running={running} onRun={onRun} />
    </div>
  )
}
