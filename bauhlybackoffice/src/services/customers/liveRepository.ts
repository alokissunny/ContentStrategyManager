import { z } from 'zod'
import { ApiError, USE_MOCKS, api } from '../api'

const customerRow = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
  instagramUsername: z.string().nullable(),
  followersCount: z.number().nullable(),
  sameUserContinuation: z.boolean().default(false),
  hasWeeklyPlan: z.boolean(),
  weekLabel: z.string().nullable(),
  focusPillar: z.string().nullable(),
  focusHeadline: z.string().nullable(),
  planGeneratedAt: z.string().nullable(),
})
export type CustomerRow = z.infer<typeof customerRow>

const weeklyPlanDay = z.object({
  day: z.string(),
  dateLabel: z.string(),
  time: z.string(),
  format: z.string(),
  contentType: z.string(),
  pillar: z.string(),
  goalTag: z.string(),
  title: z.string(),
  direction: z.string(),
  published: z.boolean(),
  content: z.object({
    onScreenText: z.array(z.string()),
    caption: z.string(),
    cta: z.string(),
    hashtags: z.array(z.string()),
    strategy: z.string(),
    prompts: z.array(z.string()),
    plan: z.string(),
  }),
})

const customerWeeklyPlan = z.object({
  id: z.string(),
  weekOf: z.string().nullable(),
  weekLabel: z.string(),
  model: z.string().nullable(),
  instagramUsername: z.string(),
  generatedAt: z.string().nullable(),
  focus: z
    .object({
      pillar: z.string(),
      headline: z.string(),
      hypothesis: z.string(),
      recommendation: z.string(),
      whyMatters: z.string(),
      observation: z.string(),
    })
    .nullable(),
  funnel: z.array(
    z.object({
      pillar: z.string(),
      score: z.number(),
      verdict: z.string(),
      evidence: z.array(z.string()),
      whyMatters: z.string(),
      recommendation: z.string(),
    }),
  ),
  days: z.array(weeklyPlanDay),
})
export type CustomerWeeklyPlan = z.infer<typeof customerWeeklyPlan>

const cohortFields = z.object({
  businessCategory: z.string(),
  location: z.string(),
})

const customerCohort = cohortFields.extend({
  instagramUsername: z.string().optional(),
})
export type CustomerCohort = z.infer<typeof customerCohort>

const customerProfile = z.object({
  username: z.string(),
  fullName: z.string().nullable(),
  followersCount: z.number().nullable(),
  postsCount: z.number().nullable(),
  fetchedAt: z.string().nullable(),
  cohort: cohortFields.nullable().optional().default(null),
})

const customerDetail = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  createdAt: z.string(),
  cohort: cohortFields.nullable(),
  business: z
    .object({
      name: z.string(),
      goals: z.string(),
      audience: z.string(),
      positioning: z.string(),
    })
    .nullable(),
  profiles: z.array(customerProfile),
  weeklyPlan: customerWeeklyPlan.nullable(),
  weeklyPlans: z.array(customerWeeklyPlan).default([]),
})
export type CustomerDetail = z.infer<typeof customerDetail>

const customerListResult = z.object({
  rows: z.array(customerRow),
  total: z.number(),
  page: z.number(),
  pageCount: z.number(),
  stats: z.object({ totalSignedUp: z.number() }),
})
export type CustomerListResult = z.infer<typeof customerListResult>

export interface CustomerQuery {
  search: string
  page: number
  pageSize: number
  /** Surface backoffice admin accounts, which are hidden by default. */
  includeAdmins: boolean
}

export const defaultCustomerQuery: CustomerQuery = {
  search: '',
  page: 1,
  pageSize: 20,
  includeAdmins: false,
}

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Bauhly customer signups + whether a weekly plan has been presented. */
export async function listCustomers(q: CustomerQuery): Promise<CustomerListResult> {
  if (!USE_MOCKS) {
    return customerListResult.parse(
      await api.get<unknown>('/customers', {
        search: q.search || undefined,
        page: q.page,
        pageSize: q.pageSize,
        includeAdmins: q.includeAdmins ? '1' : undefined,
      }),
    )
  }
  await delay()
  return {
    rows: [],
    total: 0,
    page: 1,
    pageCount: 1,
    stats: { totalSignedUp: 0 },
  }
}

export async function getCustomerDetail(
  id: string,
  options: { includeAdmins?: boolean } = {},
): Promise<CustomerDetail | null> {
  if (!USE_MOCKS) {
    try {
      return customerDetail.parse(
        await api.get<unknown>(`/customers/${id}`, {
          includeAdmins: options.includeAdmins ? '1' : undefined,
        }),
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
  await delay()
  return null
}

/** Assign the competitor cohort to one of the customer's Instagram handles. */
export async function updateCustomerCohort(
  id: string,
  input: { businessCategory: string; location: string; instagramUsername: string },
  options: { includeAdmins?: boolean } = {},
): Promise<CustomerCohort> {
  if (!USE_MOCKS) {
    const suffix = options.includeAdmins ? '?includeAdmins=1' : ''
    return customerCohort.parse(
      await api.patch<unknown>(`/customers/${id}/cohort${suffix}`, input),
    )
  }
  await delay()
  return input
}

/* ── Customer activity: captures, generated posts, edit log ─────────────── */

const captureLog = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  createdAt: z.string().nullable(),
  type: z.string(),
  sessionId: z.string(),
  title: z.string(),
  text: z.string(),
  status: z.enum(['excluded', 'used', 'unclear', 'needs-info', 'ready']),
  photos: z.number(),
  videos: z.number(),
  questions: z.array(z.string()),
  missingPiece: z.string(),
  turns: z.array(z.object({ role: z.string(), text: z.string() })),
  usedInPlanAt: z.string().nullable(),
  usedInPosts: z.number(),
})

const generatedPostLog = z.object({
  id: z.string(),
  date: z.string(),
  title: z.string(),
  format: z.string(),
  pillar: z.string(),
  generatedAt: z.string().nullable(),
  model: z.string(),
  slides: z.array(z.object({ role: z.string(), title: z.string() })),
  caption: z.string(),
  hashtags: z.array(z.string()),
  seenAt: z.string().nullable(),
  published: z.boolean(),
  scheduledAt: z.string().nullable(),
  savedForReview: z.boolean(),
  costUsd: z.number(),
  edits: z.number(),
  lastEditedAt: z.string().nullable(),
})

const editLog = z.object({
  id: z.string(),
  at: z.string().nullable(),
  firstAt: z.string().nullable(),
  action: z.string(),
  label: z.string(),
  count: z.number(),
  postId: z.string().nullable(),
  postTitle: z.string(),
  postDate: z.string(),
  hasPreview: z.boolean().default(false),
  changes: z.array(z.object({ field: z.string(), before: z.string(), after: z.string() })),
})

const customerActivity = z.object({
  handle: z.string().nullable(),
  captures: z.array(captureLog),
  posts: z.array(generatedPostLog),
  edits: z.array(editLog),
  totals: z.object({ captures: z.number(), posts: z.number(), edits: z.number() }),
})

export type CaptureLog = z.infer<typeof captureLog>
export type GeneratedPostLog = z.infer<typeof generatedPostLog>
export type EditLog = z.infer<typeof editLog>
export type CustomerActivity = z.infer<typeof customerActivity>

export async function getCustomerActivity(
  id: string,
  options: { handle?: string | null; includeAdmins?: boolean } = {},
): Promise<CustomerActivity | null> {
  if (!USE_MOCKS) {
    try {
      return customerActivity.parse(
        await api.get<unknown>(`/customers/${id}/activity`, {
          handle: options.handle || undefined,
          includeAdmins: options.includeAdmins ? '1' : undefined,
        }),
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
  await delay()
  return { handle: options.handle ?? null, captures: [], posts: [], edits: [], totals: { captures: 0, posts: 0, edits: 0 } }
}

const postPreview = z.object({
  id: z.string(),
  title: z.string(),
  format: z.string(),
  html: z.string(),
  slideCount: z.number(),
  height: z.number(),
})

export type PostPreview = z.infer<typeof postPreview>

/** A generated post's carousel document (photos resolved) for the slide preview. */
export async function getPostPreview(
  customerId: string,
  postId: string,
  options: { includeAdmins?: boolean } = {},
): Promise<PostPreview | null> {
  if (!USE_MOCKS) {
    try {
      return postPreview.parse(
        await api.get<unknown>(`/customers/${customerId}/posts/${postId}/preview`, {
          includeAdmins: options.includeAdmins ? '1' : undefined,
        }),
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
  await delay()
  return null
}

const editPreview = z.object({
  before: z.string(),
  after: z.string(),
  height: z.number(),
  changed: z.array(z.number()),
})

export type EditPreview = z.infer<typeof editPreview>

/** An edit-log entry's carousel document before and after (photos resolved). */
export async function getEditPreview(
  customerId: string,
  editId: string,
  options: { includeAdmins?: boolean } = {},
): Promise<EditPreview | null> {
  if (!USE_MOCKS) {
    try {
      return editPreview.parse(
        await api.get<unknown>(`/customers/${customerId}/edits/${editId}/preview`, {
          includeAdmins: options.includeAdmins ? '1' : undefined,
        }),
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null
      throw err
    }
  }
  await delay()
  return null
}
