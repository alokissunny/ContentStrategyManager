import { randomInt } from 'node:crypto'
import { InviteCode } from '../models/inviteCode.ts'

/* 4 characters, letters and digits, without the look-alikes (0/O, 1/I/L) so a code read aloud or
   copied from a screenshot still works. 31^4 ≈ 923k codes. */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_LENGTH = 4
export const INVITE_PATTERN = /^[A-Z0-9]{4}$/

export type InviteStatus = 'unused' | 'used' | 'revoked'

export interface InviteCodeRow {
  id: string
  code: string
  note: string
  status: InviteStatus
  createdBy: string
  createdAt: string
  usedAt: string | null
  usedByEmail: string
  revokedAt: string | null
}

export interface InviteListQuery {
  status?: InviteStatus | 'all'
  search?: string
  page?: number
  pageSize?: number
}

function iso(d: unknown): string | null {
  if (!d) return null
  const date = d instanceof Date ? d : new Date(String(d))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function randomInviteCode(): string {
  let out = ''
  for (let i = 0; i < INVITE_LENGTH; i += 1) out += INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(doc: any): InviteCodeRow {
  const status: InviteStatus = doc.usedAt ? 'used' : doc.revokedAt ? 'revoked' : 'unused'
  return {
    id: String(doc._id),
    code: String(doc.code ?? ''),
    note: String(doc.note ?? ''),
    status,
    createdBy: String(doc.createdBy ?? ''),
    createdAt: iso(doc.createdAt) ?? '',
    usedAt: iso(doc.usedAt),
    usedByEmail: String(doc.usedByEmail ?? ''),
    revokedAt: iso(doc.revokedAt),
  }
}

function statusFilter(status: InviteListQuery['status']): Record<string, unknown> {
  if (status === 'used') return { usedAt: { $ne: null } }
  if (status === 'revoked') return { usedAt: null, revokedAt: { $ne: null } }
  if (status === 'unused') return { usedAt: null, revokedAt: null }
  return {}
}

export async function listInviteCodes(input: InviteListQuery = {}) {
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 50, 1), 200)
  const page = Math.max(Number(input.page) || 1, 1)
  const search = (input.search ?? '').trim()

  const filter: Record<string, unknown> = { ...statusFilter(input.status) }
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i')
    filter.$or = [{ code: rx }, { note: rx }, { usedByEmail: rx }]
  }

  const [total, unused, used, revoked] = await Promise.all([
    InviteCode.countDocuments(filter),
    InviteCode.countDocuments(statusFilter('unused')),
    InviteCode.countDocuments(statusFilter('used')),
    InviteCode.countDocuments(statusFilter('revoked')),
  ])
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)
  const docs = await InviteCode.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .lean()

  return { rows: docs.map(toRow), total, page: safePage, pageCount, counts: { unused, used, revoked } }
}

/* `count` new unused codes. A clash with an existing code (unique index) is retried with a fresh one. */
export async function generateInviteCodes(input: { count: number; note?: string; createdBy?: string }) {
  const count = Math.min(Math.max(Math.floor(input.count) || 1, 1), 100)
  const note = (input.note ?? '').trim().slice(0, 200)
  const made: InviteCodeRow[] = []
  let attempts = 0
  while (made.length < count) {
    attempts += 1
    if (attempts > count * 20) throw new Error('Could not generate unique invitation codes. Try again.')
    try {
      const doc = await InviteCode.create({ code: randomInviteCode(), note, createdBy: input.createdBy ?? '' })
      made.push(toRow(doc.toObject()))
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue
      throw err
    }
  }
  return { rows: made }
}

/* only an unused code can be revoked (or restored); a used one is history */
export async function setInviteRevoked(id: string, revoked: boolean) {
  const doc = await InviteCode.findOneAndUpdate(
    { _id: id, usedAt: null },
    { $set: { revokedAt: revoked ? new Date() : null } },
    { new: true },
  ).lean()
  return doc ? toRow(doc) : null
}

export async function updateInviteNote(id: string, note: string) {
  const doc = await InviteCode.findByIdAndUpdate(id, { $set: { note: note.trim().slice(0, 200) } }, { new: true }).lean()
  return doc ? toRow(doc) : null
}

/* deleting is for codes nobody used; a used code stays as the record of who it let in */
export async function deleteInviteCode(id: string) {
  const res = await InviteCode.deleteOne({ _id: id, usedAt: null })
  return res.deletedCount === 1
}
