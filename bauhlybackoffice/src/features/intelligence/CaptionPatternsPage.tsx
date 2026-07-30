import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { defaultFilters, type FilterState } from '../../services/intelligence/filters'
import { getDashboard } from '../../services/intelligence/repository'
import {
  emptyCaptionAnalysis,
  getCaptionAnalysis,
} from '../../services/intelligence/captionPatterns'
import { USE_MOCKS } from '../../services/api'
import { EmptyState } from '../../components/EmptyState'
import { FilterBar } from './FilterBar'
import { CaptionPatternAnalysis } from './CaptionPatternAnalysis'
import './intelligence.css'

/*
 * The full Caption Pattern Analysis — every ranked pattern, not just the top
 * five shown on the overview. Uses the same saved analysis as the Overview;
 * never invents a catalogue when the live report has no caption patterns.
 */
export function CaptionPatternsPage() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const query = useQuery({
    queryKey: ['dashboard', filters],
    queryFn: () => getDashboard(filters),
  })
  const key = useMemo(() => JSON.stringify(filters), [filters])

  const caption = useMemo(() => {
    if (!query.data) return null
    return (
      query.data.captionAnalysis ??
      (USE_MOCKS
        ? getCaptionAnalysis(filters)
        : emptyCaptionAnalysis(query.data.summary, filters.period))
    )
  }, [query.data, filters])

  return (
    <div className="intelligence-main">
      <Link to="/competitors-overview" className="cap-back-link">
        ← Back to Competitors overview
      </Link>
      <FilterBar filters={filters} onChange={setFilters} />
      {query.isError ? (
        <EmptyState
          title="Couldn't load caption patterns"
          description="Something went wrong. Try again."
        />
      ) : query.isPending || !caption ? (
        <div className="dashboard-loading" role="status" aria-label="Loading caption patterns">
          <div className="skeleton-card" />
        </div>
      ) : query.data.summary.accountsAnalyzed <= 0 && !USE_MOCKS ? (
        <EmptyState
          title="No caption patterns for these filters"
          description="Run analysis on the Competitors overview with these filters to generate patterns from collected posts."
        />
      ) : (
        <div className="dashboard" key={key}>
          <CaptionPatternAnalysis analysis={caption} />
        </div>
      )}
    </div>
  )
}
