import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Signal } from '../../types'
import {
  computeSignals,
  defaultSignalsQuery,
  segmentPresets,
  type SignalsQuery,
} from '../../services/signals/repository'
import './signals.css'

/*
 * The landing surface. A strategist opens this, reads three things that
 * changed, and leaves with an action. Everything here serves that.
 *
 * Handled signals persist, because a feed that refills on reload is a feed
 * nobody works through.
 */

const HANDLED_KEY = 'bauhly.signals.handled'

const KIND_LABEL: Record<Signal['kind'], string> = {
  pattern: 'New pattern',
  customer: 'Customer alert',
  'demand-gap': 'Demand gap',
  recommendation: 'Our advice',
  collection: 'Collection issue',
}

function loadHandled(): Set<string> {
  try {
    const raw = localStorage.getItem(HANDLED_KEY)
    return new Set<string>(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function relativeDay(iso: string): string {
  const days = Math.round((Date.parse('2026-07-19T09:00:00+02:00') - Date.parse(iso)) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function PostList({ posts }: { posts: Signal['posts'] }) {
  const [open, setOpen] = useState(false)
  if (!posts.length) return null

  return (
    <div className="signal-posts">
      <button type="button" className="signal-posts-toggle" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} {posts.length} example post{posts.length > 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="signal-post-list">
          {posts.map((p) => (
            <li key={p.id} className="signal-post">
              <div className="signal-post-head">
                <span className="signal-post-user">@{p.username}</span>
                <span className="signal-post-format">{p.format}</span>
                <span className="signal-post-date">{relativeDay(p.postedAt)}</span>
              </div>
              <p className="signal-post-caption">{p.captionExcerpt}</p>
              <div className="signal-post-foot">
                <span>
                  {p.likeCount?.toLocaleString('en-US')} likes ·{' '}
                  {p.commentCount?.toLocaleString('en-US')} comments
                </span>
                <a href={p.permalink} target="_blank" rel="noopener noreferrer">
                  Open on Instagram ↗
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SignalCard({
  signal,
  handled,
  onToggleHandled,
}: {
  signal: Signal
  handled: boolean
  onToggleHandled: (id: string) => void
}) {
  return (
    <article className={`signal-card signal-card--${signal.tone}${handled ? ' signal-card--handled' : ''}`}>
      <div className="signal-card-top">
        <span className={`signal-kind signal-kind--${signal.tone}`}>{KIND_LABEL[signal.kind]}</span>
        <span className={`evidence-tag evidence-tag--${signal.strength}`}>{signal.strength}</span>
        <span className="signal-when">{relativeDay(signal.detectedAt)}</span>
      </div>

      <h3 className="signal-headline">{signal.headline}</h3>
      <p className="signal-detail">{signal.detail}</p>

      <dl className="signal-evidence">
        {signal.evidence.map((e) => (
          <div key={e.label}>
            <dt>{e.label}</dt>
            <dd>{e.value}</dd>
          </div>
        ))}
      </dl>

      <PostList posts={signal.posts} />

      <div className="signal-actions">
        {signal.actions.map((a) =>
          a.to ? (
            <Link key={a.label} className="signal-action" to={a.to}>
              {a.label}
            </Link>
          ) : (
            <button
              key={a.label}
              type="button"
              className="signal-action signal-action--ghost"
              onClick={() => onToggleHandled(signal.id)}
            >
              {handled ? 'Reopen' : a.label}
            </button>
          ),
        )}
        {!signal.actions.some((a) => a.to === null) && (
          <button
            type="button"
            className="signal-action signal-action--ghost"
            onClick={() => onToggleHandled(signal.id)}
          >
            {handled ? 'Reopen' : 'Mark handled'}
          </button>
        )}
        <span className="signal-source">from {signal.derivedFrom}</span>
      </div>
    </article>
  )
}

export function SignalsPage() {
  const [query, setQuery] = useState<SignalsQuery>(defaultSignalsQuery)
  const [presetId, setPresetId] = useState<string>('core')
  const [handled, setHandled] = useState<Set<string>>(loadHandled)
  const [showReviewed, setShowReviewed] = useState(false)

  useEffect(() => {
    localStorage.setItem(HANDLED_KEY, JSON.stringify([...handled]))
  }, [handled])

  const signals = useMemo(() => computeSignals(query), [query])
  const open = signals.filter((s) => !handled.has(s.id))
  const reviewed = signals.filter((s) => handled.has(s.id))

  const toggleHandled = (id: string) =>
    setHandled((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const counts = {
    alert: open.filter((s) => s.tone === 'alert').length,
    opportunity: open.filter((s) => s.tone === 'opportunity').length,
  }

  return (
    <div className="signals-page">
      <div className="signals-controls">
        <div className="filter-field">
          <label htmlFor="sig-window">Window</label>
          <select
            id="sig-window"
            value={query.window}
            onChange={(e) => setQuery((q) => ({ ...q, window: e.target.value as SignalsQuery['window'] }))}
          >
            <option value="this-week">This week vs last</option>
            <option value="this-month">This month vs last</option>
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="sig-segment">Segment</label>
          <select
            id="sig-segment"
            value={presetId}
            onChange={(e) => {
              const preset = segmentPresets.find((p) => p.id === e.target.value)
              if (!preset) return
              setPresetId(preset.id)
              setQuery((q) => ({ ...q, segment: preset.filters }))
            }}
          >
            {segmentPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-field">
          <label htmlFor="sig-kind">Type</label>
          <select
            id="sig-kind"
            value={query.kinds === 'all' ? 'all' : query.kinds[0]}
            onChange={(e) =>
              setQuery((q) => ({
                ...q,
                kinds: e.target.value === 'all' ? 'all' : [e.target.value as Signal['kind']],
              }))
            }
          >
            <option value="all">Everything</option>
            <option value="pattern">New patterns</option>
            <option value="customer">Customer alerts</option>
            <option value="demand-gap">Demand gaps</option>
            <option value="recommendation">Our advice</option>
          </select>
        </div>

        <p className="signals-count">
          <strong>{open.length}</strong> to review
          {counts.alert > 0 && <> · {counts.alert} need attention</>}
          {counts.opportunity > 0 && <> · {counts.opportunity} opportunities</>}
        </p>
      </div>

      {open.length === 0 ? (
        <div className="signals-empty">
          <p className="signals-empty-title">Nothing left to review.</p>
          <p className="signals-empty-body">
            {reviewed.length > 0
              ? `You have handled all ${reviewed.length} signals in this segment. New ones appear after the next collection run.`
              : 'No pattern moved far enough, no customer changed state, and no demand gap opened in this window.'}
          </p>
        </div>
      ) : (
        <div className="signals-feed">
          {open.map((s) => (
            <SignalCard key={s.id} signal={s} handled={false} onToggleHandled={toggleHandled} />
          ))}
        </div>
      )}

      {reviewed.length > 0 && (
        <div className="signals-reviewed">
          <button type="button" className="signals-reviewed-toggle" onClick={() => setShowReviewed((v) => !v)}>
            ✓ Reviewed ({reviewed.length}) {showReviewed ? '↑' : '↓'}
          </button>
          {showReviewed && (
            <div className="signals-feed signals-feed--reviewed">
              {reviewed.map((s) => (
                <SignalCard key={s.id} signal={s} handled onToggleHandled={toggleHandled} />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="signals-footnote">
        Signals summarise numbers computed elsewhere — each card names its source. Nothing here is
        measured independently, so a signal cannot disagree with the panel it came from.
      </p>
    </div>
  )
}
