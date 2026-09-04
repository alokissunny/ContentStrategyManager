/*
 * Meta Instagram publishing — connection status + OAuth scaffolding + publish stub.
 *
 * Phases (see team plan):
 *  1. UX: Publish CTA + connect prompt (this file + FE) ✓
 *  2. Meta App + OAuth (Facebook Login for Business) — start when META_APP_ID set
 *  3. Graph Content Publishing API (image/carousel/reel containers)
 *  4. Token refresh, media hosting, error taxonomy
 *
 * A Bauhly user may connect several Instagram Professional accounts (one Meta
 * connection per IG). Publish / insights resolve by matching igUsername to the
 * plan or profile handle.
 */

const crypto = require('crypto');
const MetaConnection = require('../models/MetaConnection');
const WeeklyRoute = require('../models/WeeklyRoute');
const { getPresignedMediaUrl } = require('./s3Client');

const GRAPH = 'https://graph.facebook.com/v21.0';

// POST to the Graph API as form-encoded (its expected content type) and throw
// the Graph error message on failure so callers can surface it.
async function graphPost(path, params) {
  const res = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: new URLSearchParams(params) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Graph POST ${path} failed (${res.status})`);
  }
  return json;
}

function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
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

/** Kick off Facebook Login for Business → Instagram Professional. */
async function startConnect(req, res) {
  if (!metaConfigured()) {
    return res.status(503).json({
      message:
        'Meta publishing is not configured yet. Add META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI to enable Connect with Meta.',
      configured: false,
    });
  }

  const state = crypto.randomBytes(16).toString('hex');
  // Short-lived CSRF cookie via response — client stores state in sessionStorage.
  // META_SCOPES overrides the default set (comma-separated) — handy for dropping
  // a permission that isn't approved yet so connecting still works during setup.
  const DEFAULT_SCOPES = [
    'instagram_basic',
    'instagram_content_publish',
    'instagram_manage_insights',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
  ];
  const scopes = (
    process.env.META_SCOPES
      ? process.env.META_SCOPES.split(',').map((s) => s.trim()).filter(Boolean)
      : DEFAULT_SCOPES
  ).join(',');

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI);
  url.searchParams.set('state', state);
  // Facebook Login *for Business* bundles permissions into a Configuration and
  // expects `config_id`; classic Facebook Login uses `scope`. When
  // META_LOGIN_CONFIG_ID is set we use the Configuration (the permissions come
  // from it); otherwise we request the scopes directly.
  if (process.env.META_LOGIN_CONFIG_ID) {
    url.searchParams.set('config_id', process.env.META_LOGIN_CONFIG_ID);
  } else {
    url.searchParams.set('scope', scopes);
  }
  url.searchParams.set('response_type', 'code');

  // Log the exact redirect_uri so a "URL Blocked" error is easy to fix: this
  // string must be whitelisted verbatim in the Meta app's Valid OAuth Redirect
  // URIs (Facebook Login → Settings), character-for-character.
  console.log(`[meta] OAuth redirect_uri = ${process.env.META_REDIRECT_URI}`);

  res.json({ url: url.toString(), state, redirectUri: process.env.META_REDIRECT_URI });
}

/**
 * OAuth callback: exchange code → long-lived user token → Page token → IG business account(s).
 * Upserts one MetaConnection per Instagram Professional account found on the user's Pages.
 */
async function completeConnect(req, res) {
  await ensureIndexes();
  if (!metaConfigured()) {
    return res.status(503).json({ message: 'Meta publishing is not configured.', configured: false });
  }

  const { code } = req.body;
  if (!code) return res.status(400).json({ message: 'Missing OAuth code' });

  try {
    // 1. Short-lived user token
    const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', process.env.META_APP_ID);
    tokenUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
    tokenUrl.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI);
    tokenUrl.searchParams.set('code', code);
    const tokenRes = await fetch(tokenUrl);
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson.error?.message || 'Token exchange failed');
    }

    // 2. Long-lived user token
    const llUrl = new URL(`${GRAPH}/oauth/access_token`);
    llUrl.searchParams.set('grant_type', 'fb_exchange_token');
    llUrl.searchParams.set('client_id', process.env.META_APP_ID);
    llUrl.searchParams.set('client_secret', process.env.META_APP_SECRET);
    llUrl.searchParams.set('fb_exchange_token', tokenJson.access_token);
    const llRes = await fetch(llUrl);
    const llJson = await llRes.json();
    const userToken = llJson.access_token || tokenJson.access_token;

    // 3. Pages the user manages, with any linked IG account in one call. We ask
    // for both edges: `instagram_business_account` (the API-publishable link) and
    // `connected_instagram_account` (a consumer-level link that does NOT allow
    // publishing) — so we can tell the two apart when diagnosing.
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}&access_token=${encodeURIComponent(userToken)}`
    );
    const pagesJson = await pagesRes.json();
    if (pagesJson.error) {
      console.error('[meta] /me/accounts error:', JSON.stringify(pagesJson.error));
      return res.status(502).json({
        message: pagesJson.error.message || 'Could not read your Facebook Pages from Meta.',
      });
    }
    const pages = pagesJson.data || [];
    // Full dump so we can see exactly what Meta returned for this token.
    console.log(
      '[meta] pages returned:',
      JSON.stringify(
        pages.map((p) => ({
          name: p.name,
          id: p.id,
          instagram_business_account: p.instagram_business_account || null,
          connected_instagram_account: p.connected_instagram_account || null,
        }))
      )
    );
    if (!pages.length) {
      return res.status(400).json({
        message:
          'Facebook returned no Pages for your account. During "Connect with Meta", make sure you grant the app access to the Page that is linked to your Instagram, then try again.',
      });
    }

    // 4. Upsert every Page that has an IG *business* account — one Meta connection
    // per Professional IG so multi-Page Facebook logins attach all of them.
    const igPages = pages.filter((p) => p.instagram_business_account?.id);
    if (!igPages.length) {
      const names = pages.map((p) => p.name).filter(Boolean).join(', ');
      const consumerOnly = pages.some((p) => p.connected_instagram_account?.id);
      console.warn(`[meta] no instagram_business_account on ${pages.length} page(s): ${names} (consumerLink=${consumerOnly})`);
      return res.status(400).json({
        message: consumerOnly
          ? 'Your Instagram is connected to the Page but not as a business account the API can publish to. In Meta Business Suite → Settings → Instagram accounts, make sure the account is added as a business asset under the same portfolio as the Page, then reconnect.'
          : `Facebook returned your Page(s) [${names}] but none has an Instagram Professional account linked for the API. Grant the app access to the correct Page during connect, and confirm the Instagram is linked to that exact Page.`,
      });
    }

    const expiresIn = Number(llJson.expires_in) || 60 * 24 * 3600;
    const scopes = [
      'instagram_basic',
      'instagram_content_publish',
      'instagram_manage_insights',
      'pages_show_list',
      'pages_read_engagement',
      'business_management',
    ];
    const now = new Date();

    for (const page of igPages) {
      const ig = page.instagram_business_account;
      await MetaConnection.findOneAndUpdate(
        { user: req.user._id, igUserId: String(ig.id) },
        {
          user: req.user._id,
          igUserId: String(ig.id),
          igUsername: normalizeHandle(ig.username),
          pageId: page.id,
          pageName: page.name || '',
          accessToken: page.access_token,
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          scopes,
          status: 'connected',
          connectedAt: now,
        },
        { upsert: true, new: true }
      );
    }

    const docs = await listConnected(req.user._id);
    console.log(
      `[meta] connected ${igPages.length} IG account(s):`,
      igPages.map((p) => p.instagram_business_account?.username).join(', ')
    );
    res.json(buildStatus(docs));
  } catch (err) {
    console.error('[meta] connect failed:', err.message);
    res.status(502).json({ message: err.message || 'Could not complete Meta connection' });
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
        ? `Connect @${handle} with Meta to publish this plan. Each Instagram account needs its own Meta connection.`
        : 'Connect your Instagram Professional account with Meta to publish from Bauhly.',
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
        const c = await graphPost(`${igId}/media`, { image_url: imageUrls[0], caption, access_token: token });
        creationId = c.id;
      } else {
        const children = [];
        for (const url of imageUrls.slice(0, 10)) {
          const child = await graphPost(`${igId}/media`, {
            image_url: url,
            is_carousel_item: 'true',
            access_token: token,
          });
          children.push(child.id);
        }
        const parent = await graphPost(`${igId}/media`, {
          media_type: 'CAROUSEL',
          children: children.join(','),
          caption,
          access_token: token,
        });
        creationId = parent.id;
      }

      const pub = await graphPost(`${igId}/media_publish`, { creation_id: creationId, access_token: token });

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
};
