import { useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  CaptionAnalysis,
  CaptionPattern,
  PatternTrend,
  RankRow,
} from '../../services/intelligence/captionPatterns'

import { PillarTag } from './bits'
import { StatCard } from '../../components/StatCard'
import { ClockIcon, CompetitorsIcon, PostsIcon, TrendUpIcon } from '../../components/icons'

/*
 * Three KPI cards — deliberately frequency-only. No posts/week, no engagement
 * rate: those imply performance we cannot measure from public data.
 */
export function CaptionKpis({ kpis }: { kpis: CaptionAnalysis['kpis'] }) {
  return (
    <div className="summary-cards summary-cards--three">
      <StatCard
        icon={<CompetitorsIcon />}
        tone="blue"
        label="Competitors Analyzed"
        value={kpis.competitors}
        detail="unique accounts"
      />
      <StatCard
        icon={<PostsIcon />}
        tone="green"
        label="Public Captions Analyzed"
        value={kpis.captions.toLocaleString('en-US')}
        detail="from the selected time period"
      />
      <StatCard
        icon={<TrendUpIcon />}
        tone="purple"
        label="Caption Patterns Detected"
        value={kpis.patternsDetected}
        detail="recurring patterns identified"
      />
    </div>
  )
}

/*
 * Caption Pattern Analysis — one full-width research surface.
 *
 * It reports how often things appear, never how well they performed. The copy
 * and the trend labels stay in frequency language on purpose: with public
 * captions we can see prevalence and change, never engagement.
 */

type Tab = 'patterns' | 'formats' | 'days-times'

const TABS: { id: Tab; label: string }[] = [
  { id: 'patterns', label: 'Patterns Ranking' },
  { id: 'formats', label: 'Formats Ranking' },
  { id: 'days-times', label: 'Days & Times' },
]

/** Frequency-only trend, never phrased as performance. */
function TrendCell({ trend }: { trend: Pick<PatternTrend, 'changePp' | 'state'> }) {
  if (trend.state === 'inconclusive' || trend.changePp == null) {
    return <span className="cap-trend cap-trend--flat">Inconclusive</span>
  }
  const tone = trend.state === 'increasing' ? 'up' : trend.state === 'decreasing' ? 'down' : 'flat'
  const arrow = tone === 'up' ? '↑' : tone === 'down' ? '↓' : '→'
  const sign = trend.changePp > 0 ? '+' : ''
  return (
    <span className={`cap-trend cap-trend--${tone}`}>
      {arrow} {sign}
      {trend.changePp}pp
    </span>
  )
}

/** Header cell whose label clamps to two lines with a tooltip, so narrow
 * columns never blow up the row height. */
function Th({ label, className }: { label: string; className?: string }) {
  return (
    <th scope="col" className={className}>
      <span className="cap-th-clamp" title={label}>
        {label}
      </span>
    </th>
  )
}

function PatternRow({
  pattern,
  windows,
  open,
  onToggle,
}: {
  pattern: CaptionPattern
  windows: { previous: string; current: string }
  open: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className={`cap-row${open ? ' cap-row--open' : ''}`} onClick={onToggle}>
        <td>
          <span className="cap-name cap-clamp cap-clamp--1" title={pattern.name}>
            {pattern.name}
          </span>
          <span className="cap-summary cap-clamp" title={pattern.summary}>
            {pattern.summary}
          </span>
        </td>
        <td>
          <PillarTag pillar={pattern.pillar} title={pattern.pillarReason} />
        </td>
        <td className="num">{pattern.competitors}</td>
        <td className="num">{pattern.captions.toLocaleString('en-US')}</td>
        <td className="num">{pattern.sharePct}%</td>
        <td className="nowrap">
          <TrendCell trend={pattern.trend} />
        </td>
        <td className="cap-chevron-cell">
          <button
            type="button"
            className={`cap-chevron${open ? ' cap-chevron--open' : ''}`}
            aria-expanded={open}
            aria-label={open ? `Collapse ${pattern.name}` : `Expand ${pattern.name}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          />
        </td>
      </tr>
      {open && (
        <tr className="cap-detail-row">
          <td colSpan={7}>
            <div className="cap-detail">
              <div className="cap-detail-cols">
                <div className="cap-detail-col cap-detail-col--text">
                  <div className="cap-detail-block">
                    <h4>What we detected</h4>
                    <p>{pattern.whatWeDetected}</p>
                  </div>
                  <div className="cap-detail-block">
                    <h4>Why it matters</h4>
                    <p>{pattern.whyItMatters}</p>
                  </div>
                </div>

                <div className="cap-detail-col cap-detail-col--structure">
                  <div className="cap-detail-block">
                    <h4>Typical structure</h4>
                    <ol className="cap-steps">
                      {pattern.structure.map((s, i) => (
                        <li className="cap-step" key={s.step}>
                          <span className="cap-step-badge">{i + 1}</span>
                          <span className="cap-step-text">
                            <span className="cap-step-name">{s.step}</span>
                            <span className="cap-step-detail">{s.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="cap-detail-col cap-detail-col--example">
                  <div className="cap-detail-block">
                    <h4>
                      Representative example{' '}
                      <span className="cap-detail-h4-note">from the analyzed dataset</span>
                    </h4>
                    {pattern.example ? (
                      <>
                        <figure className="cap-example">
                          <blockquote className="cap-example-caption">
                            {pattern.example.caption}
                          </blockquote>
                          <figcaption className="cap-example-credit">
                            <span className="cap-example-avatar" aria-hidden="true">
                              {pattern.example.competitor.slice(0, 1)}
                            </span>
                            <span className="cap-example-name">{pattern.example.competitor}</span>
                          </figcaption>
                        </figure>
                        <Link className="cap-view-all" to={`/competitors-captions/${pattern.id}`}>
                          View all {pattern.captions.toLocaleString('en-US')} matching captions →
                        </Link>
                      </>
                    ) : (
                      <p className="cap-example-empty">
                        No representative caption is available for this pattern yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="cap-evidence">
                <span className="cap-evidence-title">Supporting evidence</span>
                <ul className="cap-evidence-list">
                  <li className="cap-evidence-item">
                    <CompetitorsIcon className="cap-evidence-icon" />
                    <div className="cap-evidence-text">
                      <span className="cap-evidence-num">{pattern.competitors}</span>
                      <span className="cap-evidence-lbl">competitors</span>
                    </div>
                  </li>
                  <li className="cap-evidence-item">
                    <PostsIcon className="cap-evidence-icon" />
                    <div className="cap-evidence-text">
                      <span className="cap-evidence-num">
                        {pattern.captions.toLocaleString('en-US')}
                      </span>
                      <span className="cap-evidence-lbl">matching captions</span>
                    </div>
                  </li>
                  <li className="cap-evidence-item">
                    <ClockIcon className="cap-evidence-icon" />
                    <div className="cap-evidence-text">
                      <span className="cap-evidence-num">{pattern.sharePct}%</span>
                      <span className="cap-evidence-lbl">of analyzed captions</span>
                    </div>
                  </li>
                  <li className="cap-evidence-item cap-evidence-item--trend">
                    <TrendUpIcon className="cap-evidence-icon" />
                    <div className="cap-evidence-text">
                      {pattern.trend.state === 'inconclusive' || pattern.trend.changePp == null ? (
                        <>
                          <span className="cap-evidence-num cap-trend--flat">Inconclusive</span>
                          <span className="cap-evidence-lbl">too small a sample to state a trend</span>
                        </>
                      ) : (
                        <>
                          <span
                            className={`cap-evidence-num cap-trend--${
                              pattern.trend.state === 'increasing'
                                ? 'up'
                                : pattern.trend.state === 'decreasing'
                                  ? 'down'
                                  : 'flat'
                            }`}
                          >
                            {pattern.trend.state === 'increasing'
                              ? '↑'
                              : pattern.trend.state === 'decreasing'
                                ? '↓'
                                : '→'}{' '}
                            {pattern.trend.changePp > 0 ? '+' : ''}
                            {pattern.trend.changePp} pp
                          </span>
                          <span className="cap-evidence-lbl">
                            {windows.current} vs {windows.previous}
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function PatternsTable({
  patterns,
  windows,
  limit,
  showAllHref,
}: {
  patterns: CaptionPattern[]
  windows: { previous: string; current: string }
  limit?: number
  showAllHref?: string
}) {
  // One row expanded at a time, so the table never becomes a wall of detail.
  const [openId, setOpenId] = useState<string | null>(null)
  if (patterns.length === 0) {
    return <p className="panel-empty">No caption patterns match the current filters.</p>
  }
  const shown = limit != null ? patterns.slice(0, limit) : patterns
  const hidden = patterns.length - shown.length

  return (
    <>
      <div className="cap-table-scroll">
        <table className="data-table cap-table cap-table--patterns">
          <thead>
            <tr>
              <Th label="Pattern" />
              <Th label="Authority Pillar" />
              <Th label="Competitors" className="num" />
              <Th label="Captions" className="num" />
              <Th label="Share of captions" className="num" />
              <Th label="Trend (30 days)" />
              <th scope="col" aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <PatternRow
                key={p.id}
                pattern={p}
                windows={windows}
                open={openId === p.id}
                onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
              />
            ))}
          </tbody>
        </table>
      </div>
      {hidden > 0 && showAllHref && (
        <div className="cap-showmore">
          <Link to={showAllHref} className="cap-showmore-link">
            Show all {patterns.length} patterns →
          </Link>
          <span className="cap-showmore-note">Showing the top {shown.length}</span>
        </div>
      )}
    </>
  )
}

function RankTable({ rows, unit }: { rows: RankRow[]; unit: string }) {
  if (rows.length === 0) {
    return <p className="panel-empty">No {unit} data under the current filters.</p>
  }
  return (
    <div className="cap-table-scroll">
      <table className="data-table cap-table cap-table--rank cap-cards">
        <thead>
          <tr>
            <Th label={unit} />
            <Th label="Competitors" className="num" />
            <Th label="Posts" className="num" />
            <Th label="Share of posts" className="num" />
            <Th label="Previous" className="num" />
            <Th label="Current" className="num" />
            <Th label="Change" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="cap-rank-label">
                <span className="cap-name-cell cap-clamp" title={r.label}>
                  {r.label}
                </span>
              </td>
              <td className="num" data-label="Competitors">{r.competitors}</td>
              <td className="num" data-label="Posts">{r.posts.toLocaleString('en-US')}</td>
              <td className="num" data-label="Share of posts">{r.sharePct}%</td>
              <td className="num" data-label="Previous">
                {r.previousPct != null ? `${r.previousPct}%` : '—'}
              </td>
              <td className="num" data-label="Current">
                {r.currentPct != null ? `${r.currentPct}%` : '—'}
              </td>
              <td className="nowrap" data-label="Change">
                <TrendCell trend={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* One table answering "which day, and the best time on it" — replaces the
 * separate day and time rankings. */
function DayTimeTable({ rows }: { rows: RankRow[] }) {
  if (rows.length === 0) {
    return <p className="panel-empty">No publishing-time data under the current filters.</p>
  }
  return (
    <div className="cap-table-scroll">
      <table className="data-table cap-table cap-table--daytime cap-cards">
        <thead>
          <tr>
            <Th label="Day" />
            <Th label="Best time to post" />
            <Th label="Competitors" className="num" />
            <Th label="Posts" className="num" />
            <Th label="Share of posts" className="num" />
            <Th label="Change" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="cap-rank-label">
                <span className="cap-name-cell cap-clamp" title={r.label}>
                  {r.label}
                </span>
              </td>
              <td data-label="Best time to post">
                <span className="cap-peaktime">{r.peakTime ?? '—'}</span>
              </td>
              <td className="num" data-label="Competitors">{r.competitors}</td>
              <td className="num" data-label="Posts">{r.posts.toLocaleString('en-US')}</td>
              <td className="num" data-label="Share of posts">{r.sharePct}%</td>
              <td className="nowrap" data-label="Change">
                <TrendCell trend={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function CaptionPatternAnalysis({
  analysis,
  patternLimit,
  showAllHref,
}: {
  analysis: CaptionAnalysis
  /** Cap the Patterns tab to this many rows (overview shows top 5). */
  patternLimit?: number
  /** Where "Show all patterns" links to. */
  showAllHref?: string
}) {
  const [tab, setTab] = useState<Tab>('patterns')

  return (
    <section className="panel cap-panel" aria-labelledby="cap-title">
      <div className="panel-head">
        <div>
          <h2 id="cap-title">Caption Pattern Analysis</h2>
          <p className="cap-intro">
            We grouped similar public captions into recurring communication patterns and ranked them
            by how frequently they appear across the analyzed competitors.
          </p>
        </div>
        <span className="cap-evidence-label">
          Based on {analysis.kpis.competitors} competitors ·{' '}
          {analysis.kpis.captions.toLocaleString('en-US')} public captions
        </span>
      </div>

      <div className="seg-control seg-control--tabs" role="tablist" aria-label="Ranking type">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : undefined}
            onClick={(e) => {
              setTab(t.id)
              // The strip scrolls on narrow screens; keep the chosen tab in view.
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'patterns' && (
        <PatternsTable
          patterns={analysis.patterns}
          windows={analysis.windows}
          limit={patternLimit}
          showAllHref={showAllHref}
        />
      )}
      {tab === 'formats' && <RankTable rows={analysis.formats} unit="Format" />}
      {tab === 'days-times' && <DayTimeTable rows={analysis.days} />}

      <p className="panel-foot-note">
        {tab === 'patterns'
          ? 'Ranked by how frequently each pattern appears across analyzed competitors — not by performance. pp = percentage points.'
          : tab === 'days-times'
            ? 'The busiest publishing days, and the time range each day peaks — observed competitor behaviour, not proven best times to post.'
            : 'Ranked by share of analyzed posts — a frequency ranking, not a performance ranking.'}{' '}
        Previous: {analysis.windows.previous} · Current: {analysis.windows.current}.
      </p>
    </section>
  )
}
