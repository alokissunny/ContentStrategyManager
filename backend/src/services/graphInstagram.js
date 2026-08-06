/*
 * Instagram data via Meta Graph API — used when the studio has connected their
 * Instagram Professional account. Replaces Apify for that handle: profile,
 * recent media, and account insights (when the token has the insights scope).
 */

const MetaConnection = require('../models/MetaConnection');

const GRAPH = 'https://graph.facebook.com/v21.0';
const DEFAULT_MEDIA_LIMIT = Number(process.env.INSTAGRAM_POSTS_LIMIT) || 12;

async function graphGet(path, accessToken, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error?.message || `Graph GET ${path} failed (${res.status})`;
    const err = new Error(msg);
    err.code = json.error?.code;
    err.type = json.error?.type;
    throw err;
  }
  return json;
}

/** Connected Meta row for this user whose IG username matches `username`. */
async function findMetaConnectionForUsername(userId, username) {
  const handle = String(username || '').replace(/^@/, '').trim().toLowerCase();
  if (!handle) return null;
  const conn = await MetaConnection.findOne({
    user: userId,
    status: 'connected',
    igUsername: handle,
  }).select('+accessToken');
  if (!conn?.accessToken || !conn.igUserId) return null;
  return conn;
}

function mapMediaType(mediaType) {
  const t = String(mediaType || '').toUpperCase();
  if (t === 'VIDEO' || t === 'REELS') return 'Reel';
  if (t === 'CAROUSEL_ALBUM') return 'Carousel';
  return 'Post';
}

function normalizeGraphProfile(raw) {
  if (!raw?.id) return null;
  return {
    username: String(raw.username || '').toLowerCase(),
    fullName: raw.name || '',
    biography: raw.biography || '',
    followersCount: Number(raw.followers_count) || 0,
    followingCount: Number(raw.follows_count) || 0,
    postsCount: Number(raw.media_count) || 0,
    profilePicUrl: raw.profile_picture_url || '',
    isVerified: false,
    externalUrl: raw.website || '',
  };
}

function normalizeGraphMedia(item) {
  return {
    externalId: String(item.id || ''),
    caption: item.caption || '',
    likesCount: Number(item.like_count) || 0,
    commentsCount: Number(item.comments_count) || 0,
    timestamp: item.timestamp ? new Date(item.timestamp) : null,
    type: mapMediaType(item.media_type),
    url: item.permalink || '',
    displayUrl: item.thumbnail_url || item.media_url || '',
  };
}

/**
 * Pull a few day-level account insight metrics. Soft-fails to null when the
 * token lacks instagram_manage_insights or Meta returns an empty set.
 */
async function fetchAccountInsights(igUserId, accessToken) {
  // Metric names differ by API version; try the classic set first, then a
  // newer views-based set used by some IG Graph apps.
  const attempts = [
    { metric: 'impressions,reach,profile_views', period: 'day' },
    { metric: 'reach,views,total_interactions,profile_views', period: 'day' },
  ];

  for (const params of attempts) {
    try {
      const json = await graphGet(`${igUserId}/insights`, accessToken, params);
      const byName = {};
      for (const row of json.data || []) {
        const values = row.values || [];
        const last = values[values.length - 1];
        const sum = values.reduce((n, v) => n + (Number(v.value) || 0), 0);
        byName[row.name] = {
          latest: last?.value != null ? Number(last.value) : null,
          sum,
          period: row.period || params.period,
        };
      }
      if (!Object.keys(byName).length) continue;
      return {
        fetchedAt: new Date(),
        source: 'graph',
        impressions: byName.impressions?.sum ?? byName.impressions?.latest ?? null,
        reach: byName.reach?.sum ?? byName.reach?.latest ?? null,
        profileViews: byName.profile_views?.sum ?? byName.profile_views?.latest ?? null,
        views: byName.views?.sum ?? byName.views?.latest ?? null,
        totalInteractions:
          byName.total_interactions?.sum ?? byName.total_interactions?.latest ?? null,
        raw: byName,
      };
    } catch (err) {
      console.warn(`[graphInstagram] insights attempt failed: ${err.message}`);
    }
  }
  return null;
}

/**
 * Fetch profile + recent media (+ insights when permitted) for a Meta-connected
 * Instagram Professional account. Returns the same shape as the Apify scrapers
 * plus an optional `insights` object.
 */
async function fetchViaGraph(userId, username) {
  const conn = await findMetaConnectionForUsername(userId, username);
  if (!conn) return null;

  const igId = conn.igUserId;
  const token = conn.accessToken;
  const limit = DEFAULT_MEDIA_LIMIT;

  const [profileRaw, mediaJson, insights] = await Promise.all([
    graphGet(igId, token, {
      fields: 'id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,website',
    }),
    graphGet(`${igId}/media`, token, {
      fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count,thumbnail_url',
      limit,
    }),
    fetchAccountInsights(igId, token),
  ]);

  const profile = normalizeGraphProfile(profileRaw);
  if (!profile) {
    throw new Error('Graph returned no Instagram profile for the connected account.');
  }
  // Prefer the handle the studio asked for if Graph omits username.
  if (!profile.username) profile.username = String(username).toLowerCase();

  const posts = (mediaJson.data || []).map(normalizeGraphMedia);

  return { profile, posts, insights, source: 'graph' };
}

module.exports = {
  findMetaConnectionForUsername,
  fetchViaGraph,
  fetchAccountInsights,
};
