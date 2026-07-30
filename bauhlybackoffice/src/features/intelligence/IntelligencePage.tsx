import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { type FilterState } from '../../services/intelligence/filters'
import { periodToDays } from '../../services/intelligence/filterScope'
import { getDashboard, type DashboardData } from '../../services/intelligence/repository'
import {
  getCompetitorFilterCount,
  type CompetitorFilterCount,
} from '../../services/competitors/repository'
import {
  emptyCaptionAnalysis,
  getCaptionAnalysis,
} from '../../services/intelligence/captionPatterns'
import { USE_MOCKS } from '../../services/api'
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
 * Caption patterns come from the saved analysis only. Offline mock mode may
 * fill a local catalogue; live mode never invents patterns for a filter that
 * has no report.
 */

function DashboardBody({
  query,
  filters,
  filterCount,
  running,
  onRun,
}: {
  query: UseQueryResult<DashboardData>
  filters: FilterState
  filterCount?: CompetitorFilterCount
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
  // returns an empty dashboard. Offer the Run action rather than invented data.
  const hasReport = data.summary.accountsAnalyzed > 0
  if (!hasReport) {
    const windowDays = periodToDays(filters.period)
    // Only disable once we know the count; while it loads keep Run enabled.
    const posts = filterCount?.postsAvailable
    const noPosts = posts === 0
    const matching = filterCount?.matching ?? 0
    const description = filterCount
      ? `${matching.toLocaleString('en-US')} account${matching === 1 ? '' : 's'} match these filters · ` +
        `${(posts ?? 0).toLocaleString('en-US')} post${posts === 1 ? '' : 's'} available for analysis ` +
        `in the last ${windowDays} days.`
      : data.sampleLabel ||
        'Run analysis with the current filters to fill this overview from collected posts.'

    return (
      <EmptyState
        title="No competitor research for these filters"
        description={description}
        action={
          onRun ? (
            <div className="overview-empty-actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => onRun()}
                disabled={noPosts}
                title={noPosts ? 'No posts in this window to analyse' : undefined}
              >
                Run analysis
              </button>
              {noPosts && (
                <p className="section-note">
                  No posts in this window. Select these accounts on the Accounts tab and run Scrape
                  posts, then try again.
                </p>
              )}
            </div>
          ) : undefined
        }
      />
    )
  }

  // Live reports only show server-computed caption analysis. Offline mock mode
  // may fill the local catalogue; never invent patterns for a real empty scope.
  const caption =
    data.captionAnalysis ??
    (USE_MOCKS
      ? getCaptionAnalysis(filters)
      : emptyCaptionAnalysis(data.summary, filters.period))

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

  // Shares its cache with the FilterBar's match-count query (same key), so the
  // empty state can report accounts matched and posts available for analysis.
  const filterCount = useQuery({
    queryKey: [
      'competitor-filter-count',
      filters.location,
      filters.followerRangeLabel,
      filters.businessCategory,
      filters.period,
    ],
    queryFn: () =>
      getCompetitorFilterCount({
        location: filters.location,
        followerRangeLabel: filters.followerRangeLabel,
        businessCategory: filters.businessCategory,
        period: filters.period,
      }),
    staleTime: 30_000,
  })

  return (
    <div className="intelligence-main">
      <FilterBar filters={filters} onChange={onFiltersChange} />
      <DashboardBody
        query={query}
        filters={filters}
        filterCount={filterCount.data}
        running={running}
        onRun={onRun}
      />
    </div>
  )
}
