import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Modal } from '../../components/Modal'
import { deleteCustomer, getDeletionSummary } from '../../services/customers/liveRepository'

/*
 * Confirmation before permanently deleting a customer account.
 *
 * Says exactly what goes (counted from the database, not assumed), and the
 * delete button only wakes once the admin has typed the customer's email — the
 * same email check the API enforces. Admin accounts and the signed-in account
 * are refused by the API; the modal shows why instead of the form.
 */
export function DeleteCustomerModal({
  customerId,
  fallbackName,
  onClose,
  onDeleted,
}: {
  customerId: string
  fallbackName: string
  onClose: () => void
  onDeleted: () => void
}) {
  const [typed, setTyped] = useState('')
  const summary = useQuery({
    queryKey: ['customer-deletion', customerId],
    queryFn: () => getDeletionSummary(customerId),
    staleTime: 0,
  })
  const mutation = useMutation({
    mutationFn: () => deleteCustomer(customerId, typed),
    onSuccess: () => {
      onDeleted()
      onClose()
    },
  })

  const s = summary.data
  const name = s?.name || fallbackName || 'this customer'
  const matches = Boolean(s?.email) && typed.trim().toLowerCase() === s!.email.toLowerCase()
  const busy = mutation.isPending

  return (
    <Modal title={`Delete ${name}?`} subtitle={s?.email} onClose={busy ? () => {} : onClose}>
      {summary.isPending ? (
        <p className="section-note">Checking what this account holds…</p>
      ) : summary.isError || !s ? (
        <p role="alert" className="form-error">
          {summary.error instanceof Error ? summary.error.message : 'Could not load this customer.'}
        </p>
      ) : !s.canDelete ? (
        <>
          <p className="section-note">{s.blockedReason}</p>
          <div className="modal-actions cust-del-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </>
      ) : (
        <form
          className="cust-del"
          onSubmit={(e) => {
            e.preventDefault()
            if (matches && !busy) mutation.mutate()
          }}
        >
          <p className="cust-del-warn">
            This permanently deletes the account and everything Bauhly keeps for it. It cannot be undone.
          </p>

          {s.handles.length > 0 && (
            <p className="section-note">
              Instagram: {s.handles.map((h) => `@${h}`).join(', ')}
            </p>
          )}

          <div className="cust-del-list">
            <span className="cust-del-list-head">What will be deleted</span>
            <ul>
              <li><span>Account and sign-in</span><b>1</b></li>
              {s.items.map((i) => (
                <li key={i.key}><span>{i.label}</span><b>{i.count}</b></li>
              ))}
              <li>
                <span>Uploaded photos, clips and reports</span>
                <b>{s.mediaWillBeDeleted ? 'All' : 'Kept'}</b>
              </li>
            </ul>
            {!s.mediaWillBeDeleted && (
              <p className="section-note">
                Media storage isn’t configured on this server, so their files stay in S3.
              </p>
            )}
          </div>

          <label className="cust-del-confirm">
            <span>
              Type <strong>{s.email}</strong> to confirm
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              disabled={busy}
              aria-label="Customer email to confirm"
            />
          </label>

          {mutation.isError && (
            <p role="alert" className="form-error">
              {mutation.error instanceof Error ? mutation.error.message : 'Could not delete this customer.'}
            </p>
          )}

          <div className="modal-actions cust-del-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-danger cust-del-go" disabled={!matches || busy}>
              {busy ? 'Deleting…' : 'Delete account permanently'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
