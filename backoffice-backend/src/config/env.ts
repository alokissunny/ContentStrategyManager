import 'dotenv/config'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`)
  return value
}

export const env = {
  port: Number(process.env.PORT) || 5290,
  mongoUri: process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017/widesignals',
  /** Allowed browser origins. Comma-separated so staging/prod can list several. */
  clientUrls: (process.env.CLIENT_URL ?? 'http://localhost:5190')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: () => required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  collection: {
    postsPerAccount: Number(process.env.COLLECTION_POSTS_PER_ACCOUNT) || 40,
    concurrency: Number(process.env.COLLECTION_CONCURRENCY) || 3,
    /* Backfill run when an account is first added: how far back to keep, and
     * how many posts to pull to be reasonably sure of covering that window.
     *
     * The scraper returns the N most recent posts and the date filter is applied
     * afterwards, so postLimit is the real constraint: at 90 posts over 30 days
     * it only binds above ~3 posts/day. Accounts busier than that get flagged as
     * truncated rather than silently backfilled short (see collectAccount). */
    backfillDays: Number(process.env.COLLECTION_BACKFILL_DAYS) || 30,
    backfillPosts: Number(process.env.COLLECTION_BACKFILL_POSTS) || 90,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  },
}
