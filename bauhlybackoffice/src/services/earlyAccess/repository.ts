import { z } from 'zod'
import { USE_MOCKS, api } from '../api'

const earlyAccessRow = z.object({
  id: z.string(),
  name: z.string(),
  instagramHandle: z.string(),
  createdAt: z.string(),
})
export type EarlyAccessRow = z.infer<typeof earlyAccessRow>

const earlyAccessListResult = z.object({
  rows: z.array(earlyAccessRow),
  total: z.number(),
  page: z.number(),
  pageCount: z.number(),
})
export type EarlyAccessListResult = z.infer<typeof earlyAccessListResult>

export interface EarlyAccessQuery {
  search: string
  page: number
  pageSize: number
}

export const defaultEarlyAccessQuery: EarlyAccessQuery = {
  search: '',
  page: 1,
  pageSize: 50,
}

const MOCK_ROWS: EarlyAccessRow[] = [
  {
    id: 'ea-1',
    name: 'Maya Atelier',
    instagramHandle: 'maya.atelier',
    createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
  },
  {
    id: 'ea-2',
    name: 'Casa Norte',
    instagramHandle: 'casanorte',
    createdAt: new Date(Date.now() - 5 * 864e5).toISOString(),
  },
  {
    id: 'ea-3',
    name: 'Studio Vale',
    instagramHandle: 'studiovale',
    createdAt: new Date(Date.now() - 9 * 864e5).toISOString(),
  },
]

export async function listEarlyAccessRequests(q: EarlyAccessQuery): Promise<EarlyAccessListResult> {
  if (!USE_MOCKS) {
    return earlyAccessListResult.parse(
      await api.get<unknown>('/early-access', {
        search: q.search || undefined,
        page: q.page,
        pageSize: q.pageSize,
      }),
    )
  }

  const search = q.search.trim().toLowerCase()
  const filtered = search
    ? MOCK_ROWS.filter(
        (row) =>
          row.name.toLowerCase().includes(search) || row.instagramHandle.toLowerCase().includes(search),
      )
    : MOCK_ROWS
  const pageCount = Math.max(1, Math.ceil(filtered.length / q.pageSize))
  const page = Math.min(Math.max(q.page, 1), pageCount)
  const start = (page - 1) * q.pageSize
  return {
    rows: filtered.slice(start, start + q.pageSize),
    total: filtered.length,
    page,
    pageCount,
  }
}
