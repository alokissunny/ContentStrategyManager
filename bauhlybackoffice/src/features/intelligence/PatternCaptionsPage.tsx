import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPatternCaptions, pillarLabel } from '../../services/intelligence/captionPatterns'
import { EmptyState } from '../../components/EmptyState'
import './intelligence.css'

/*
 * Every matching caption for one pattern, as a scannable list. The captions
 * shown are an illustrative sample — the page says so plainly — because the
 * full matching set only exists once real collection is connected.
 */
export function PatternCaptionsPage() {
  const { patternId } = useParams<{ patternId: string }>()
  const data = useMemo(() => (patternId ? getPatternCaptions(patternId) : null), [patternId])

  if (!data) {
    return (
      <div className="intelligence-main">
        <Link to="/competitors-patterns" className="cap-back-link">
          ← Back to caption patterns
        </Link>
        <EmptyState
          title="Pattern not found"
          description="This caption pattern doesn't exist. Head back to the pattern list."
        />
      </div>
    )
  }

  return (
    <div className="intelligence-main">
      <Link to="/competitors-patterns" className="cap-back-link">
        ← Back to caption patterns
      </Link>

      <section className="panel captions-page">
        <div className="panel-head">
          <div>
            <h2>
              Matching captions{' '}
              <span className="captions-page-pattern">· {data.pattern.name}</span>
            </h2>
            <p className="cap-intro">{data.pattern.summary}</p>
          </div>
          <span className={`pillar-tag pillar-tag--${data.pattern.pillar}`}>
            {pillarLabel(data.pattern.pillar)}
          </span>
        </div>

        <p className="captions-sample-note">
          Showing a sample of <strong>{data.captions.length}</strong> captions.{' '}
          {data.totalCount.toLocaleString('en-US')} captions match this pattern in the analyzed set —
          the full list becomes browsable once live collection is connected.
        </p>

        <ul className="captions-list">
          {data.captions.map((c) => (
            <li key={c.id} className="caption-card">
              <div className="caption-card-head">
                <span className="caption-card-account">@{c.competitor.toLowerCase().replace(/\s+/g, '')}</span>
                <span className="caption-card-name">{c.competitor}</span>
              </div>
              <blockquote className="caption-card-body">{c.caption}</blockquote>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
