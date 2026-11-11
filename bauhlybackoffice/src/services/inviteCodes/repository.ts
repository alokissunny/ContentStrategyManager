import { z } from 'zod'
import { USE_MOCKS, api } from '../api'

const inviteStatus = z.enum(['unused', 'used', 'revoked'])
export type InviteStatus = z.infer<typeof inviteStatus>

const inviteCodeRow = z.object({
  id: z.string(),
  code: z.string(),
  note: z.string(),
  status: inviteStatus,
  createdBy: z.string(),
  createdAt: z.string(),
  usedAt: z.string().nullable(),
  usedByEmail: z.string(),
  revokedAt: z.string().nullable(),
})
export type InviteCodeRow = z.infer<typeof inviteCodeRow>

const inviteListResult = z.object({
  rows: z.array(inviteCodeRow),
  total: z.number(),
  page: z.number(),
  pageCount: z.number(),
  counts: z.object({ unused: z.number(), used: z.number(), revoked: z.number() }),
})
export type InviteListResult = z.infer<typeof inviteListResult>

export interface InviteQuery {
  status: InviteStatus | 'all'
  search: string
  page: number
  pageSize: number
}

export const defaultInviteQuery: InviteQuery = { status: 'all', search: '', page: 1, pageSize: 50 }

/* ── mocks (VITE_USE_MOCKS=true) ─────────────────────────────────────────── */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const mockCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
let mockRows: InviteCodeRow[] = [
  { id: 'ic-1', code: 'K7PM', note: 'Design week', status: 'unused', createdBy: 'admin@bauhly.com', createdAt: new Date(Date.now() - 864e5).toISOString(), usedAt: null, usedByEmail: '', revokedAt: null },
  { id: 'ic-2', code: 'R2XD', note: '', status: 'used', createdBy: 'admin@bauhly.com', createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), usedAt: new Date(Date.now() - 2 * 864e5).toISOString(), usedByEmail: 'maya@atelier.com', revokedAt: null },
]

export async function listInviteCodes(q: InviteQuery): Promise<InviteListResult> {
  if (!USE_MOCKS) {
    return inviteListResult.parse(
      await api.get<unknown>('/invite-codes', {
        status: q.status === 'all' ? undefined : q.status,
        search: q.search || undefined,
        page: q.page,
        pageSize: q.pageSize,
      }),
    )
  }
  const s = q.search.trim().toLowerCase()
  const rows = mockRows.filter(
    (r) =>
      (q.status === 'all' || r.status === q.status) &&
      (!s || r.code.toLowerCase().includes(s) || r.note.toLowerCase().includes(s) || r.usedByEmail.includes(s)),
  )
  const counts = {
    unused: mockRows.filter((r) => r.status === 'unused').length,
    used: mockRows.filter((r) => r.status === 'used').length,
    revoked: mockRows.filter((r) => r.status === 'revoked').length,
  }
  return { rows, total: rows.length, page: 1, pageCount: 1, counts }
}

export async function generateInviteCodes(input: { count: number; note: string }): Promise<InviteCodeRow[]> {
  if (!USE_MOCKS) {
    const out = z.object({ rows: z.array(inviteCodeRow) }).parse(await api.post<unknown>('/invite-codes', input))
    return out.rows
  }
  const made = Array.from({ length: input.count }, (_, i) => ({
    id: `ic-${Date.now()}-${i}`,
    code: mockCode(),
    note: input.note,
    status: 'unused' as const,
    createdBy: 'admin@bauhly.com',
    createdAt: new Date().toISOString(),
    usedAt: null,
    usedByEmail: '',
    revokedAt: null,
  }))
  mockRows = [...made, ...mockRows]
  return made
}

export async function setInviteRevoked(id: string, revoked: boolean): Promise<InviteCodeRow> {
  if (!USE_MOCKS) return inviteCodeRow.parse(await api.patch<unknown>(`/invite-codes/${id}`, { revoked }))
  mockRows = mockRows.map((r) =>
    r.id === id ? { ...r, status: revoked ? 'revoked' : 'unused', revokedAt: revoked ? new Date().toISOString() : null } : r,
  )
  return mockRows.find((r) => r.id === id)!
}

export async function deleteInviteCode(id: string): Promise<void> {
  if (!USE_MOCKS) return api.del<void>(`/invite-codes/${id}`)
  mockRows = mockRows.filter((r) => r.id !== id)
}
