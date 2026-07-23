import mongoose from 'mongoose'
import { User } from '../middleware/auth.ts'
import { InstagramProfile, WeeklyRoute } from '../models/customerData.ts'

export interface CustomerListQuery {
  search?: string
  page?: number
  pageSize?: number
}

export interface CustomerRow {
  id: string
  name: string
  email: string
  createdAt: string
  instagramUsername: string | null
  followersCount: number | null
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

export interface CustomerDetail {
  id: string
  name: string
  email: string
  role: string
  createdAt: string
  business: {
    name: string
    goals: string
    audience: string
    positioning: string
  } | null
  profiles: {
    username: string
    fullName: string | null
    followersCount: number | null
    postsCount: number | null
    fetchedAt: string | null
  }[]
  weeklyPlan: CustomerWeeklyPlan | null
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

/** Signed-up Bauhly customers (excludes backoffice admins). */
export async function listCustomers(input: CustomerListQuery = {}) {
  const pageSize = Math.min(Math.max(Number(input.pageSize) || 20, 1), 100)
  const page = Math.max(Number(input.page) || 1, 1)
  const search = (input.search ?? '').trim()

  const filter: Record<string, unknown> = { role: { $ne: 'admin' } }
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
      .select('user username followersCount fetchedAt')
      .sort({ fetchedAt: -1 })
      .lean(),
    WeeklyRoute.find({ user: { $in: ids } })
      .select('user weekLabel focus generatedAt weekOf updatedAt')
      .sort({ weekOf: -1 })
      .lean(),
  ])

  const profileByUser = new Map<string, (typeof profiles)[number]>()
  for (const p of profiles) {
    const key = String(p.user)
    if (!profileByUser.has(key)) profileByUser.set(key, p)
  }

  const routeByUser = new Map<string, (typeof routes)[number]>()
  for (const r of routes) {
    const key = String(r.user)
    if (!routeByUser.has(key)) routeByUser.set(key, r)
  }

  const rows: CustomerRow[] = users.map((u) => {
    const id = String(u._id)
    const profile = profileByUser.get(id)
    const route = routeByUser.get(id)
    const focus = route?.focus as { pillar?: string; headline?: string } | undefined
    return {
      id,
      name: String(u.name ?? ''),
      email: String(u.email ?? ''),
      createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : new Date(0).toISOString(),
      instagramUsername: profile?.username ? String(profile.username) : null,
      followersCount:
        typeof profile?.followersCount === 'number' ? profile.followersCount : null,
      hasWeeklyPlan: Boolean(route),
      weekLabel: route?.weekLabel ? String(route.weekLabel) : null,
      focusPillar: focus?.pillar ? String(focus.pillar) : null,
      focusHeadline: focus?.headline ? String(focus.headline) : null,
      planGeneratedAt: route?.generatedAt
        ? new Date(route.generatedAt as Date).toISOString()
        : null,
    }
  })

  return {
    rows,
    total,
    page: safePage,
    pageCount,
    stats: { totalSignedUp: total },
  }
}

export async function getCustomerDetail(id: string): Promise<CustomerDetail | null> {
  if (!mongoose.isValidObjectId(id)) return null

  const user = (await User.findById(id)
    .select('name email role createdAt business')
    .lean()) as LeanUser | null
  if (!user || user.role === 'admin') return null

  const [profiles, route] = await Promise.all([
    InstagramProfile.find({ user: user._id })
      .select('username fullName followersCount postsCount fetchedAt')
      .sort({ fetchedAt: -1 })
      .lean(),
    WeeklyRoute.findOne({ user: user._id }).sort({ weekOf: -1 }),
  ])

  const business = user.business

  return {
    id: String(user._id),
    name: String(user.name ?? ''),
    email: String(user.email ?? ''),
    role: String(user.role ?? 'user'),
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : new Date(0).toISOString(),
    business: business
      ? {
          name: String(business.name ?? ''),
          goals: String(business.goals ?? ''),
          audience: String(business.audience ?? ''),
          positioning: String(business.positioning ?? ''),
        }
      : null,
    profiles: profiles.map((p) => ({
      username: String(p.username ?? ''),
      fullName: p.fullName ? String(p.fullName) : null,
      followersCount: typeof p.followersCount === 'number' ? p.followersCount : null,
      postsCount: typeof p.postsCount === 'number' ? p.postsCount : null,
      fetchedAt: p.fetchedAt ? new Date(p.fetchedAt as Date).toISOString() : null,
    })),
    weeklyPlan: route ? serializeWeeklyPlan(route) : null,
  }
}
