import { EarlyAccessRequest } from '../models/earlyAccess.ts'

export interface EarlyAccessListQuery {
  search?: string
  page?: number
  pageSize?: number
}

export interface EarlyAccessRow {
  id: string
  name: string
  instagramHandle: string
  createdAt: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function listEarlyAccessRequests(input: EarlyAccessListQuery = {}) {
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 50, 1), 100)
  const page = Math.max(Number(input.page) || 1, 1)
  const search = (input.search ?? '').trim()

  const filter: Record<string, unknown> = {}
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i')
    filter.$or = [{ name: rx }, { instagramHandle: rx }]
  }

  const total = await EarlyAccessRequest.countDocuments(filter)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)

  const docs = await EarlyAccessRequest.find(filter)
    .select('name instagramHandle createdAt')
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .lean()

  const rows: EarlyAccessRow[] = docs.map((doc) => ({
    id: String(doc._id),
    name: String(doc.name ?? '').trim(),
    instagramHandle: String(doc.instagramHandle ?? '').trim().toLowerCase(),
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt ?? ''),
  }))

  return { rows, total, page: safePage, pageCount }
}
