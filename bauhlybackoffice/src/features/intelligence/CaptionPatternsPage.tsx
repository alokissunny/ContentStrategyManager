import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { defaultFilters, type FilterState } from '../../services/intelligence/filters'
import { getCaptionAnalysis } from '../../services/intelligence/captionPatterns'
import { FilterBar } from './FilterBar'
import { CaptionPatternAnalysis } from './CaptionPatternAnalysis'
import './intelligence.css'

/*
 * The full Caption Pattern Analysis — every ranked pattern, not just the top
 * five shown on the overview. Its own filter bar so the segment can be changed
 * here without bouncing back.
 */
export function CaptionPatternsPage() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const caption = useMemo(() => getCaptionAnalysis(filters), [filters])

  return (
    <div className="intelligence-main">
      <Link to="/competitors-overview" className="cap-back-link">
        ← Back to Competitors overview
      </Link>
      <FilterBar filters={filters} onChange={setFilters} />
      <div className="dashboard">
        <CaptionPatternAnalysis analysis={caption} />
      </div>
    </div>
  )
}
