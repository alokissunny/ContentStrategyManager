import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
export { Modal } from '../../components/Modal'
import type { CompetitorSuggestion } from '../../types'
import {
  lookupCompetitorProfile,
  type NewCompetitorInput,
  type ProfilePreview,
} from '../../services/competitors/repository'

/* Modal shell + Add Competitor form + Discovery suggestions review. */

/* ── Add competitor — two-step lookup flow ────────────────────────────────── */

const roleOptions = [
  ['direct-competitor', 'Direct competitor'],
  ['peer-benchmark', 'Peer benchmark'],
  ['local-competitor', 'Local competitor'],
  ['high-performing-peer', 'High-performing peer'],
  ['aspirational', 'Aspirational'],
  ['emerging', 'Emerging'],
  ['content-style', 'Content-style'],
] as const

export function AddCompetitorForm({
  onSubmit,
  submitting,
  serverError,
}: {
  onSubmit: (input: NewCompetitorInput) => void
  submitting: boolean
  serverError: string | null
}) {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<ProfilePreview | null>(null)
  const [role, setRole] = useState<NewCompetitorInput['role']>('peer-benchmark')
  const [notes, setNotes] = useState('')

  const lookup = useMutation({
    mutationFn: lookupCompetitorProfile,
    onSuccess: (profile) => {
      setPreview(profile)
      setRole(profile.suggestedRole)
    },
  })

  function handleLookup(e: FormEvent) {
    e.preventDefault()
    lookup.mutate(input)
  }

  if (!preview) {
    return (
      <form onSubmit={handleLookup} noValidate className="add-form">
        <div className="form-field">
          <label htmlFor="add-url">Instagram URL or username *</label>
          <input
            id="add-url"
            placeholder="https://instagram.com/studio.example  ·  @studio.example"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          {lookup.isError && (
            <p role="alert" className="form-error">
              {(lookup.error as Error).message}
            </p>
          )}
        </div>
        <p className="form-note">
          Bauhly fetches the profile automatically — name, biography, followers and location. You
          only confirm the role. (Mocked lookup until collection connects in Phase 6.)
        </p>
        <button type="submit" className="form-submit" disabled={lookup.isPending}>
          {lookup.isPending ? 'Fetching profile…' : 'Fetch profile'}
        </button>
      </form>
    )
  }

  return (
    <div className="add-form">
      <div className="lookup-preview">
        <div className="comp-ident">
          <span className="comp-avatar" aria-hidden="true">
            {preview.displayName.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase()}
          </span>
          <div>
            <span className="comp-name">
              {preview.displayName}
              {preview.verified && <span className="lookup-verified" title="Verified"> ✓</span>}
            </span>
            <span className="comp-handle">@{preview.username}</span>
          </div>
        </div>
        <p className="lookup-bio">{preview.biography}</p>
        <dl className="lookup-stats">
          <div><dt>Followers</dt><dd>{preview.followerCount.toLocaleString('en-US')}</dd></div>
          <div><dt>Following</dt><dd>{preview.followingCount.toLocaleString('en-US')}</dd></div>
          <div><dt>Posts</dt><dd>{preview.postCount}</dd></div>
          <div>
            <dt>Location</dt>
            <dd>{preview.locationGuess.city ? `${preview.locationGuess.city}, ` : ''}{preview.locationGuess.country}</dd>
          </div>
          {preview.website && (
            <div><dt>Website</dt><dd>{preview.website.replace('https://', '')}</dd></div>
          )}
        </dl>
      </div>
      <div className="form-field">
        <label htmlFor="add-role">Competitor role (suggested: {roleOptions.find(([v]) => v === preview.suggestedRole)?.[1]})</label>
        <select id="add-role" value={role} onChange={(e) => setRole(e.target.value as NewCompetitorInput['role'])}>
          {roleOptions.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label htmlFor="add-notes">Internal notes (optional)</label>
        <textarea id="add-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {serverError && (
        <p role="alert" className="form-error">{serverError}</p>
      )}
      <p className="form-note">{preview.plannedCollection} Added as <strong>Awaiting review</strong>.</p>
      <div className="lookup-actions">
        <button type="button" className="btn-secondary" onClick={() => { setPreview(null); lookup.reset() }}>
          ‹ Different account
        </button>
        <button
          type="button"
          className="form-submit lookup-confirm"
          disabled={submitting}
          onClick={() =>
            onSubmit({
              username: preview.username,
              displayName: preview.displayName,
              website: preview.website,
              country: preview.locationGuess.country,
              city: preview.locationGuess.city,
              language: null,
              role,
              specialization: null,
              internalNotes: notes || null,
              followerCount: preview.followerCount,
            })
          }
        >
          {submitting ? 'Adding…' : 'Add competitor'}
        </button>
      </div>
    </div>
  )
}

/* ── Discovery suggestions ────────────────────────────────────────────────── */

const similarityLabels: [keyof CompetitorSuggestion['similarity'], string][] = [
  ['locationMatch', 'Location'],
  ['followerRangeMatch', 'Follower range'],
  ['serviceMatch', 'Services'],
  ['contentStyleMatch', 'Content style'],
]

export function SuggestionList({
  suggestions,
  onResolve,
  busyId,
}: {
  suggestions: CompetitorSuggestion[]
  onResolve: (id: string, resolution: 'approved' | 'rejected' | 'saved-for-later', reason?: string) => void
  busyId: string | null
}) {
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  if (suggestions.length === 0) {
    return (
      <p className="panel-empty">
        No pending suggestions. Discovery runs again after the next collection cycle.
      </p>
    )
  }

  return (
    <ul className="suggestion-list">
      {suggestions.map((s) => (
        <li className="suggestion" key={s.id}>
          <div className="suggestion-head">
            <span className="comp-name">@{s.username}</span>
            <span className="suggestion-confidence">
              {Math.round(s.confidence * 100)}% confidence · suggested role: {s.suggestedRole}
            </span>
          </div>
          <p className="suggestion-reason">{s.reason}</p>
          <div className="suggestion-similarity">
            {similarityLabels.map(([key, label]) => (
              <span
                key={key}
                className={`sim-chip ${s.similarity[key] ? 'sim-chip--match' : 'sim-chip--miss'}`}
              >
                {s.similarity[key] ? '✓' : '✕'} {label}
              </span>
            ))}
          </div>
          {rejectingId === s.id ? (
            <div className="suggestion-reject">
              <label htmlFor={`reject-${s.id}`}>Rejection reason (required)</label>
              <input
                id={`reject-${s.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. retail account, not a studio"
              />
              <div className="suggestion-actions">
                <button
                  type="button"
                  className="btn-danger"
                  disabled={!reason.trim() || busyId === s.id}
                  onClick={() => {
                    onResolve(s.id, 'rejected', reason.trim())
                    setRejectingId(null)
                    setReason('')
                  }}
                >
                  Confirm rejection
                </button>
                <button type="button" onClick={() => setRejectingId(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="suggestion-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={busyId === s.id}
                onClick={() => onResolve(s.id, 'approved')}
              >
                Approve
              </button>
              <button type="button" disabled={busyId === s.id} onClick={() => setRejectingId(s.id)}>
                Reject
              </button>
              <button
                type="button"
                disabled={busyId === s.id || s.status === 'saved-for-later'}
                onClick={() => onResolve(s.id, 'saved-for-later')}
              >
                {s.status === 'saved-for-later' ? 'Saved for later' : 'Save for later'}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
