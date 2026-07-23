import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
export { Modal } from '../../components/Modal'
import type { CompetitorSuggestion } from '../../types'
import {
  lookupCompetitorProfile,
  parseBulkInstagramInputs,
  type BulkAddResult,
  type BulkCompetitorInput,
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

type AddMode = 'single' | 'bulk'

export function AddCompetitorForm({
  onSubmit,
  onBulkSubmit,
  submitting,
  bulkSubmitting,
  serverError,
}: {
  onSubmit: (input: NewCompetitorInput) => void
  onBulkSubmit: (input: BulkCompetitorInput) => Promise<BulkAddResult>
  submitting: boolean
  bulkSubmitting: boolean
  serverError: string | null
}) {
  const [mode, setMode] = useState<AddMode>('single')
  const [input, setInput] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [preview, setPreview] = useState<ProfilePreview | null>(null)
  const [role, setRole] = useState<NewCompetitorInput['role']>('peer-benchmark')
  const [notes, setNotes] = useState('')
  const [bulkResult, setBulkResult] = useState<BulkAddResult | null>(null)
  const [bulkLocalError, setBulkLocalError] = useState<string | null>(null)

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

  async function handleBulk(e: FormEvent) {
    e.preventDefault()
    setBulkLocalError(null)
    const inputs = parseBulkInstagramInputs(bulkText)
    if (inputs.length === 0) {
      setBulkLocalError('Paste at least one Instagram username or URL.')
      return
    }
    if (inputs.length > 50) {
      setBulkLocalError('Maximum 50 accounts per batch.')
      return
    }
    try {
      const result = await onBulkSubmit({
        inputs,
        role,
        internalNotes: notes || null,
      })
      setBulkResult(result)
    } catch {
      /* parent sets serverError */
    }
  }

  function switchMode(next: AddMode) {
    setMode(next)
    setBulkLocalError(null)
    setBulkResult(null)
    setPreview(null)
    lookup.reset()
  }

  if (bulkResult) {
    return (
      <div className="add-form">
        <p className="bulk-result-summary">
          Added <strong>{bulkResult.added.length}</strong>
          {bulkResult.skipped.length > 0 && (
            <>
              {' '}
              · skipped <strong>{bulkResult.skipped.length}</strong>
            </>
          )}
          {bulkResult.failed.length > 0 && (
            <>
              {' '}
              · failed <strong>{bulkResult.failed.length}</strong>
            </>
          )}
        </p>
        {bulkResult.added.length > 0 && (
          <ul className="bulk-result-list">
            {bulkResult.added.map((a) => (
              <li key={a.id} className="bulk-result-item bulk-result-item--ok">
                @{a.username}
              </li>
            ))}
          </ul>
        )}
        {bulkResult.skipped.length > 0 && (
          <ul className="bulk-result-list">
            {bulkResult.skipped.map((s) => (
              <li key={s.username} className="bulk-result-item bulk-result-item--skip">
                @{s.username} — {s.reason}
              </li>
            ))}
          </ul>
        )}
        {bulkResult.failed.length > 0 && (
          <ul className="bulk-result-list">
            {bulkResult.failed.map((f) => (
              <li key={`${f.username}-${f.error}`} className="bulk-result-item bulk-result-item--fail">
                {f.username} — {f.error}
              </li>
            ))}
          </ul>
        )}
        <p className="form-note">
          Profile snapshots run in the background for newly added accounts.
        </p>
        <button type="button" className="form-submit" onClick={() => setBulkResult(null)}>
          Add more
        </button>
      </div>
    )
  }

  return (
    <div className="add-form">
      <div className="add-mode-tabs" role="tablist" aria-label="Add mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'single'}
          className={mode === 'single' ? 'add-mode-tab add-mode-tab--active' : 'add-mode-tab'}
          onClick={() => switchMode('single')}
        >
          Single
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'bulk'}
          className={mode === 'bulk' ? 'add-mode-tab add-mode-tab--active' : 'add-mode-tab'}
          onClick={() => switchMode('bulk')}
        >
          Multiple
        </button>
      </div>

      {mode === 'single' && !preview && (
        <form onSubmit={handleLookup} noValidate>
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
            only confirm the role.
          </p>
          <button type="submit" className="form-submit" disabled={lookup.isPending}>
            {lookup.isPending ? 'Fetching profile…' : 'Fetch profile'}
          </button>
        </form>
      )}

      {mode === 'single' && preview && (
        <>
          <div className="lookup-preview">
            <div className="comp-ident">
              <span className="comp-avatar" aria-hidden="true">
                {preview.displayName
                  .split(/\s+/)
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 3)
                  .toUpperCase()}
              </span>
              <div>
                <span className="comp-name">
                  {preview.displayName}
                  {preview.verified && (
                    <span className="lookup-verified" title="Verified">
                      {' '}
                      ✓
                    </span>
                  )}
                </span>
                <span className="comp-handle">@{preview.username}</span>
              </div>
            </div>
            <p className="lookup-bio">{preview.biography}</p>
            <dl className="lookup-stats">
              <div>
                <dt>Followers</dt>
                <dd>{preview.followerCount.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>Following</dt>
                <dd>{preview.followingCount.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>Posts</dt>
                <dd>{preview.postCount}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {preview.locationGuess.city ? `${preview.locationGuess.city}, ` : ''}
                  {preview.locationGuess.country}
                </dd>
              </div>
              {preview.website && (
                <div>
                  <dt>Website</dt>
                  <dd>{preview.website.replace('https://', '')}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className="form-field">
            <label htmlFor="add-role">
              Competitor role (suggested:{' '}
              {roleOptions.find(([v]) => v === preview.suggestedRole)?.[1]})
            </label>
            <select
              id="add-role"
              value={role}
              onChange={(e) => setRole(e.target.value as NewCompetitorInput['role'])}
            >
              {roleOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="add-notes">Internal notes (optional)</label>
            <textarea
              id="add-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {serverError && (
            <p role="alert" className="form-error">
              {serverError}
            </p>
          )}
          <p className="form-note">{preview.plannedCollection}</p>
          <div className="lookup-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPreview(null)
                lookup.reset()
              }}
            >
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
        </>
      )}

      {mode === 'bulk' && (
        <form onSubmit={handleBulk} noValidate>
          <div className="form-field">
            <label htmlFor="add-bulk">Instagram accounts *</label>
            <textarea
              id="add-bulk"
              rows={8}
              placeholder={
                '@studio.one\nhttps://instagram.com/studio.two\nstudio.three\n\nOne per line, or comma-separated. Up to 50.'
              }
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              autoFocus
            />
          </div>
          <div className="form-field">
            <label htmlFor="add-bulk-role">Role for all accounts</label>
            <select
              id="add-bulk-role"
              value={role}
              onChange={(e) => setRole(e.target.value as NewCompetitorInput['role'])}
            >
              {roleOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="add-bulk-notes">Internal notes (optional)</label>
            <textarea
              id="add-bulk-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          {(bulkLocalError || serverError) && (
            <p role="alert" className="form-error">
              {bulkLocalError || serverError}
            </p>
          )}
          <p className="form-note">
            Profiles are snapshotted in the background after add. Duplicates are skipped
            automatically.
          </p>
          <button type="submit" className="form-submit" disabled={bulkSubmitting}>
            {bulkSubmitting
              ? 'Adding…'
              : (() => {
                  const n = parseBulkInstagramInputs(bulkText).length
                  if (n === 0) return 'Add competitors'
                  return `Add ${Math.min(n, 50)} competitor${n === 1 ? '' : 's'}`
                })()}
          </button>
        </form>
      )}
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
