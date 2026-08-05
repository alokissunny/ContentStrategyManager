const InstagramProfile = require('../models/InstagramProfile');

// The user's "current" Instagram account — the one most recently activated or
// switched to in the header (activatedAt), falling back to fetchedAt for legacy
// rows that predate activatedAt. This is the single source of truth for what
// "current handle" means across projects, plans, brand profile and analysis, so
// they all switch together when the account is changed from the header.
const CURRENT_SORT = { activatedAt: -1, fetchedAt: -1 };

// Full profile document (mutable) for the current handle, or null.
function currentProfile(userId) {
  return InstagramProfile.findOne({ user: userId }).sort(CURRENT_SORT);
}

// Just the current handle's username (lowercased), or null when no account is
// connected yet.
async function currentUsername(userId) {
  const profile = await InstagramProfile.findOne({ user: userId })
    .sort(CURRENT_SORT)
    .select('username')
    .lean();
  return profile?.username || null;
}

module.exports = { CURRENT_SORT, currentProfile, currentUsername };
