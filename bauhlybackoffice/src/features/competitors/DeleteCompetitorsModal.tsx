import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Modal } from '../../components/Modal'
import { deleteCompetitors } from '../../services/competitors/repository'

/*
 * Deletion confirmation.
 *
 * Two outcomes, deliberately not equally easy to reach:
 *
 *   Remove   — the default. Marks the accounts `deleted` so they leave the
 *              register and stop being collected, while their snapshots and
 *              posts survive. Reversible, and past benchmarks stay reproducible.
 *
 *   Purge    — destroys the accounts and everything ever observed about them.
 *              Irreversible, so it sits behind an explicit opt-in and the
 *              button restates exactly what is about to be destroyed.
 */
export function DeleteCompetitorsModal({
  usernames,
  ids,
  onClose,
  onDeleted,
}: {
  usernames: string[]
  ids: string[]
  onClose: () => void
  onDeleted: () => void
}) {
  const [purge, setPurge] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => deleteCompetitors(ids, purge),
    onSuccess: () => {
      onDeleted()
      onClose()
    },
    onError: (err: unknown) =>
      setError(err instanceof Error ? err.message : 'Could not delete these competitors.'),
  })

  const count = ids.length
  const noun = count === 1 ? 'competitor' : 'competitors'

  return (
    <Modal
      title={`Delete ${count} ${noun}?`}
      subtitle={usernames.map((u) => `@${u}`).join(', ')}
      onClose={onClose}
    >
      <div className="modal-body">
        <p className="section-note">
          {purge
            ? 'Everything collected about these accounts — profile snapshots, posts and engagement history — will be destroyed. Benchmarks that used this data can no longer be reproduced.'
            : 'These accounts leave the register and stop being collected. Their collected history is kept, so this can be undone by setting their status back.'}
        </p>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={purge}
            onChange={(e) => {
              setPurge(e.target.checked)
              setError(null)
            }}
          />
          <span>
            <strong>Also delete all collected data</strong>
            <br />
            <span className="section-note">
              Use for accounts added by mistake. This cannot be undone.
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? 'Deleting…'
              : purge
                ? `Permanently delete ${count} ${noun} and all data`
                : `Remove ${count} ${noun}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
