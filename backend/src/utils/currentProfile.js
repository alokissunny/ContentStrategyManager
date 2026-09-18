const InstagramProfile = require('../models/InstagramProfile');
const { createTtlCache } = require('./ttlCache');

// The user's "current" Instagram account — the one most recently activated or
// switched to in the header (activatedAt), falling back to fetchedAt for legacy
// rows that predate activatedAt. This is the single source of truth for what
// "current handle" means across projects, plans, brand profile and analysis, so
// they all switch together when the account is changed from the header.
const CURRENT_SORT = { activatedAt: -1, fetchedAt: -1 };

// Username lookups happen on almost every calendar/projects/brand request.
// Cache briefly so a page load of 8 parallel GETs does not pay 8 Atlas RTTs.
const usernameCache = createTtlCache({ ttlMs: 20_000, max: 200 });

function invalidateCurrentUsername(userId) {
  if (userId != null) usernameCache.del(userId);
}

// Full profile document (mutable) for the current handle, or null.
function currentProfile(userId) {
  return InstagramProfile.findOne({ user: userId }).sort(CURRENT_SORT);
}

// Just the current handle's username (lowercased), or null when no account is
// connected yet.
async function currentUsername(userId) {
  const key = String(userId || '');
  if (!key) return null;
  const cached = usernameCache.get(key);
  if (cached !== undefined) return cached;

  const profile = await InstagramProfile.findOne({ user: userId })
    .sort(CURRENT_SORT)
    .select('username')
    .lean();
  const username = profile?.username || null;
  usernameCache.set(key, username);
  return username;
}

module.exports = {
  CURRENT_SORT,
  currentProfile,
  currentUsername,
  invalidateCurrentUsername,
};
