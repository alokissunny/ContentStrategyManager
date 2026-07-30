/**
 * Attach real post examples to topic / hashtag rows from condensed exemplars.
 * Captions are never invented — only resolved from the analyzed set.
 */

import type { CondensedAccount } from './analysisCorpus.ts'

export interface ExampleCaption {
  competitor: string
  caption: string
}

const MAX_EXAMPLES = 4

const TOPIC_STOP = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'into',
  'about',
  'over',
  'under',
  'projects',
  'project',
  'design',
  'designs',
  'ideas',
  'decision',
  'decisions',
])

function asTokens(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s&/-]/g, ' ')
    .split(/[\s/&-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !TOPIC_STOP.has(t))
}

function normTag(tag: string): string {
  const t = tag.trim().toLowerCase()
  return t.startsWith('#') ? t : `#${t}`
}

type Scored = ExampleCaption & { score: number }

function pushExample(
  out: Scored[],
  seen: Set<string>,
  competitor: string,
  caption: string,
  score: number,
) {
  const key = caption.trim()
  if (!key || seen.has(key) || score <= 0) return
  seen.add(key)
  out.push({ competitor, caption: key, score })
}

/** Exemplars whose hashtag list or caption carries the tag. */
export function examplesForHashtag(
  tag: string,
  accounts: CondensedAccount[],
  limit = MAX_EXAMPLES,
): ExampleCaption[] {
  const want = normTag(tag)
  const wantBare = want.slice(1)
  const scored: Scored[] = []
  const seen = new Set<string>()

  for (const a of accounts) {
    const name = a.displayName?.trim() || a.username
    for (const e of a.exemplars) {
      const tags = (e.hashtags ?? []).map(normTag)
      const inList = tags.includes(want)
      const inCaption = (e.caption ?? '').toLowerCase().includes(want) ||
        (e.caption ?? '').toLowerCase().includes(wantBare)
      if (!inList && !inCaption) continue
      pushExample(scored, seen, name, e.caption ?? '', inList ? 2 : 1)
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ competitor, caption }) => ({ competitor, caption }))
}

/** Exemplars whose caption overlaps the topic label (token match). */
export function examplesForTopic(
  topic: string,
  accounts: CondensedAccount[],
  limit = MAX_EXAMPLES,
): ExampleCaption[] {
  const tokens = asTokens(topic)
  if (tokens.length === 0) return []
  const scored: Scored[] = []
  const seen = new Set<string>()

  for (const a of accounts) {
    const name = a.displayName?.trim() || a.username
    for (const e of a.exemplars) {
      const caption = (e.caption ?? '').trim()
      if (!caption) continue
      const lower = caption.toLowerCase()
      const score = tokens.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0)
      if (score === 0) continue
      pushExample(scored, seen, name, caption, score)
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || b.caption.length - a.caption.length)
    .slice(0, limit)
    .map(({ competitor, caption }) => ({ competitor, caption }))
}

export function attachHashtagExamples<
  T extends { tag: string; exampleCaptions?: ExampleCaption[] },
>(hashtags: T[], accounts: CondensedAccount[]): T[] {
  return hashtags.map((h) => {
    if (h.exampleCaptions && h.exampleCaptions.length > 0) return h
    const exampleCaptions = examplesForHashtag(h.tag, accounts)
    return exampleCaptions.length > 0 ? { ...h, exampleCaptions } : h
  })
}

export function attachTopicExamples<
  T extends { topic: string; exampleCaptions?: ExampleCaption[] },
>(topics: T[], accounts: CondensedAccount[]): T[] {
  return topics.map((t) => {
    if (t.exampleCaptions && t.exampleCaptions.length > 0) return t
    const exampleCaptions = examplesForTopic(t.topic, accounts)
    return exampleCaptions.length > 0 ? { ...t, exampleCaptions } : t
  })
}
