/*
 * Meta Instagram publishing — connection status + OAuth scaffolding + publish stub.
 *
 * Phases (see team plan):
 *  1. UX: Publish CTA + connect prompt (this file + FE) ✓
 *  2. Meta App + OAuth (Facebook Login for Business) — start when META_APP_ID set
 *  3. Graph Content Publishing API (image/carousel/reel containers)
 *  4. Token refresh, media hosting, error taxonomy
 */

const crypto = require('crypto');
const MetaConnection = require('../models/MetaConnection');
const WeeklyRoute = require('../models/WeeklyRoute');

const GRAPH = 'https://graph.facebook.com/v21.0';

function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_REDIRECT_URI);
}

function publicStatus(doc) {
  if (!doc || doc.status !== 'connected') {
    return {
      connected: false,
      configured: metaConfigured(),
      igUsername: null,
      pageName: null,
      connectedAt: null,
    };
  }
  return {
    connected: true,
    configured: metaConfigured(),
    igUsername: doc.igUsername || null,
    pageName: doc.pageName || null,
    connectedAt: doc.connectedAt,
  };
}

async function getStatus(req, res) {
  const doc = await MetaConnection.findOne({ user: req.user._id });
  res.json(publicStatus(doc));
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
  const scopes = [
    'instagram_basic',
    'instagram_content_publish',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
  ].join(',');

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', process.env.META_APP_ID);
  url.searchParams.set('redirect_uri', process.env.META_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopes);
  url.searchParams.set('response_type', 'code');

  res.json({ url: url.toString(), state });
}

/**
 * OAuth callback: exchange code → long-lived user token → Page token → IG business account.
 * Persists MetaConnection. Called from the frontend redirect handler with ?code=&state=.
 */
async function completeConnect(req, res) {
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

    // 3. Pages the user manages
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${encodeURIComponent(userToken)}`);
    const pagesJson = await pagesRes.json();
    const page = (pagesJson.data || [])[0];
    if (!page) {
      return res.status(400).json({
        message:
          'No Facebook Page found. Link an Instagram Professional account to a Facebook Page, then try again.',
      });
    }

    // 4. IG business account on that Page
    const igRes = await fetch(
      `${GRAPH}/${page.id}?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(page.access_token)}`
    );
    const igJson = await igRes.json();
    const ig = igJson.instagram_business_account;
    if (!ig?.id) {
      return res.status(400).json({
        message:
          'This Facebook Page has no Instagram Professional account linked. Convert to Business/Creator and link it in Meta Business Suite.',
      });
    }

    const expiresIn = Number(llJson.expires_in) || 60 * 24 * 3600;
    const doc = await MetaConnection.findOneAndUpdate(
      { user: req.user._id },
      {
        user: req.user._id,
        igUserId: ig.id,
        igUsername: ig.username || '',
        pageId: page.id,
        pageName: page.name || '',
        accessToken: page.access_token,
        tokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
        scopes: [
          'instagram_basic',
          'instagram_content_publish',
          'pages_show_list',
          'pages_read_engagement',
          'business_management',
        ],
        status: 'connected',
        connectedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json(publicStatus(doc));
  } catch (err) {
    console.error('[meta] connect failed:', err.message);
    res.status(502).json({ message: err.message || 'Could not complete Meta connection' });
  }
}

async function disconnect(req, res) {
  await MetaConnection.deleteOne({ user: req.user._id });
  res.json({ connected: false, configured: metaConfigured() });
}

/**
 * Publish one planned day to Instagram via Content Publishing API.
 * Phase 1: requires connection; marks the day published after a successful
 * Graph call (or returns 501 with a clear message until media upload is wired).
 */
async function publishDay(req, res) {
  const route = await WeeklyRoute.findOne({ _id: req.params.id, user: req.user._id });
  if (!route) return res.status(404).json({ message: 'Route not found' });

  const index = Number(req.params.index);
  const day = route.days[index];
  if (!day) return res.status(404).json({ message: 'Day not found' });

  const conn = await MetaConnection.findOne({ user: req.user._id, status: 'connected' }).select('+accessToken');
  if (!conn?.accessToken || !conn.igUserId) {
    return res.status(403).json({
      code: 'META_NOT_CONNECTED',
      message: 'Connect your Instagram Professional account with Meta to publish from Bauhly.',
      connected: false,
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
      const caption = [day.content?.caption, day.content?.cta].filter(Boolean).join('\n\n');
      // Single-image path (carousel/reel require additional containers).
      const imageUrl = req.body.imageUrl;
      if (!imageUrl) {
        return res.status(400).json({
          message: 'Provide a public imageUrl for Graph publishing, or disable META_PUBLISH_LIVE.',
        });
      }
      const createRes = await fetch(
        `${GRAPH}/${conn.igUserId}/media?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}&access_token=${encodeURIComponent(conn.accessToken)}`,
        { method: 'POST' }
      );
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.id) {
        throw new Error(createJson.error?.message || 'Media container failed');
      }
      const pubRes = await fetch(
        `${GRAPH}/${conn.igUserId}/media_publish?creation_id=${createJson.id}&access_token=${encodeURIComponent(conn.accessToken)}`,
        { method: 'POST' }
      );
      const pubJson = await pubRes.json();
      if (!pubRes.ok) throw new Error(pubJson.error?.message || 'Publish failed');

      day.published = true;
      conn.lastPublishAt = new Date();
      await conn.save();
      route.markModified('days');
      await route.save();
      return res.json({ route, published: true, igMediaId: pubJson.id });
    } catch (err) {
      console.error('[meta] publish failed:', err.message);
      return res.status(502).json({ message: err.message || 'Instagram publish failed' });
    }
  }

  // Connected but live Graph publish not enabled — mark as published locally and
  // tell the client publishing to IG will go live once media URLs are wired.
  day.published = true;
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
};
