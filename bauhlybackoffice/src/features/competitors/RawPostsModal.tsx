import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '../../components/Modal'
import { getRawPosts } from '../../services/competitors/repository'
import type { RawPostItem } from '../../types'

/*
 * Raw Apify payload inspector.
 *
 * Normalisation is lossy and defensive — it reads a few aliases per field and
 * drops the rest — so when a number looks wrong this is how you tell a scraper
 * problem from a mapping problem. It shows exactly what the actor returned, in
 * source order, with no reshaping.
 *
 * Payloads are only stored for posts collected since raw capture was added, so
 * older posts show as "not captured" rather than being hidden — an absent
 * record and an empty one mean very different things when you are debugging.
 */

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleDateString()
}

function RawPostRow({ item }: { item: RawPostItem }) {
  const [open, setOpen] = useState(false)
  const json = item.payload == null ? null : JSON.stringify(item.payload, null, 2)

  return (
    <li className="rawpost">
      <button
        type="button"
        className="rawpost-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={json === null}
        // The label is assembled from separate spans, which leaves the button
        // unnamed for screen readers — say what it does explicitly.
        aria-label={
          json === null
            ? `Post ${item.platformPostId} — no raw payload captured`
            : `${open ? 'Hide' : 'Show'} raw payload for post ${item.platformPostId}`
        }
      >
        <span className="rawpost-chevron" aria-hidden="true">
          {json === null ? '·' : open ? '▾' : '▸'}
        </span>
        <span className="rawpost-id">{item.platformPostId}</span>
        <span className="rawpost-date">{shortDate(item.publishedAt)}</span>
        {json === null ? (
          <span className="rawpost-badge rawpost-badge--missing">not captured</span>
        ) : (
          <span className="rawpost-badge">{(json.length / 1024).toFixed(1)} KB</span>
        )}
      </button>

      {open && json !== null && (
        <div className="rawpost-body">
          <div className="rawpost-actions">
            <span className="rawpost-meta">collected {shortDate(item.collectedAt)}</span>
            <button
              type="button"
              className="filter-clear"
              onClick={() => void navigator.clipboard?.writeText(json)}
            >
              Copy JSON
            </button>
          </div>
          <pre className="rawpost-json">{json}</pre>
        </div>
      )}
    </li>
  )
}

export function RawPostsModal({
  id,
  username,
  onClose,
}: {
  id: string
  username: string
  onClose: () => void
}) {
  const raw = useQuery({ queryKey: ['raw-posts', id], queryFn: () => getRawPosts(id) })

  return (
    <Modal
      title={`Raw Apify JSON — @${username}`}
      subtitle="Exactly what the scraper returned, before normalisation."
      size="lg"
      onClose={onClose}
    >
      {raw.isPending ? (
        <p className="panel-empty">Loading raw payloads…</p>
      ) : raw.isError ? (
        <p className="panel-empty">Could not load raw payloads: {(raw.error as Error).message}</p>
      ) : !raw.data ? (
        <p className="panel-empty">Competitor not found.</p>
      ) : raw.data.items.length === 0 ? (
        /*
         * "Never collected" and "collected fine, but this account has not posted
         * inside the window" look identical from an empty list, and telling
         * someone to run collection on a dormant account sends them chasing a
         * problem that isn't there. Say which one it is.
         */
        <p className="panel-empty">
          {raw.data.lastCollectedAt === null ? (
            <>No collection has run for this account yet. Run collection, then check back.</>
          ) : (
            <>
              Collection last succeeded {shortDate(raw.data.lastCollectedAt)}, but @{raw.data.username}{' '}
              has not posted in the last {raw.data.windowDays} days — so there is nothing in the
              window to show. This is the account being quiet, not a collection failure.
            </>
          )}
        </p>
      ) : (
        <>
          <p className="rawpost-summary">
            {raw.data.capturedCount} of {raw.data.totalPosts} posts have a stored payload.
            {raw.data.capturedCount < raw.data.totalPosts && (
              <>
                {' '}
                Posts collected before raw capture was enabled show as “not captured” — re-run
                collection for this account to fill them in.
              </>
            )}
          </p>
          <ul className="rawpost-list">
            {raw.data.items.map((item) => (
              <RawPostRow key={item.platformPostId} item={item} />
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
