/*
 * Instagram publishing via Instagram API with Instagram Login
 * (Business Login for Instagram — no Facebook Page).
 *
 * Connect: instagram.com/oauth/authorize → api.instagram.com token →
 * graph.instagram.com long-lived token + /me.
 * Publish: graph.instagram.com /{ig-user-id}/media + /media_publish.
 */

const crypto = require('crypto');
const MetaConnection = require('../models/MetaConnection');
const WeeklyRoute = require('../models/WeeklyRoute');
const { getPresignedMediaUrl } = require('./s3Client');
const { allowedOrigins } = require('../config/origins');

const IG_GRAPH = 'https://graph.instagram.com/v21.0';
const META_CALLBACK_PATH = '/dashboard/meta/callback';
const DEFAULT_META_REDIRECT_URI = `https://www.bauhly.com${META_CALLBACK_PATH}`;
const DEFAULT_IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
];

function instagramAppId() {
  return String(process.env.INSTAGRAM_APP_ID || '').trim();
}

function instagramAppSecret() {
  return String(process.env.INSTAGRAM_APP_SECRET || '').trim();
}

function igGraphBase(conn) {
  if (conn?.authType === 'instagram_login') return IG_GRAPH;
  // Legacy Facebook Login rows store a Page token and pageId.
  if (conn?.authType === 'facebook_login' || conn?.pageId) {
    return 'https://graph.facebook.com/v21.0';
  }
  return IG_GRAPH;
}

function oauthScopes() {
  const raw = String(process.env.INSTAGRAM_SCOPES || process.env.META_SCOPES || '').trim();
  const list = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_IG_SCOPES;
  const facebookLogin = list.some(
    (s) =>
      s.startsWith('pages_') ||
      s === 'business_management' ||
      s === 'instagram_basic' ||
      s === 'instagram_content_publish' ||
      s === 'instagram_manage_insights',
  );
  if (facebookLogin) {
    console.warn('[meta] ignoring Facebook Login scopes; using Instagram Login defaults');
    return DEFAULT_IG_SCOPES;
  }
  return list.length ? list : DEFAULT_IG_SCOPES;
}

function envRedirectUri() {
  const fromEnv = String(process.env.META_REDIRECT_URI || '').trim();
  return fromEnv || DEFAULT_META_REDIRECT_URI;
}

/**
 * Instagram requires redirect_uri to match the live frontend origin character-
 * for-character. Prefer the browser origin (or an explicit callback URL) over
 * a stale META_REDIRECT_URI such as the old igsignal-web.onrender.com host.
 */
function resolveRedirectUri(req) {
  const candidates = [
    req.body?.redirectUri,
    req.headers.origin ? `${String(req.headers.origin).replace(/\/$/, '')}${META_CALLBACK_PATH}` : '',
    envRedirectUri(),
    DEFAULT_META_REDIRECT_URI,
  ];
  const allowed = allowedOrigins();
  for (const raw of candidates) {
    const value = String(raw || '').trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.pathname !== META_CALLBACK_PATH) continue;
      if (parsed.search || parsed.hash) continue;
      if (!allowed.has(parsed.origin)) continue;
      return `${parsed.origin}${META_CALLBACK_PATH}`;
    } catch (_) {
      /* skip invalid */
    }
  }
  return DEFAULT_META_REDIRECT_URI;
}

// POST to the Graph API as form-encoded (its expected content type) and throw
// the Graph error message on failure so callers can surface it.
async function graphPost(path, params, base = IG_GRAPH) {
  const res = await fetch(`${base}/${path}`, { method: 'POST', body: new URLSearchParams(params) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Graph POST ${path} failed (${res.status})`);
  }
  return json;
}

function metaConfigured() {
  return Boolean(instagramAppId() && instagramAppSecret());
}

function normalizeHandle(username) {
  return String(username || '').replace(/^@/, '').trim().toLowerCase();
}

function connectionPublic(doc) {
  return {
    igUserId: doc.igUserId || null,
    igUsername: doc.igUsername || null,
    pageName: doc.pageName || null,
    connectedAt: doc.connectedAt || null,
  };
}

/** Status payload: all connected accounts + legacy single-account fields. */
function buildStatus(docs) {
  const list = (docs || []).filter((d) => d && d.status === 'connected' && d.igUserId);
  const connections = list.map(connectionPublic);
  const primary = connections[0] || null;
  return {
    configured: metaConfigured(),
    connected: connections.length > 0,
    connections,
    // Legacy single-connection fields (first connected account).
    igUsername: primary?.igUsername || null,
    pageName: primary?.pageName || null,
    connectedAt: primary?.connectedAt || null,
  };
}

let indexesReady = false;
async function ensureIndexes() {
  if (indexesReady) return;
  indexesReady = true;
  try {
    // Legacy schema had unique { user: 1 }; multi-account needs that gone.
    await MetaConnection.collection.dropIndex('user_1');
  } catch (_) {
    /* already dropped or never existed */
  }
  try {
    await MetaConnection.syncIndexes();
  } catch (err) {
    console.warn('[meta] syncIndexes:', err.message);
  }
}

async function listConnected(userId) {
  return MetaConnection.find({ user: userId, status: 'connected' }).sort({ connectedAt: -1 });
}

async function getStatus(req, res) {
  await ensureIndexes();
  const docs = await listConnected(req.user._id);
  res.json(buildStatus(docs));
}

/** Kick off Business Login for Instagram → Instagram Professional. */
async function startConnect(req, res) {
  if (!metaConfigured()) {
    return res.status(503).json({
      message:
        'Instagram publishing is not configured yet. Add INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET to enable Connect Instagram.',
      configured: false,
    });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const scopes = oauthScopes().join(',');

  const redirectUri = resolveRedirectUri(req);
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', instagramAppId());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('force_reauth', 'true');
  // Hide “Log in with Facebook” so the user picks an Instagram account, not a Page.
  url.searchParams.set('enable_fb_login', '0');

  console.log(`[meta] Instagram OAuth redirect_uri = ${redirectUri}`);

  res.json({ url: url.toString(), state, redirectUri });
}

/**
 * Instagram returns either `{ access_token, user_id, permissions }` or
 * `{ data: [{ access_token, user_id, permissions }] }`. Prefer a real token
 * object — `data` is sometimes a permissions list, not the token row.
 */
function parseIgTokenPayload(json) {
  if (!json || typeof json !== 'object') return {};
  if (json.access_token) return json;
  if (Array.isArray(json.data)) {
    const row = json.data.find((item) => item && typeof item === 'object' && item.access_token);
    if (row) return row;
  } else if (json.data && typeof json.data === 'object' && json.data.access_token) {
    return json.data;
  }
  return json;
}

function tokenPayloadKeys(json) {
  if (!json || typeof json !== 'object') return [];
  return Object.keys(json);
}

/**
 * OAuth callback: code → short-lived IG user token → long-lived token → /me.
 * Upserts one MetaConnection for the Instagram Professional account that logged in.
 */
async function completeConnect(req, res) {
  await ensureIndexes();
  if (!metaConfigured()) {
    return res.status(503).json({ message: 'Instagram publishing is not configured.', configured: false });
  }

  const { code: rawCode } = req.body;
  const code = String(rawCode || '').replace(/#_+$/, '').trim();
  if (!code) return res.status(400).json({ message: 'Missing OAuth code' });

  const redirectUri = resolveRedirectUri(req);

  try {
    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: instagramAppId(),
        client_secret: instagramAppSecret(),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const shortJson = await shortRes.json().catch(() => ({}));
    const short = parseIgTokenPayload(shortJson);
    if (!short.access_token) {
      console.error(
        '[meta] IG token exchange failed:',
        shortJson.error_message || shortJson.error?.message || 'no access_token',
        'keys=',
        tokenPayloadKeys(shortJson).join(','),
      );
      throw new Error(
        shortJson.error_message || shortJson.error?.message || 'Instagram token exchange failed',
      );
    }

    const llUrl = new URL('https://graph.instagram.com/access_token');
    llUrl.searchParams.set('grant_type', 'ig_exchange_token');
    llUrl.searchParams.set('client_secret', instagramAppSecret());
    llUrl.searchParams.set('access_token', short.access_token);
    const llRes = await fetch(llUrl);
    const llJson = await llRes.json().catch(() => ({}));
    if (llJson.error && !llJson.access_token) {
      console.warn('[meta] IG long-lived token exchange:', JSON.stringify(llJson.error));
    }
    const userToken = llJson.access_token || short.access_token;
    const expiresIn = Number(llJson.expires_in) || (llJson.access_token ? 60 * 24 * 3600 : 3600);

    const meUrl = new URL(`${IG_GRAPH}/me`);
    meUrl.searchParams.set('fields', 'user_id,username,name,account_type');
    meUrl.searchParams.set('access_token', userToken);
    const meRes = await fetch(meUrl);
    const me = await meRes.json().catch(() => ({}));
    if (me.error || !(me.user_id || me.id)) {
      console.error('[meta] IG /me failed:', JSON.stringify(me));
      throw new Error(me.error?.message || 'Could not read the Instagram Professional account.');
    }

    const accountType = String(me.account_type || '').toUpperCase();
    if (accountType && accountType !== 'BUSINESS' && accountType !== 'MEDIA_CREATOR') {
      return res.status(400).json({
        message:
          'That Instagram account is not Professional (Business or Creator). Switch it in Instagram settings, then connect again.',
      });
    }

    const igUserId = String(me.user_id || me.id);
    const igUsername = normalizeHandle(me.username);
    const granted = Array.isArray(short.permissions)
      ? short.permissions.map(String).filter(Boolean)
      : String(short.permissions || '')
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);

    await MetaConnection.findOneAndUpdate(
      { user: req.user._id, igUserId },
      {
        user: req.user._id,
        igUserId,
        igUsername,
        pageId: '',
        pageName: '',
        authType: 'instagram_login',
        accessToken: userToken,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        scopes: granted.length ? granted : DEFAULT_IG_SCOPES,
        status: 'connected',
        connectedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    const docs = await listConnected(req.user._id);
    console.log(`[meta] connected Instagram @${igUsername || igUserId} (${igUserId})`);
    res.json(buildStatus(docs));
  } catch (err) {
    console.error('[meta] connect failed:', err.message);
    res.status(502).json({ message: err.message || 'Could not complete Instagram connection' });
  }
}

/**
 * Disconnect one Instagram Meta connection (by igUserId), or all if none given
 * (legacy). Returns the updated status payload.
 */
async function disconnect(req, res) {
  await ensureIndexes();
  const igUserId = String(req.params.igUserId || req.query.igUserId || '').trim();
  const igUsername = normalizeHandle(req.query.igUsername || '');

  if (igUserId) {
    await MetaConnection.deleteOne({ user: req.user._id, igUserId });
  } else if (igUsername) {
    await MetaConnection.deleteOne({ user: req.user._id, igUsername });
  } else {
    // Legacy global disconnect — remove every Meta row for this user.
    await MetaConnection.deleteMany({ user: req.user._id });
  }

  const docs = await listConnected(req.user._id);
  res.json(buildStatus(docs));
}

/**
 * Publish one planned day to Instagram via Content Publishing API.
 * Uses the Meta connection whose IG username matches the plan's handle.
 */
async function publishDay(req, res) {
  const route = await WeeklyRoute.findOne({ _id: req.params.id, user: req.user._id });
  if (!route) return res.status(404).json({ message: 'Route not found' });

  const index = Number(req.params.index);
  const day = route.days[index];
  if (!day) return res.status(404).json({ message: 'Day not found' });

  const handle = normalizeHandle(route.instagramUsername);
  let conn;
  if (handle) {
    conn = await MetaConnection.findOne({
      user: req.user._id,
      status: 'connected',
      igUsername: handle,
    }).select('+accessToken');
  } else {
    conn = await MetaConnection.findOne({ user: req.user._id, status: 'connected' }).select('+accessToken');
  }

  if (!conn?.accessToken || !conn.igUserId) {
    return res.status(403).json({
      code: 'META_NOT_CONNECTED',
      message: handle
        ? `Connect Instagram @${handle} to publish this plan. Each Instagram account needs its own connection.`
        : 'Connect your Instagram Professional account to publish from Bauhly.',
      connected: false,
      igUsername: handle || null,
    });
  }

  const slides = day.content?.slides || [];
  const hasMedia = slides.some((s) => s.assetKey) || day.content?.onScreenText?.length;
  if (!hasMedia && !day.content?.caption) {
    return res.status(400).json({
      message: 'This post needs a caption or at least one slide before publishing.',
    });
  }

  // Phase 3: create media containers + publish.
  // Until public HTTPS media URLs are ready for Graph, we record intent and mark published
  // only when META_PUBLISH_LIVE=1 and a container flow succeeds.
  if (process.env.META_PUBLISH_LIVE === '1') {
    try {
      const igId = conn.igUserId;
      const token = conn.accessToken;
      const graph = igGraphBase(conn);

      // Caption = body + CTA + hashtags, in the brand's own text.
      const captionParts = [day.content?.caption, day.content?.cta].filter(Boolean);
      const tags = (day.content?.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`);
      if (tags.length) captionParts.push(tags.join(' '));
      const caption = captionParts.join('\n\n');

      // Public, Graph-fetchable image URLs. Preference order:
      //   1. explicit public URL(s) in the request (testing / overrides)
      //   2. project-media keys the client resolved for the day's slides —
      //      this includes "standing-in" photos shown in the preview that were
      //      never written to a slide's assetKey
      //   3. the assetKeys stored on the slides themselves
      // Presigned S3 GET URLs are private-by-default but fetchable by
      // Instagram's servers while valid.
      let imageUrls = [];
      if (Array.isArray(req.body.imageUrls) && req.body.imageUrls.length) {
        imageUrls = req.body.imageUrls.filter(Boolean);
      } else if (req.body.imageUrl) {
        imageUrls = [req.body.imageUrl];
      } else {
        const requested =
          Array.isArray(req.body.imageKeys) && req.body.imageKeys.length
            ? req.body.imageKeys
            : slides.map((s) => s.assetKey);
        // Only ever presign this user's own media (keys live under
        // projects/<userId>/) — never presign a key the client made up.
        const prefix = `projects/${req.user._id}/`;
        const keys = requested.filter((k) => typeof k === 'string' && k.startsWith(prefix));
        imageUrls = await Promise.all(keys.map((k) => getPresignedMediaUrl(k)));
      }
      if (!imageUrls.length) {
        return res.status(400).json({
          message:
            'This post has no image to publish yet. Attach a project photo to a slide (or pass an imageUrl), then publish.',
        });
      }

      // Create a media container (single image or a carousel of up to 10), then
      // publish it. Reels/video aren't supported here yet — images only.
      let creationId;
      if (imageUrls.length === 1) {
        const c = await graphPost(
          `${igId}/media`,
          { image_url: imageUrls[0], caption, access_token: token },
          graph,
        );
        creationId = c.id;
      } else {
        const children = [];
        for (const url of imageUrls.slice(0, 10)) {
          const child = await graphPost(
            `${igId}/media`,
            {
              image_url: url,
              is_carousel_item: 'true',
              access_token: token,
            },
            graph,
          );
          children.push(child.id);
        }
        const parent = await graphPost(
          `${igId}/media`,
          {
            media_type: 'CAROUSEL',
            children: children.join(','),
            caption,
            access_token: token,
          },
          graph,
        );
        creationId = parent.id;
      }

      const pub = await graphPost(
        `${igId}/media_publish`,
        { creation_id: creationId, access_token: token },
        graph,
      );

      day.published = true;
      day.scheduledAt = null;
      conn.lastPublishAt = new Date();
      await conn.save();
      route.markModified('days');
      await route.save();
      console.log(`[meta] published day ${index} to @${conn.igUsername || igId} as media ${pub.id}`);
      return res.json({ route, published: true, live: true, igMediaId: pub.id });
    } catch (err) {
      console.error('[meta] publish failed:', err.message);
      return res.status(502).json({ message: err.message || 'Instagram publish failed' });
    }
  }

  // Connected but live Graph publish not enabled — mark as published locally and
  // tell the client publishing to IG will go live once media URLs are wired.
  day.published = true;
  day.scheduledAt = null;
  route.markModified('days');
  await route.save();
  conn.lastPublishAt = new Date();
  await conn.save();

  res.json({
    route,
    published: true,
    live: false,
    message:
      'Marked published. Live Instagram posting turns on when META_PUBLISH_LIVE=1 and slide images have public URLs.',
  });
}

module.exports = {
  getStatus,
  startConnect,
  completeConnect,
  disconnect,
  publishDay,
  metaConfigured,
  buildStatus,
  normalizeHandle,
  resolveRedirectUri,
};
