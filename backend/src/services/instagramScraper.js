const getApifyClient = require('./apifyClient');

function firstDefined(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

// Apify actor output field names vary by actor version, so we read a few
// common aliases defensively instead of trusting one exact schema.
function normalizeProfile(raw) {
  // The actor returns an item with an `error` field (e.g. `not_found`) for
  // handles that don't exist or can't be read — treat those as "no profile"
  // rather than a real account with zeroed-out stats.
  if (!raw || raw.error) return null;
  return {
    username: firstDefined(raw, ['username', 'account']),
    fullName: firstDefined(raw, ['fullName', 'full_name']) || '',
    biography: firstDefined(raw, ['biography', 'bio']) || '',
    followersCount: firstDefined(raw, ['followersCount', 'followers_count', 'followers']) || 0,
    followingCount: firstDefined(raw, ['followsCount', 'followingCount', 'following']) || 0,
    postsCount: firstDefined(raw, ['postsCount', 'posts_count']) || 0,
    profilePicUrl: firstDefined(raw, ['profilePicUrlHD', 'profilePicUrl', 'profile_pic_url']) || '',
    isVerified: Boolean(firstDefined(raw, ['verified', 'isVerified'])),
    externalUrl: firstDefined(raw, ['externalUrl', 'external_url']) || '',
  };
}

function normalizePost(raw) {
  return {
    externalId: String(firstDefined(raw, ['id', 'shortCode', 'pk']) || ''),
    caption: firstDefined(raw, ['caption', 'text']) || '',
    likesCount: firstDefined(raw, ['likesCount', 'likes_count', 'likes']) || 0,
    commentsCount: firstDefined(raw, ['commentsCount', 'comments_count', 'comments']) || 0,
    timestamp: firstDefined(raw, ['timestamp', 'takenAt', 'taken_at']) || null,
    type: firstDefined(raw, ['type', 'productType']) || 'post',
    url: firstDefined(raw, ['url', 'postUrl']) || '',
    displayUrl: firstDefined(raw, ['displayUrl', 'display_url', 'imageUrl']) || '',
  };
}

async function scrapeProfile(username) {
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || 'apify/instagram-profile-scraper';
  const run = await client.actor(actorId).call({ usernames: [username] });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return normalizeProfile(items[0]);
}

// Check whether a handle actually resolves on Instagram. Returns one of:
//   'exists'  — real account (profile included)
//   'missing' — actor confirmed the handle does not exist
//   'unknown' — the account was blocked/rate-limited/errored ambiguously,
//               so we can't say either way (don't drop it on this basis).
async function probeProfile(username) {
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || 'apify/instagram-profile-scraper';
  const run = await client.actor(actorId).call({ usernames: [username] });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  const raw = items[0];

  if (!raw) return { status: 'unknown', profile: null };
  if (raw.error) {
    const notFound =
      /not[_\s-]?found/i.test(String(raw.error)) ||
      /(does not exist|no such|page not found)/i.test(String(raw.errorDescription || ''));
    return { status: notFound ? 'missing' : 'unknown', profile: null };
  }
  return { status: 'exists', profile: normalizeProfile(raw) };
}

async function scrapePosts(username, limit) {
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_POST_ACTOR || 'apify/instagram-post-scraper';
  const resultsLimit = limit || Number(process.env.INSTAGRAM_POSTS_LIMIT) || 12;
  const run = await client.actor(actorId).call({ username: [username], resultsLimit });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items.map(normalizePost);
}

// Find real accounts active in a niche by scraping recent posts on the given
// hashtags and tallying who posted them. Frequency across niche hashtags is a
// decent proxy for relevance, so results are returned most-active first.
async function searchAccountsByHashtags(hashtags, resultsLimit) {
  if (!hashtags || hashtags.length === 0) return [];
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_HASHTAG_ACTOR || 'apify/instagram-hashtag-scraper';
  const limit = resultsLimit || Number(process.env.COMPETITOR_HASHTAG_RESULTS) || 60;

  const run = await client.actor(actorId).call({ hashtags, resultsLimit: limit });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const accounts = new Map();
  for (const item of items) {
    const username = item.ownerUsername;
    if (!username) continue;
    const key = username.toLowerCase();
    const entry = accounts.get(key) || { username: key, fullName: item.ownerFullName || '', postsSeen: 0 };
    entry.postsSeen += 1;
    accounts.set(key, entry);
  }
  return [...accounts.values()].sort((a, b) => b.postsSeen - a.postsSeen);
}

module.exports = { scrapeProfile, scrapePosts, probeProfile, searchAccountsByHashtags };
