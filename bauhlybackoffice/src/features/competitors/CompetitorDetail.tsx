import type { CompetitorDetail as Detail } from '../../services/competitors/repository'
import { CloseIcon } from '../../components/icons'
import { Delta, Sparkline } from '../intelligence/bits'
import { periodMeta, type ComparisonPeriod } from '../../services/period'
import { AuthorityPillars } from '../../components/AuthorityPillars'

/*
 * Competitor detail panel. Shows what the strategist needs to compare this
 * account against comparable competitors: authority pillar mix, publishing
 * output, and what the account actually posts.
 */

export function CompetitorDetailPanel({
  detail,
  period,
  onClose,
}: {
  detail: Detail
  period: ComparisonPeriod
  onClose: () => void
}) {
  const { account } = detail
  const windowLabel = periodMeta(period).current.toLowerCase()

  return (
    <aside className="cust-detail" aria-label={`${account.displayName ?? account.username} details`}>
      <header className="cust-detail-head">
        <div className="comp-ident">
          <span className="comp-avatar" aria-hidden="true">
            {(account.displayName ?? account.username)
              .split(/\s+/)
              .map((w) => w[0])
              .join('')
              .slice(0, 3)
              .toUpperCase()}
          </span>
          <div className="cust-detail-ident">
            <span className="comp-name">{account.displayName}</span>
            <span className="comp-handle">@{account.username}</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close competitor details"
        >
          <CloseIcon />
        </button>
      </header>

      <p className="comp-detail-meta">
        {[account.location.city, account.location.country].filter(Boolean).join(', ')}
        {account.specialization ? ` · ${account.specialization}` : ''}
      </p>

      <section className="cust-detail-section">
        <h3 className="rail-title">Account ({windowLabel})</h3>
        <div className="cust-detail-metrics">
          <div className="cust-detail-metric">
            <span className="stat-label">Followers</span>
            <span className="cust-metric-num">
              {account.latestFollowerCount != null
                ? `${(account.latestFollowerCount / 1000).toFixed(1)}K`
                : '—'}
            </span>
          </div>
          <div className="cust-detail-metric">
            <span className="stat-label">Change</span>
            <span className="cust-metric-num">
              {detail.followerChange != null ? <Delta value={detail.followerChange} unit="%" /> : '—'}
            </span>
          </div>
          <div className="cust-detail-metric">
            <span className="stat-label">Posts</span>
            <span className="cust-metric-num">{detail.postsCollected}</span>
          </div>
        </div>
        <Sparkline data={detail.followerSeries} />
      </section>

      <section className="cust-detail-section">
        <h3 className="rail-title">Authority pillar mix</h3>
        {detail.authorityMix.length > 0 ? (
          <>
            <p className="section-note">vs comparable competitors — same market, size band and category</p>
            <AuthorityPillars
              unit="share"
              scores={detail.authorityMix.map((p) => ({
                pillar: p.pillar,
                value: p.sharePct,
                benchmark: p.peerPct,
              }))}
            />
          </>
        ) : (
          // Pillar mix is derived from classified posts; say so rather than
          // drawing an empty chart that reads as "no activity".
          <p className="section-note">
            Available once collected posts have been classified.
          </p>
        )}
      </section>

      <section className="cust-detail-section">
        <h3 className="rail-title">Publishing</h3>
        <dl className="cust-journey">
          <div className="cust-journey-row">
            <dt>Posts per week</dt>
            <dd>{detail.postsPerWeek}</dd>
          </div>
          <div className="cust-journey-row">
            <dt>Median engagement</dt>
            <dd>{detail.medianEngagementRate}%</dd>
          </div>
          {/* These lists are empty until enough has been collected (topics also
              need post classification), so never index into them blindly. */}
          <div className="cust-journey-row">
            <dt>Top format</dt>
            <dd>
              {detail.topFormats[0]
                ? `${detail.topFormats[0].label} (${detail.topFormats[0].sharePct}%)`
                : 'No posts collected yet'}
            </dd>
          </div>
          <div className="cust-journey-row">
            <dt>Top topic</dt>
            <dd>
              {detail.topTopics[0]
                ? `${detail.topTopics[0].label} (${detail.topTopics[0].sharePct}%)`
                : 'Not classified yet'}
            </dd>
          </div>
        </dl>
      </section>

      {account.enrichment && (
        <section className="cust-detail-section">
          <h3 className="rail-title">Enrichment</h3>
          <dl className="cust-journey">
            <div className="cust-journey-row">
              <dt>Country</dt>
              <dd>
                {account.enrichment.country ?? 'Unknown'}
                {account.enrichment.countryConfidence
                  ? ` (${account.enrichment.countryConfidence})`
                  : ''}
              </dd>
            </div>
            <div className="cust-journey-row">
              <dt>Account type</dt>
              <dd>{account.enrichment.accountType ?? 'Unknown'}</dd>
            </div>
            <div className="cust-journey-row">
              <dt>Posting frequency</dt>
              <dd>{account.enrichment.postingFrequency ?? 'Unknown'}</dd>
            </div>
            <div className="cust-journey-row">
              <dt>Avg posts / week</dt>
              <dd>
                {account.enrichment.averagePostsPerWeek != null
                  ? account.enrichment.averagePostsPerWeek
                  : '—'}
              </dd>
            </div>
            <div className="cust-journey-row">
              <dt>Engagement rate</dt>
              <dd>
                {account.enrichment.engagementRate != null
                  ? `${account.enrichment.engagementRate}%`
                  : '—'}
              </dd>
            </div>
            <div className="cust-journey-row">
              <dt>Performance</dt>
              <dd>{account.enrichment.estimatedPerformance ?? 'Unknown'}</dd>
            </div>
            <div className="cust-journey-row">
              <dt>Primary content</dt>
              <dd>{account.enrichment.primaryContentType ?? 'Unknown'}</dd>
            </div>
            <div className="cust-journey-row">
              <dt>Dominant format</dt>
              <dd>{account.enrichment.dominantPostFormat ?? 'Unknown'}</dd>
            </div>
            <div className="cust-journey-row">
              <dt>Latest post</dt>
              <dd>
                {account.enrichment.latestPostDate
                  ? account.enrichment.latestPostDate.slice(0, 10)
                  : '—'}
              </dd>
            </div>
          </dl>
          {account.lastEnrichmentAt && (
            <p className="section-note">
              Last enriched {account.lastEnrichmentAt.slice(0, 10)}
              {account.enrichment.postsAnalyzed != null
                ? ` · ${account.enrichment.postsAnalyzed} posts analysed`
                : ''}
            </p>
          )}
        </section>
      )}

      <section className="cust-detail-section">
        <h3 className="rail-title">Content mix</h3>
        {detail.topFormats.map((f) => (
          <div className="adoption-row" key={f.label}>
            <span className="adoption-label">{f.label}</span>
            <div className="adoption-bar">
              <div className="adoption-fill adoption-fill--info" style={{ width: `${f.sharePct}%` }} />
            </div>
            <span className="adoption-value">{f.sharePct}%</span>
          </div>
        ))}
      </section>

      <p className="panel-foot-note">
        Public metrics only — reach, saves and paid distribution are unknown for competitor
        accounts. Engagement is likes + comments ÷ followers.
      </p>
    </aside>
  )
}
