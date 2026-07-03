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
  if (!raw) return null;
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

async function scrapePosts(username, limit) {
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_POST_ACTOR || 'apify/instagram-post-scraper';
  const resultsLimit = limit || Number(process.env.INSTAGRAM_POSTS_LIMIT) || 12;
  const run = await client.actor(actorId).call({ username: [username], resultsLimit });
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  return items.map(normalizePost);
}

module.exports = { scrapeProfile, scrapePosts };
