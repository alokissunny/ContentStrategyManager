import type { Finding, PatternMovement } from '../../types'
import type {
  DashboardData,
  DashboardSummary,
} from '../../services/intelligence/repository'
import type { PatternDimensionKey } from '../../services/intelligence/filters'
import { filterOptions } from '../../services/intelligence/filters'
import { topicSources, type TopicSource } from '../../services/intelligence/mockData'
import { Delta, EvidenceBadge, PillarTag, Sparkline } from './bits'
import { useState } from 'react'
import { StatCard, type StatTone } from '../../components/StatCard'
import { CompetitorsIcon, PostsIcon, SendIcon, TrendUpIcon } from '../../components/icons'

/* ── Summary cards ────────────────────────────────────────────────────────── */

export function SummaryCards({ summary }: { summary: DashboardSummary }) {
  const cards: {
    label: string
    value: string | number
    detail: string
    icon: React.ReactNode
    tone: StatTone
    progress?: { value: number; max: number }
  }[] = [
    {
      label: 'Accounts Analyzed',
      value: summary.accountsAnalyzed,
      detail: `of ${summary.accountTarget.min}–${summary.accountTarget.max} target`,
      icon: <CompetitorsIcon />,
      tone: 'blue',
      progress: { value: summary.accountsAnalyzed, max: summary.accountTarget.max },
    },
    {
      label: 'Posts Analyzed',
      value: summary.postsAnalyzed.toLocaleString('en-US'),
      detail: 'in period',
      icon: <PostsIcon />,
      tone: 'purple',
    },
    {
      label: 'Posts / Week',
      value: summary.medianPostsPerWeek,
      detail: 'median across the group',
      icon: <SendIcon />,
      tone: 'green',
    },
    {
      label: 'Engagement Rate',
      value: `${summary.medianEngagementRate}%`,
      detail: 'median, likes + comments ÷ followers',
      icon: <TrendUpIcon />,
      tone: 'teal',
    },
  ]
  return (
    <div className="summary-cards">
      {cards.map((card, i) => (
        <StatCard
          key={card.label}
          icon={card.icon}
          tone={card.tone}
          label={card.label}
          value={card.value}
          detail={card.detail}
          progress={card.progress}
        >
          {i > 1 && (summary.series[i]?.length ?? 0) >= 2 && (
            <Sparkline data={summary.series[i]!} />
          )}
        </StatCard>
      ))}
    </div>
  )
}

/* ── Stronger accounts findings ───────────────────────────────────────────── */

function formatValue(value: number | null, unit: string | null): string {
  if (value == null) return '—'
  if (unit === 'per-week') return value.toFixed(1)
  return `${value}%`
}

function FindingItem({ finding: f, rank }: { finding: Finding; rank: number }) {
  const [open, setOpen] = useState(false)
  const diff =
    f.focusValue != null && f.comparisonValue != null
      ? Math.round((f.focusValue - f.comparisonValue) * 10) / 10
      : null
  return (
    <li className="finding">
      <span className="finding-rank" aria-hidden="true">
        {rank + 1}
      </span>
      <div className="finding-body">
        <div className="finding-title-row">
          <h3>{f.title}</h3>
          <PillarTag pillar={f.authorityPillar} />
        </div>
        <p className="finding-explanation">{f.explanation}</p>
        <button
          type="button"
          className="finding-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className={`finding-chevron${open ? ' finding-chevron--open' : ''}`} aria-hidden="true" />
          {open ? 'Hide evidence' : 'Evidence & sample'}
          {!open && diff != null && (
            <span className="finding-toggle-hint">
              <Delta value={diff} unit={f.valueUnit === 'per-week' ? '/week' : 'pp'} />
            </span>
          )}
        </button>
        {open && (
          <div className="finding-detail">
            <p className="finding-values">
              <strong>{formatValue(f.focusValue, f.valueUnit)}</strong>
              <span className="finding-vs">vs</span>
              <strong>{formatValue(f.comparisonValue, f.valueUnit)}</strong>
              {diff != null && (
                <Delta value={diff} unit={f.valueUnit === 'per-week' ? '/week' : 'pp'} />
              )}
            </p>
            <p className="finding-sample">
              {f.sample.accountsAnalyzed} accounts · {f.sample.postsAnalyzed.toLocaleString('en-US')} posts ·{' '}
              {f.sample.dateRange.from} → {f.sample.dateRange.to}
            </p>
            <p className="finding-limitation">{f.limitations[0]}</p>
            <div className="finding-foot">
              <EvidenceBadge strength={f.evidenceStrength} />
            </div>
          </div>
        )}
      </div>
    </li>
  )
}

export function StrongerAccounts({ findings }: { findings: Finding[] }) {
  return (
    <section className="panel" aria-labelledby="stronger-title">
      <div className="panel-head">
        <h2 id="stronger-title">What stronger accounts are doing differently</h2>
        <span className="panel-head-note">High-performers vs comparison group</span>
      </div>
      {findings.length === 0 ? (
        <p className="panel-empty">
          No findings meet the current filters. Widen the evidence threshold, pillar, or sample.
        </p>
      ) : (
        <>
          <div className="panel-scroll">
            <ol className="finding-list">
              {findings.map((f, rank) => (
                <FindingItem key={f.id} finding={f} rank={rank} />
              ))}
            </ol>
          </div>
        </>
      )}

    </section>
  )
}

/* ── Pattern movement ─────────────────────────────────────────────────────── */

const stateLabels: Record<string, { label: string; tone: 'positive' | 'negative' | 'neutral' }> = {
  emerging: { label: 'Emerging', tone: 'positive' },
  strengthening: { label: 'Strengthening', tone: 'positive' },
  stable: { label: 'Stable', tone: 'neutral' },
  weakening: { label: 'Weakening', tone: 'negative' },
  saturated: { label: 'Saturated', tone: 'negative' },
  disappearing: { label: 'Disappearing', tone: 'negative' },
  resurfacing: { label: 'Resurfacing', tone: 'positive' },
  volatile: { label: 'Volatile', tone: 'neutral' },
  inconclusive: { label: 'Inconclusive', tone: 'neutral' },
}

function MovementTable({ rows }: { rows: PatternMovement[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Pattern</th>
          <th scope="col">Previous</th>
          <th scope="col">Current</th>
          <th scope="col">Change</th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const st = stateLabels[m.state]
          return (
            <tr key={m.id} title={`${m.metricDefinition} Evidence: ${m.evidenceStrength}.`}>
              <td>{m.pattern}</td>
              <td className="nowrap">{m.previousValue != null ? `${m.previousValue}%` : '—'}</td>
              <td className="nowrap">{m.currentValue != null ? `${m.currentValue}%` : '—'}</td>
              <td className="nowrap">{m.changePp != null ? <Delta value={m.changePp} /> : '—'}</td>
              <td className="nowrap">
                <span className={`state-tag state-tag--${st.tone}`}>{st.label}</span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function PatternMovementSection({
  movements,
  dimension,
  onDimensionChange,
}: {
  movements: PatternMovement[]
  dimension: PatternDimensionKey
  onDimensionChange: (d: PatternDimensionKey) => void
}) {
  const rows = movements.filter((m) => m.dimension === dimension)

  const tabs = (
    <div className="seg-control seg-control--full" role="tablist" aria-label="Pattern dimension">
      {filterOptions.dimension.map((d) => (
        <button
          key={d.value}
          role="tab"
          aria-selected={dimension === d.value}
          className={dimension === d.value ? 'active' : undefined}
          onClick={() => onDimensionChange(d.value)}
          type="button"
        >
          {d.label}
        </button>
      ))}
    </div>
  )

  return (
    <section className="panel" aria-labelledby="movement-title">
      <div className="panel-head">
        <h2 id="movement-title">Pattern Movement</h2>
      </div>
      {tabs}
      {rows.length === 0 ? (
        <p className="panel-empty">No pattern data for this dimension under the current filters.</p>
      ) : (
        <div className="panel-scroll panel-scroll--table">
          <MovementTable rows={rows} />
        </div>
      )}
      <p className="panel-foot-note">
        % of relevant posts using the pattern within the selected account group. pp = percentage
        points.
      </p>

    </section>
  )
}

/* ── Hooks table ──────────────────────────────────────────────────────────── */

export function HooksSection({ hooks }: { hooks: DashboardData['hooks'] }) {
  return (
    <section className="panel" aria-labelledby="hooks-title">
      <div className="panel-head">
        <h2 id="hooks-title">Best Performing Hooks</h2>
        <span className="panel-head-note">for the selected follower range</span>
      </div>
      {hooks.length === 0 ? (
        <p className="panel-empty">No hook data under the current filters.</p>
      ) : (
        <div className="panel-scroll panel-scroll--table">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Hook type</th>
                <th scope="col">Use rate</th>
                <th scope="col">Median ER</th>
                <th scope="col">Trend</th>
              </tr>
            </thead>
            <tbody>
              {hooks.map((h) => (
                <tr key={h.hookType}>
                  <td>
                    <span className="hook-name">{h.hookType}</span>
                    <span className="hook-structure">{h.structure}</span>
                  </td>
                  <td>{h.useRate}%</td>
                  <td>{h.medianEngagement}%</td>
                  <td>
                    <span className={`trend trend--${h.trend}`}>
                      {h.trend === 'up' ? '↑ rising' : h.trend === 'down' ? '↓ declining' : '→ flat'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="panel-foot-note">
        Hook structures are abstracted — competitor text is never copied. ER = public engagement
        rate (likes + comments / followers).
      </p>
    </section>
  )
}

/* ── Topics people are talking about ─────────────────────────────────────── */

export function TopicsSection({
  topics,
  trendTopics,
}: {
  topics: DashboardData['topics']
  trendTopics: DashboardData['trendTopics']
}) {
  const searchAvailable = trendTopics.length > 0
  const [source, setSource] = useState<TopicSource>('instagram')
  const activeSource: TopicSource = source === 'google-trends' && !searchAvailable ? 'instagram' : source
  const meta = topicSources.find((s) => s.id === activeSource)!
  const isSearch = activeSource === 'google-trends'
  const rows = isSearch ? trendTopics : topics
  const max = rows.length ? rows[0].sharePct : 1
  const visibleSources = topicSources.filter((s) => s.id === 'instagram' || searchAvailable)

  return (
    <section className="panel" aria-labelledby="topics-title">
      <div className="panel-head">
        <h2 id="topics-title">Topics</h2>
        <span className="panel-head-note">
          {isSearch ? 'what people search for' : 'what competitors post about'} · ranked by{' '}
          {meta.metricLabel}
        </span>
      </div>

      {visibleSources.length > 1 && (
        <div className="seg-control seg-control--full" role="tablist" aria-label="Topic data source">
          {visibleSources.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={activeSource === s.id}
              className={activeSource === s.id ? 'active' : undefined}
              onClick={() => setSource(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="panel-empty">No topic data under the current filters.</p>
      ) : (
        <div className="panel-scroll">
          <ol className="topic-list">
            {rows.map((t, i) => (
              <li className="topic-row" key={t.topic}>
                <span className="topic-rank" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="topic-main">
                  <div className="topic-head">
                    <span className="topic-name">
                      {t.topic}
                      {isSearch && 'intent' in t && (
                        <span className={`intent-chip intent-chip--${t.intent}`}>
                          {t.intent === 'frustration' ? 'Frustration' : 'Desire'}
                        </span>
                      )}
                    </span>
                    <span className="topic-share">{t.sharePct}%</span>
                  </div>
                  <div className="topic-bar">
                    <div
                      className={`topic-bar-fill topic-bar-fill--${activeSource}`}
                      style={{ width: `${Math.round((t.sharePct / max) * 100)}%` }}
                    />
                  </div>
                  <span className="topic-meta">
                    {isSearch && 'query' in t ? `“${t.query}”` : `${t.accounts} accounts · ${t.posts} posts`}
                  </span>
                </div>
                <Delta value={t.changePp} />
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="panel-foot-note">
        {isSearch
          ? meta.definition
          : 'Share of competitor posts mentioning the topic within the selected account group.'}
      </p>
    </section>
  )
}

/* ── Hashtags ─────────────────────────────────────────────────────────────── */

export function HashtagsSection({
  hashtags,
  basis,
}: {
  hashtags: DashboardData['hashtags']
  basis: DashboardData['hashtagBasis']
}) {
  return (
    <section className="panel" aria-labelledby="hashtags-title">
      <div className="panel-head">
        <h2 id="hashtags-title">Hashtags high performers use</h2>
        <span className="panel-head-note">ranked by how much more they use them</span>
      </div>
      {hashtags.length === 0 ? (
        <p className="panel-empty">No hashtag data under the current filters.</p>
      ) : (
        <ol className="hashtag-list">
          {hashtags.map((h) => {
            const diff = h.highPerformerAccounts - h.comparisonAccounts
            return (
              <li className="hashtag-row" key={h.tag}>
                <div className="hashtag-main">
                  <div className="hashtag-head">
                    <span className="hashtag-tag">{h.tag}</span>
                    <span className={`tag-type tag-type--${h.type.toLowerCase()}`}>{h.type}</span>
                  </div>
                  <span className="hashtag-meta">
                    Used by <strong>{h.highPerformerAccounts} of {basis.highPerformers}</strong> high
                    performers · {h.comparisonAccounts} of {basis.comparison} others
                  </span>
                </div>
                <span className={`hashtag-diff hashtag-diff--${diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}`}>
                  {diff > 0 ? '+' : ''}
                  {diff}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      <p className="panel-foot-note">
        Counted from the captions of collected posts. Instagram does not report reach by hashtag for
        other accounts, so this shows who uses a tag — not what it earned them.
      </p>
    </section>
  )
}

/* ── Weekly pattern ───────────────────────────────────────────────────────── */

export function WeeklySection({
  weekly,
  basis = null,
}: {
  weekly: DashboardData['weekly']
  basis?: DashboardData['weeklyBasis']
}) {
  return (
    <section className="panel" aria-labelledby="weekly-title">
      <div className="panel-head">
        <h2 id="weekly-title">Weekly Publishing Pattern</h2>
        <span className="panel-head-note">
          {basis
            ? `how ${basis.accountsWithGap} comparable accounts with the same ${basis.pillar} gap published while outperforming — busiest day first`
            : 'observed competitor behavior — not a recommended plan'}
        </span>
      </div>
      {weekly.length === 0 ? (
        <p className="panel-empty">Not enough data for a weekly pattern under the current filters.</p>
      ) : (
        <div className="weekly-grid">
          {weekly.map((d) => (
            <div className="weekly-day" key={d.day}>
              <p className="weekly-day-name">{d.day}</p>
              <span className={`pillar-tag pillar-tag--${d.pillar}`}>{d.pillarLabel}</span>
              <p className="weekly-content">{d.contentType}</p>
              <p className="weekly-meta">
                {d.format} · {d.medianTime}
              </p>
              <p className="weekly-sample">
                {d.accounts} acc · {d.posts} posts
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/* ── Customer performance overview ────────────────────────────────────────── */

export function CustomerOverviewSection({
  overview,
}: {
  overview: DashboardData['customerOverview']
}) {
  return (
    <section className="panel" aria-labelledby="customers-title">
      <div className="panel-head">
        <h2 id="customers-title">Customer Performance Overview</h2>
        <span className="panel-head-note">median change vs previous 30 days · connected accounts</span>
      </div>
      <div className="customer-overview">
        <div className="customer-metrics">
          {overview.medianChanges.map((m) => (
            <div className="customer-metric" key={m.label}>
              <p className="summary-card-label">{m.label}</p>
              <p className={`customer-metric-value${m.value < 0 ? ' negative' : ''}`}>
                {m.value > 0 ? '+' : ''}
                {m.value}%
              </p>
              <Sparkline data={m.series} />
            </div>
          ))}
        </div>
        <div className="adoption">
          <p className="summary-card-label">Content Adoption</p>
          {overview.adoption.map((a) => (
            <div className="adoption-row" key={a.label}>
              <span className="adoption-label">{a.label}</span>
              <div className="adoption-bar">
                <div
                  className={`adoption-fill adoption-fill--${a.tone}`}
                  style={{ width: `${a.value}%` }}
                />
              </div>
              <span className="adoption-value">{a.value}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
