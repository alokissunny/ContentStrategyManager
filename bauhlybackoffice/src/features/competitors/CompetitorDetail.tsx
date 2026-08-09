import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CompetitorDetail as Detail } from '../../services/competitors/repository'
import { getCompetitorLocations } from '../../services/competitors/repository'
import { CloseIcon } from '../../components/icons'
import { Delta, Sparkline } from '../intelligence/bits'
import { periodMeta, type ComparisonPeriod } from '../../services/period'
import { AuthorityPillars } from '../../components/AuthorityPillars'
import {
  BUSINESS_CATEGORY_OPTIONS,
  type BusinessCategory,
} from '../../types'
import {
  isUnassignedLocationFilter,
  UNASSIGNED_LOCATION,
} from '../../services/intelligence/filterScope'

/*
 * Competitor detail panel. Shows what the strategist needs to compare this
 * account against comparable competitors: authority pillar mix, publishing
 * output, and what the account actually posts.
 */

/** Profile country first, else enrichment (skipping Unknown) — same as list filters. */
function effectiveCountry(account: Detail['account']): string {
  const fromLocation = account.location.country?.trim() || ''
  if (fromLocation) return fromLocation
  const fromEnrichment = account.enrichment?.country?.trim() || ''
  if (fromEnrichment && !/^unknown$/i.test(fromEnrichment)) return fromEnrichment
  return UNASSIGNED_LOCATION
}

function CountryField({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (country: string | null) => void
}) {
  const locations = useQuery({
    queryKey: ['competitor-locations'],
    queryFn: getCompetitorLocations,
    staleTime: 60_000,
  })
  const saved = value === UNASSIGNED_LOCATION ? '' : value
  const [draft, setDraft] = useState(saved)
  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const commit = () => {
    const next = draft.trim()
    const normalized = !next || isUnassignedLocationFilter(next) ? null : next
    const current = saved.trim() ? saved.trim() : null
    if (normalized === current) return
    onChange(normalized)
  }

  return (
    <div className="form-field" style={{ marginTop: 0 }}>
      <label htmlFor="detail-country" className="visually-hidden">
        Country
      </label>
      <input
        id="detail-country"
        list="detail-country-suggestions"
        value={draft}
        disabled={disabled}
        placeholder="Unassigned"
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          }
        }}
      />
      <datalist id="detail-country-suggestions">
        {(locations.data ?? []).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  )
}

export function CompetitorDetailPanel({
  detail,
  period,
  onClose,
  onBusinessCategoryChange,
  onCountryChange,
  categorySaving,
  countrySaving,
}: {
  detail: Detail
  period: ComparisonPeriod
  onClose: () => void
  onBusinessCategoryChange: (category: BusinessCategory) => void
  onCountryChange: (country: string | null) => void
  categorySaving?: boolean
  countrySaving?: boolean
}) {
  const { account } = detail
  const windowLabel = periodMeta(period).current.toLowerCase()
  const country = effectiveCountry(account)

  return (
    <aside className="cust-detail" aria-label={`${account.displayName ?? account.username} details`}>
      <header className="cust-detail-head">
        <a
          className="comp-ident comp-ident--link"
          href={`https://www.instagram.com/${encodeURIComponent(account.username)}/`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open @${account.username} on Instagram`}
        >
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
        </a>
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
        {[account.location.city, country !== UNASSIGNED_LOCATION ? country : null]
          .filter(Boolean)
          .join(', ') || 'No location set'}
        {account.specialization ? ` · ${account.specialization}` : ''}
      </p>

      <section className="cust-detail-section">
        <h3 className="rail-title">Business category</h3>
        <div className="form-field" style={{ marginTop: 0 }}>
          <label htmlFor="detail-business-category" className="visually-hidden">
            Business category
          </label>
          <select
            id="detail-business-category"
            value={account.businessCategory ?? 'interior-designer'}
            disabled={categorySaving}
            onChange={(e) => onBusinessCategoryChange(e.target.value as BusinessCategory)}
          >
            {BUSINESS_CATEGORY_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="cust-detail-section">
        <h3 className="rail-title">Country</h3>
        <CountryField value={country} disabled={countrySaving} onChange={onCountryChange} />
      </section>

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
