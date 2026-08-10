import mongoose from 'mongoose'
import { User } from '../middleware/auth.ts'
import { InstagramProfile, WeeklyRoute } from '../models/customerData.ts'
import { CustomerCohort } from '../models/customerCohort.ts'

export interface CustomerListQuery {
  search?: string
  page?: number
  pageSize?: number
  /** Opt-in: include backoffice admin accounts, which are hidden by default. */
  includeAdmins?: boolean
}

export interface CustomerInstagramAccount {
  username: string
  followersCount: number | null
}

export interface CustomerRow {
  id: string
  name: string
  email: string
  createdAt: string
  /** Instagram handle for this row (one account per row). */
  instagramUsername: string | null
  followersCount: number | null
  /** True when this is not the first account row for the same customer. */
  sameUserContinuation: boolean
  hasWeeklyPlan: boolean
  weekLabel: string | null
  focusPillar: string | null
  focusHeadline: string | null
  planGeneratedAt: string | null
}

export interface WeeklyPlanDay {
  day: string
  dateLabel: string
  time: string
  format: string
  contentType: string
  pillar: string
  goalTag: string
  title: string
  direction: string
  published: boolean
  content: {
    onScreenText: string[]
    caption: string
    cta: string
    hashtags: string[]
    strategy: string
    prompts: string[]
    plan: string
  }
}

export interface CustomerWeeklyPlan {
  id: string
  weekOf: string | null
  weekLabel: string
  model: string | null
  instagramUsername: string
  generatedAt: string | null
  focus: {
    pillar: string
    headline: string
    hypothesis: string
    recommendation: string
    whyMatters: string
    observation: string
  } | null
  funnel: {
    pillar: string
    score: number
    verdict: string
    evidence: string[]
    whyMatters: string
    recommendation: string
  }[]
  days: WeeklyPlanDay[]
}

/** Competitor cohort (Business Type + Location) assigned to one Instagram handle. */
export interface CustomerCohortAssignment {
  instagramUsername: string
  businessCategory: string
  location: string
}

export interface CustomerProfile {
  username: string
  fullName: string | null
  followersCount: number | null
  postsCount: number | null
  fetchedAt: string | null
  /** Cohort assigned to this handle, or null when none has been set. */
  cohort: Omit<CustomerCohortAssignment, 'instagramUsername'> | null
}

export interface CustomerDetail {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
  /**
   * @deprecated Prefer `profiles[].cohort`. Kept as the primary handle's cohort
   * so older clients still parse.
   */
  cohort: Omit<CustomerCohortAssignment, 'instagramUsername'> | null
  business: {
    name: string
    goals: string
    audience: string
    positioning: string
  } | null
  profiles: CustomerProfile[]
  /** Freshest plan overall (legacy). Prefer `weeklyPlans`. */
  weeklyPlan: CustomerWeeklyPlan | null
  /** One plan per Instagram handle that has been presented a route. */
  weeklyPlans: CustomerWeeklyPlan[]
}

function serializeDay(d: Record<string, unknown>): WeeklyPlanDay {
  const content = (d.content ?? {}) as Record<string, unknown>
  return {
    day: String(d.day ?? ''),
    dateLabel: String(d.dateLabel ?? ''),
    time: String(d.time ?? ''),
    format: String(d.format ?? 'Post'),
    contentType: String(d.contentType ?? ''),
    pillar: String(d.pillar ?? 'discovery'),
    goalTag: String(d.goalTag ?? ''),
    title: String(d.title ?? ''),
    direction: String(d.direction ?? ''),
    published: Boolean(d.published),
    content: {
      onScreenText: Array.isArray(content.onScreenText)
        ? content.onScreenText.map(String)
        : [],
      caption: String(content.caption ?? ''),
      cta: String(content.cta ?? ''),
      hashtags: Array.isArray(content.hashtags) ? content.hashtags.map(String) : [],
      strategy: String(content.strategy ?? ''),
      prompts: Array.isArray(content.prompts) ? content.prompts.map(String) : [],
      plan: String(content.plan ?? ''),
    },
  }
}

function serializeWeeklyPlan(doc: InstanceType<typeof WeeklyRoute>): CustomerWeeklyPlan {
  const focus = doc.focus as Record<string, unknown> | null | undefined
  const funnel = (Array.isArray(doc.funnel) ? doc.funnel : []) as Record<string, unknown>[]
  const days = (Array.isArray(doc.days) ? doc.days : []) as Record<string, unknown>[]

  return {
    id: String(doc._id),
    weekOf: doc.weekOf ? new Date(doc.weekOf).toISOString() : null,
    weekLabel: String(doc.weekLabel ?? ''),
    model: doc.model ? String(doc.model) : null,
    instagramUsername: String(doc.instagramUsername ?? ''),
    generatedAt: doc.generatedAt
      ? new Date(doc.generatedAt).toISOString()
      : (doc as { updatedAt?: Date }).updatedAt?.toISOString?.() ?? null,
    focus: focus
      ? {
          pillar: String(focus.pillar ?? 'trust'),
          headline: String(focus.headline ?? ''),
          hypothesis: String(focus.hypothesis ?? ''),
          recommendation: String(focus.recommendation ?? ''),
          whyMatters: String(focus.whyMatters ?? ''),
          observation: String(focus.observation ?? ''),
        }
      : null,
    funnel: funnel.map((row) => ({
      pillar: String(row.pillar ?? ''),
      score: Number(row.score ?? 0),
      verdict: String(row.verdict ?? ''),
      evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
      whyMatters: String(row.whyMatters ?? ''),
      recommendation: String(row.recommendation ?? ''),
    })),
    days: days.map((d) => serializeDay(d)),
  }
}

type LeanUser = {
  _id: mongoose.Types.ObjectId
  name?: string
  email?: string
  role?: string
  createdAt?: Date
  business?: {
    name?: string
    goals?: string
    audience?: string
    positioning?: string
  }
}

function normalizeHandle(input: string): string {
  return input
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/[/?].*$/, '')
    .trim()
    .toLowerCase()
}

/**
 * Signed-up Bauhly customers. Backoffice admins are excluded by default;
 * pass `includeAdmins` to surface them alongside customers.
 */
export async function listCustomers(input: CustomerListQuery = {}) {
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 20, 1), 100)
  const page = Math.max(Number(input.page) || 1, 1)
  const search = (input.search ?? '').trim()

  const filter: Record<string, unknown> = input.includeAdmins ? {} : { role: { $ne: 'admin' } }
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    filter.$or = [{ name: rx }, { email: rx }]
  }

  const total = await User.countDocuments(filter)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pageCount)

  const users = (await User.find(filter)
    .select('name email createdAt')
    .sort({ createdAt: -1 })
    .skip((safePage - 1) * pageSize)
    .limit(pageSize)
    .lean()) as LeanUser[]

  const ids = users.map((u) => u._id)

  const [profiles, routes] = await Promise.all([
    InstagramProfile.find({ user: { $in: ids } })
      .select('user username followersCount fetchedAt activatedAt')
      .sort({ activatedAt: -1, fetchedAt: -1 })
      .lean(),
    WeeklyRoute.find({ user: { $in: ids } })
      .select('user instagramUsername weekLabel focus generatedAt weekOf updatedAt createdAt')
      // Freshest plan first: generatedAt is stamped once when the plan is
      // produced, so a regenerated plan (even for the same weekOf) wins over the
      // stale one. weekOf / createdAt break ties and cover legacy null rows.
      .sort({ generatedAt: -1, weekOf: -1, createdAt: -1 })
      .lean(),
  ])

  const accountsByUser = new Map<string, CustomerInstagramAccount[]>()
  for (const p of profiles) {
    const key = String(p.user)
    const username = p.username ? String(p.username) : ''
    if (!username) continue
    const list = accountsByUser.get(key) ?? []
    list.push({
      username,
      followersCount: typeof p.followersCount === 'number' ? p.followersCount : null,
    })
    accountsByUser.set(key, list)
  }

  // Freshest plan per (user, handle).
  const routeByUserHandle = new Map<string, (typeof routes)[number]>()
  for (const r of routes) {
    const handle = r.instagramUsername ? String(r.instagramUsername).toLowerCase() : ''
    const key = `${String(r.user)}:${handle}`
    if (!routeByUserHandle.has(key)) routeByUserHandle.set(key, r)
  }

  // One table row per Instagram account; same customer's accounts stay back-to-back.
  // Users with no Instagram yet still get a single placeholder row.
  const rows: CustomerRow[] = []
  for (const u of users) {
    const id = String(u._id)
    const accounts = accountsByUser.get(id) ?? []
    const base = {
      id,
      name: String(u.name ?? ''),
      email: String(u.email ?? ''),
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : new Date(0).toISOString(),
    }

    if (accounts.length === 0) {
      rows.push({
        ...base,
        instagramUsername: null,
        followersCount: null,
        sameUserContinuation: false,
        hasWeeklyPlan: false,
        weekLabel: null,
        focusPillar: null,
        focusHeadline: null,
        planGeneratedAt: null,
      })
      continue
    }

    accounts.forEach((account, index) => {
      const route = routeByUserHandle.get(`${id}:${account.username.toLowerCase()}`)
      const focus = route?.focus as { pillar?: string; headline?: string } | undefined
      rows.push({
        ...base,
        instagramUsername: account.username,
        followersCount: account.followersCount,
        sameUserContinuation: index > 0,
        hasWeeklyPlan: Boolean(route),
        weekLabel: route?.weekLabel ? String(route.weekLabel) : null,
        focusPillar: focus?.pillar ? String(focus.pillar) : null,
        focusHeadline: focus?.headline ? String(focus.headline) : null,
        planGeneratedAt: route?.generatedAt
          ? new Date(route.generatedAt as Date).toISOString()
          : null,
      })
    })
  }

  return {
    rows,
    total,
    page: safePage,
    pageCount,
    stats: { totalSignedUp: total },
  }
}

export async function getCustomerDetail(
  id: string,
  options: { includeAdmins?: boolean } = {},
): Promise<CustomerDetail | null> {
  if (!mongoose.isValidObjectId(id)) return null

  const user = (await User.findById(id)
    .select('name email role createdAt business')
    .lean()) as LeanUser | null
  if (!user || (user.role === 'admin' && !options.includeAdmins)) return null

  const [profiles, routes, cohorts] = await Promise.all([
    InstagramProfile.find({ user: user._id })
      .select('username fullName followersCount postsCount fetchedAt activatedAt')
      .sort({ activatedAt: -1, fetchedAt: -1 })
      .lean(),
    WeeklyRoute.find({ user: user._id }).sort({ generatedAt: -1, weekOf: -1, createdAt: -1 }),
    CustomerCohort.find({ user: user._id }).lean() as Promise<
      {
        instagramUsername?: string
        businessCategory?: string
        location?: string
      }[]
    >,
  ])

  const cohortByHandle = new Map<string, { businessCategory: string; location: string }>()
  for (const c of cohorts) {
    const handle = c.instagramUsername ? String(c.instagramUsername).toLowerCase() : ''
    if (!handle) continue
    cohortByHandle.set(handle, {
      businessCategory: String(c.businessCategory ?? 'interior-designer'),
      location: String(c.location ?? 'Global'),
    })
  }

  const serializedProfiles: CustomerProfile[] = profiles.map((p) => {
    const username = String(p.username ?? '')
    const cohort = username ? cohortByHandle.get(username.toLowerCase()) ?? null : null
    return {
      username,
      fullName: p.fullName ? String(p.fullName) : null,
      followersCount: typeof p.followersCount === 'number' ? p.followersCount : null,
      postsCount: typeof p.postsCount === 'number' ? p.postsCount : null,
      fetchedAt: p.fetchedAt ? new Date(p.fetchedAt as Date).toISOString() : null,
      cohort,
    }
  })

  // Freshest plan per handle (routes already sorted newest-first).
  const planByHandle = new Map<string, CustomerWeeklyPlan>()
  for (const route of routes) {
    const handle = String(route.instagramUsername ?? '').toLowerCase()
    if (!handle || planByHandle.has(handle)) continue
    planByHandle.set(handle, serializeWeeklyPlan(route))
  }
  const weeklyPlans = [...planByHandle.values()]
  const weeklyPlan = weeklyPlans[0] ?? null

  const business = user.business
  const primaryCohort = serializedProfiles[0]?.cohort ?? null

  return {
    id: String(user._id),
    name: String(user.name ?? ''),
    email: String(user.email ?? ''),
    role: String(user.role ?? 'user'),
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : new Date(0).toISOString(),
    cohort: primaryCohort,
    business: business
      ? {
          name: String(business.name ?? ''),
          goals: String(business.goals ?? ''),
          audience: String(business.audience ?? ''),
          positioning: String(business.positioning ?? ''),
        }
      : null,
    profiles: serializedProfiles,
    weeklyPlan,
    weeklyPlans,
  }
}

/**
 * Assign (upsert) a competitor cohort — Business Type + Location — to one of
 * the customer's Instagram handles. Returns null when the customer or handle
 * does not exist (or the user is an admin).
 */
export async function setCustomerCohort(
  id: string,
  input: { businessCategory: string; location: string; instagramUsername: string },
  options: { includeAdmins?: boolean } = {},
): Promise<CustomerCohortAssignment | null> {
  if (!mongoose.isValidObjectId(id)) return null

  const user = (await User.findById(id).select('role').lean()) as LeanUser | null
  if (!user || (user.role === 'admin' && !options.includeAdmins)) return null

  const username = normalizeHandle(input.instagramUsername)
  if (!username) return null

  const profile = await InstagramProfile.findOne({ user: id, username }).select('username').lean()
  if (!profile) return null

  const doc = await CustomerCohort.findOneAndUpdate(
    { user: id, instagramUsername: username },
    {
      $set: {
        businessCategory: input.businessCategory,
        location: input.location,
        instagramUsername: username,
        user: id,
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  )

  return {
    instagramUsername: String(doc.instagramUsername),
    businessCategory: String(doc.businessCategory),
    location: String(doc.location),
  }
}
