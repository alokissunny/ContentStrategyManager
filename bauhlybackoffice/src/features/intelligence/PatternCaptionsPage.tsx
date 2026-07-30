import { useMemo } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { defaultFilters } from '../../services/intelligence/filters'
import { getDashboard } from '../../services/intelligence/repository'
import {
  getCaptionAnalysis,
  pillarLabel,
  type CaptionPattern,
} from '../../services/intelligence/captionPatterns'
import { USE_MOCKS } from '../../services/api'
import { EmptyState } from '../../components/EmptyState'
import './intelligence.css'

/*
 * Every matching caption for one pattern. The captions are REAL — resolved from
 * analyzed competitor posts and carried on the pattern itself. We arrive here
 * from the overview with the pattern in hand (router state); on a refresh or a
 * direct link we reload the default-scope analysis and find it by id. Nothing
 * is fabricated: with no surfaced captions the page says so.
 */
export function PatternCaptionsPage() {
  const { patternId } = useParams<{ patternId: string }>()
  const location = useLocation()
  const passed = (location.state as { pattern?: CaptionPattern } | null)?.pattern
  const havePassed = !!passed && passed.id === patternId

  const query = useQuery({
    queryKey: ['dashboard', defaultFilters],
    queryFn: () => getDashboard(defaultFilters),
    enabled: !havePassed,
  })

  const fetched = useMemo(() => {
    if (havePassed || !query.data) return undefined
    // Real analysis when one exists; the local model is an offline-only fallback
    // so the live app never shows invented patterns.
    const caption =
      query.data.captionAnalysis ?? (USE_MOCKS ? getCaptionAnalysis(defaultFilters) : undefined)
    return caption?.patterns.find((p) => p.id === patternId)
  }, [havePassed, query.data, patternId])

  const pattern = havePassed ? passed : fetched

  const back = (
    <Link to="/competitors-patterns" className="cap-back-link">
      ← Back to caption patterns
    </Link>
  )

  if (!havePassed && query.isPending) {
    return (
      <div className="intelligence-main">
        {back}
        <div className="dashboard-loading" role="status" aria-label="Loading captions">
          <div className="skeleton-card" />
        </div>
      </div>
    )
  }

  if (!pattern) {
    return (
      <div className="intelligence-main">
        {back}
        <EmptyState
          title="Pattern not found"
          description="This caption pattern isn't in the latest analysis. Head back to the pattern list."
        />
      </div>
    )
  }

  const captions = pattern.exampleCaptions ?? (pattern.example ? [pattern.example] : [])

  return (
    <div className="intelligence-main">
      {back}

      <section className="panel captions-page">
        <div className="panel-head">
          <div>
            <h2>
              Matching captions <span className="captions-page-pattern">· {pattern.name}</span>
            </h2>
            <p className="cap-intro">{pattern.summary}</p>
          </div>
          <span className={`pillar-tag pillar-tag--${pattern.pillar}`}>
            {pillarLabel(pattern.pillar)}
          </span>
        </div>

        {captions.length === 0 ? (
          <p className="captions-sample-note">
            No matching captions have been surfaced for this pattern yet. They appear here as the
            analysis collects and classifies more posts.
          </p>
        ) : (
          <>
            <p className="captions-sample-note">
              Showing <strong>{captions.length}</strong> of{' '}
              {pattern.captions.toLocaleString('en-US')} captions matching this pattern in the
              analyzed set.
            </p>

            <ul className="captions-list">
              {captions.map((c, i) => (
                <li key={`${c.competitor}-${i}`} className="caption-card">
                  <div className="caption-card-head">
                    <span className="caption-card-account">
                      @{c.competitor.toLowerCase().replace(/\s+/g, '')}
                    </span>
                    <span className="caption-card-name">{c.competitor}</span>
                  </div>
                  <blockquote className="caption-card-body">{c.caption}</blockquote>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
