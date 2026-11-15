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

// Every slide of a carousel (sidecar) — or the single image / video — as
// { type: 'image'|'video', imageUrl, videoUrl }. Not persisted on profiles;
// Brand Voice reads it to analyse the whole post, not just the cover.
function mediaItemsOf(raw) {
  const children = Array.isArray(raw.childPosts) && raw.childPosts.length
    ? raw.childPosts
    : null;
  if (children) {
    return children.map((c) => {
      const videoUrl = firstDefined(c, ['videoUrl', 'video_url']) || '';
      return {
        type: videoUrl || /video/i.test(String(c.type || '')) ? 'video' : 'image',
        imageUrl: firstDefined(c, ['displayUrl', 'display_url', 'imageUrl']) || '',
        videoUrl,
      };
    }).filter((m) => m.imageUrl || m.videoUrl);
  }
  if (Array.isArray(raw.images) && raw.images.length) {
    return raw.images.filter(Boolean).map((url) => ({ type: 'image', imageUrl: String(url), videoUrl: '' }));
  }
  const videoUrl = firstDefined(raw, ['videoUrl', 'video_url']) || '';
  const imageUrl = firstDefined(raw, ['displayUrl', 'display_url', 'imageUrl']) || '';
  if (!videoUrl && !imageUrl) return [];
  return [{ type: videoUrl ? 'video' : 'image', imageUrl, videoUrl }];
}

function normalizePost(raw) {
  return {
    mediaItems: mediaItemsOf(raw),
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

/* ── RETRY A RESTRICTED READ ── the profile actor sometimes reaches Instagram through an exit that gets the
   "restricted profile" view of a PUBLIC account (MEASURED 2026-11-15, @livspace: two restricted exits, then the
   full profile on the third), and once its own retries run out it hands back an item with `error` or nothing.
   Only a handle Instagram says does not exist is final; anything else is tried again with a fresh run. */
const PROFILE_TRIES = Math.max(1, Number(process.env.INSTAGRAM_PROFILE_TRIES) || 3);
const POSTS_TRIES = Math.max(1, Number(process.env.INSTAGRAM_POSTS_TRIES) || 2);
const isMissing = (raw) => /not[_\s-]?found|does not exist|no such user/i.test(String(raw?.error || raw?.errorDescription || ''));

async function scrapeProfile(username) {
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || 'apify/instagram-profile-scraper';
  let last = null;
  for (let attempt = 1; attempt <= PROFILE_TRIES; attempt += 1) {
    const run = await client.actor(actorId).call({ usernames: [username] });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    last = items[0] || null;
    const profile = normalizeProfile(last);
    if (profile) return profile;
    if (isMissing(last)) break;
    console.warn(`[instagramScraper] @${username} profile read empty or restricted (try ${attempt}/${PROFILE_TRIES}):`, last?.error || last?.errorDescription || 'no item');
  }
  return null;
}

async function scrapePosts(username, limit) {
  const client = getApifyClient();
  const actorId = process.env.APIFY_INSTAGRAM_POST_ACTOR || 'apify/instagram-post-scraper';
  const resultsLimit = limit || Number(process.env.INSTAGRAM_POSTS_LIMIT) || 12;
  let posts = [];
  for (let attempt = 1; attempt <= POSTS_TRIES; attempt += 1) {
    const run = await client.actor(actorId).call({ username: [username], resultsLimit });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    /* the post actor reports a restricted or missing account as an item with `error` */
    const real = items.filter((it) => it && !it.error);
    posts = real.map(normalizePost);
    if (posts.length) return posts;
    if (items.some(isMissing)) break;
    console.warn(`[instagramScraper] @${username} posts read empty (try ${attempt}/${POSTS_TRIES})`);
  }
  return posts;
}

module.exports = { scrapeProfile, scrapePosts };
