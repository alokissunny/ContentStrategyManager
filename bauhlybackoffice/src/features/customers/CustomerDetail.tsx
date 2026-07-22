import type { CustomerRow } from '../../services/customers/mockData'
import { CloseIcon } from '../../components/icons'
import { Sparkline } from '../intelligence/bits'
import { AuthorityPillars } from '../../components/AuthorityPillars'

/* Customer detail side panel — Overview scope for the mock phase. */

const statusCopy: Record<string, string> = {
  improving: 'Improving',
  declining: 'At risk',
  stable: 'Stable',
  'new-or-insufficient-data': 'New / insufficient data',
  'collection-error': 'Collection error',
}

export function CustomerDetail({ customer, onClose }: { customer: CustomerRow; onClose: () => void }) {
  const journey: [string, string][] = [
    ['Onboarding', customer.onboardingStage.replace(/-/g, ' ')],
    ['Review mode', customer.reviewModeStatus.replace(/-/g, ' ')],
    ['Connection', customer.connectionStatus.replace(/-/g, ' ')],
    ['Data quality', customer.dataQuality ?? 'unknown'],
  ]

  return (
    <aside className="cust-detail" aria-label={`${customer.name} details`}>
      <header className="cust-detail-head">
        <div className="comp-ident">
          <span className="comp-avatar" aria-hidden="true">
            {customer.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <div className="cust-detail-ident">
            <span className="comp-name">{customer.name}</span>
            <span className="comp-handle">@{customer.instagramUsername}</span>
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close customer details"
        >
          <CloseIcon />
        </button>
      </header>

      <p className={`cust-status-line cust-status-line--${customer.status}`}>
        <strong>{statusCopy[customer.status]}</strong>
        <span>{customer.statusReason}</span>
      </p>

      <section className="cust-detail-section">
        <h3 className="rail-title">Key metrics</h3>
        <div className="cust-detail-metrics">
          <div className="cust-detail-metric">
            <span className="stat-label">Followers</span>
            <span className="cust-metric-num">
              {customer.latestFollowerCount != null
                ? `${(customer.latestFollowerCount / 1000).toFixed(1)}K`
                : '—'}
            </span>
          </div>
          <div className="cust-detail-metric">
            <span className="stat-label">Publishing</span>
            <span className="cust-metric-num">{customer.publishingRate}%</span>
          </div>
          <div className="cust-detail-metric">
            <span className="stat-label">Edit rate</span>
            <span className="cust-metric-num">{customer.editRate}%</span>
          </div>
        </div>
        <Sparkline
          data={customer.trendSeries}
          color={customer.status === 'declining' ? 'var(--negative)' : 'var(--trust-600)'}
        />
      </section>

      <section className="cust-detail-section">
        <h3 className="rail-title">Authority gap</h3>
        <p className="section-note">vs comparable competitors — same market, size band and category</p>
        <AuthorityPillars
          scores={[
            { pillar: 'discovery', value: customer.authorityGap?.discovery ?? 0, benchmark: 62 },
            { pillar: 'credibility', value: customer.authorityGap?.credibility ?? 0, benchmark: 66 },
            { pillar: 'trust', value: customer.authorityGap?.trust ?? 0, benchmark: 60 },
          ]}
        />
      </section>

      <section className="cust-detail-section">
        <h3 className="rail-title">Journey</h3>
        <dl className="cust-journey">
          {journey.map(([term, value]) => (
            <div className="cust-journey-row" key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </aside>
  )
}
