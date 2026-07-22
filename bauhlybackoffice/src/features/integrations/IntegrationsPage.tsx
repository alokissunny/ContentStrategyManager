import { useState } from 'react'
import {
  integrationCategories,
  integrations,
  type Integration,
  type IntegrationStatus,
} from '../../services/integrations/catalogue'
import { Modal } from '../../components/Modal'
import { CheckCircleIcon, ClockIcon, IntegrationsIcon } from '../../components/icons'
import './integrations.css'

const statusCopy: Record<IntegrationStatus, { label: string; tone: string }> = {
  connected: { label: 'Connected', tone: 'positive' },
  'not-connected': { label: 'Not connected', tone: 'neutral' },
  'coming-soon': { label: 'Coming soon', tone: 'neutral' },
}

function IntegrationCard({ item, onOpen }: { item: Integration; onOpen: () => void }) {
  const status = statusCopy[item.status]
  return (
    <button type="button" className="integration-card" onClick={onOpen}>
      <div className="integration-card-head">
        <span className="integration-logo" aria-hidden="true">
          {item.name.slice(0, 2).toUpperCase()}
        </span>
        <div className="integration-card-ident">
          <span className="integration-name">{item.name}</span>
          <span className="integration-vendor">{item.vendor}</span>
        </div>
        <span className={`state-tag state-tag--${status.tone}`}>{status.label}</span>
      </div>
      <p className="integration-summary">{item.summary}</p>
    </button>
  )
}

export function IntegrationsPage() {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Integration | null>(null)

  const matches = integrations.filter((i) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      i.name.toLowerCase().includes(s) ||
      i.summary.toLowerCase().includes(s) ||
      i.category.toLowerCase().includes(s)
    )
  })

  const connectedCount = integrations.filter((i) => i.status === 'connected').length

  return (
    <div className="integrations">
      <div className="integrations-head">
        <input
          type="search"
          className="comp-search"
          placeholder="Search integrations…"
          aria-label="Search integrations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="integrations-count">
          {connectedCount} of {integrations.length} connected
        </p>
      </div>

      {integrationCategories.map((category) => {
        const items = matches.filter((i) => i.category === category)
        if (items.length === 0) return null
        return (
          <section className="integration-group" key={category} aria-labelledby={`cat-${category}`}>
            <h2 id={`cat-${category}`} className="integration-group-title">
              {category}
            </h2>
            <div className="integration-grid">
              {items.map((item) => (
                <IntegrationCard key={item.id} item={item} onOpen={() => setOpen(item)} />
              ))}
            </div>
          </section>
        )
      })}

      {matches.length === 0 && (
        <p className="panel-empty">No integrations match “{search}”.</p>
      )}

      <section className="panel integration-request">
        <div className="panel-head">
          <h2>Need another data source?</h2>
        </div>
        <p className="integration-request-copy">
          New integrations are added to this catalogue as they are built. Each one states what it
          brings into the backoffice, what it needs to connect, and who owns the credentials —
          credentials are always held server-side, never in this interface.
        </p>
        <button type="button" className="btn-secondary" disabled title="Request flow arrives with the backend">
          Request an integration
        </button>
      </section>

      {open && (
        <Modal title={open.name} subtitle={`${open.category} · ${open.vendor}`} onClose={() => setOpen(null)}>
          <p className="integration-summary">{open.summary}</p>

          <h3 className="rail-title">What it brings in</h3>
          <ul className="integration-provides">
            {open.provides.map((p) => (
              <li key={p}>
                <CheckCircleIcon width={15} height={15} />
                {p}
              </li>
            ))}
          </ul>

          <h3 className="rail-title">To connect</h3>
          <p className="integration-requires">
            <IntegrationsIcon width={15} height={15} />
            {open.requires}
          </p>

          {open.status === 'coming-soon' ? (
            <p className="integration-note">
              <ClockIcon width={15} height={15} />
              Not available yet — this entry documents what it will provide.
            </p>
          ) : (
            <p className="integration-note">
              <ClockIcon width={15} height={15} />
              Connecting runs server-side. Credentials are entered by an engineer in the server
              environment, never in this interface.
            </p>
          )}

          <button
            type="button"
            className="form-submit"
            disabled
            title="Connection flow arrives with the backend"
          >
            {open.status === 'connected' ? 'Manage connection' : 'Connect'} (backend required)
          </button>
        </Modal>
      )}
    </div>
  )
}
