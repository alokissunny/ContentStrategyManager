const express = require('express');
const crypto = require('node:crypto');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const Connection = require('../models/LinkedInConnection');
const Publication = require('../models/LinkedInPublication');
const li = require('../services/linkedin');

const router = express.Router();
router.use(protect);
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const withErrors = (fn) => asyncHandler(async (req, res) => {
  try { await fn(req, res); }
  catch (err) {
    // Never send provider bodies, credentials, or crypto/database errors to the browser.
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Could not complete the LinkedIn request.', code: err.code || 'LINKEDIN_ERROR' });
  }
});
const publicPublication = (row) => ({ id: row._id, organization: row.organization, preview: row.preview,
  status: row.status, permalink: row.permalink || '', message: row.message || '', createdAt: row.createdAt });

router.get('/status', withErrors(async (req, res) => {
  res.json(li.connectionStatus(await Connection.findOne({ user: req.user._id }).lean()));
}));
router.post('/connect', withErrors(async (req, res) => {
  if (!li.configured()) throw li.error(503, 'LinkedIn publishing is awaiting secure app setup.');
  const state = crypto.randomBytes(32).toString('hex');
  await Connection.findOneAndUpdate({ user: req.user._id }, {
    $set: { stateHash: hash(state), stateExpiresAt: new Date(Date.now() + 10 * 60 * 1000) },
  }, { upsert: true });
  const url = new URL('https://www.linkedin.com/oauth/v2/authorization');
  url.search = new URLSearchParams({ response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI, scope: li.SCOPES.join(' '), state }).toString();
  res.json({ url: url.toString(), state });
}));
router.post('/callback', withErrors(async (req, res) => {
  if (!li.configured()) throw li.error(503, 'LinkedIn publishing is awaiting secure app setup.');
  const { code, state } = req.body;
  if (typeof code !== 'string' || !code || typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) {
    throw li.error(400, 'Invalid LinkedIn callback. Please connect again.');
  }
  const pending = await Connection.findOneAndUpdate({ user: req.user._id, stateHash: hash(state), stateExpiresAt: { $gt: new Date() } },
    { $unset: { stateHash: 1, stateExpiresAt: 1 } });
  if (!pending) throw li.error(400, 'LinkedIn connection expired or was already used. Please connect again.');
  let token;
  try {
    const response = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code,
        redirect_uri: process.env.LINKEDIN_REDIRECT_URI, client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET }),
    });
    if (!response.ok) throw new Error('Token exchange failed');
    token = await response.json();
    if (typeof token.access_token !== 'string' || !token.access_token || !Number.isFinite(Number(token.expires_in)) || Number(token.expires_in) <= 0) throw new Error('Invalid token');
  } catch { throw li.error(502, 'Could not authorize LinkedIn. Please connect again.'); }
  const scopes = typeof token.scope === 'string' ? token.scope.split(/[ ,]+/) : li.SCOPES;
  if (!li.SCOPES.every((scope) => scopes.includes(scope))) {
    throw li.error(403, 'LinkedIn did not grant company-page permissions. Enable Community Management API access and reconnect.');
  }
  // Verify organizational access with LinkedIn before saving the new grant.
  await li.pageRoles(token.access_token);
  const now = new Date();
  const row = await Connection.findOneAndUpdate({ _id: pending._id }, { $set: {
    name: 'Company pages', companyAuthorizedAt: now, connectedAt: now, scopes,
    encryptedAccessToken: li.encryptToken(token.access_token, req.user._id),
    tokenExpiresAt: new Date(Date.now() + Number(token.expires_in) * 1000),
    selectedOrganization: '',
  }, $unset: { memberId: 1 } }, { new: true });
  if (!row) throw li.error(409, 'Connection was removed. Please connect again.');
  res.json(li.connectionStatus(row));
}));
router.get('/pages', withErrors(async (req, res) => {
  const row = await Connection.findOne({ user: req.user._id }).select('+encryptedAccessToken');
  res.json({ pages: await li.listPages(li.accessToken(row, req.user._id)), selectedOrganization: row.selectedOrganization || '' });
}));
router.get('/publications', withErrors(async (req, res) => {
  const rows = await Publication.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(10).lean();
  res.json({ publications: rows.map(publicPublication) });
}));
router.post('/publish', withErrors(async (req, res) => {
  const { organization, text, requestId } = req.body;
  if (typeof organization !== 'string' || !li.organizationPattern.test(organization)) throw li.error(400, 'Choose a company page.');
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 3000) throw li.error(400, 'Enter a post between 1 and 3,000 characters.');
  if (typeof requestId !== 'string' || !/^[a-z0-9-]{16,80}$/i.test(requestId)) throw li.error(400, 'A valid publishing request ID is required.');
  const commentary = text.trim();
  const id = hash(`${req.user._id}:${requestId}`);
  const payloadHash = hash(JSON.stringify({ organization, commentary }));
  const replyExisting = (existing) => {
    if (existing.payloadHash !== payloadHash) throw li.error(409, 'This request ID was already used for different content.');
    return res.status(existing.status === 'published' ? 200 : 409).json({
      publication: publicPublication(existing),
      message: existing.message || 'This request is already being processed. Check recent activity before posting again.',
    });
  };
  const existing = await Publication.findOne({ _id: id, user: req.user._id });
  if (existing) return replyExisting(existing);
  const connection = await Connection.findOne({ user: req.user._id }).select('+encryptedAccessToken');
  const token = li.accessToken(connection, req.user._id);
  // Recheck current roles; a cached page selection does not confer permission.
  const pages = await li.pageRoles(token);
  if (!pages.some((page) => page.urn === organization)) throw li.error(403, 'You no longer have permission to publish to this company page. Refresh your pages.');
  try {
    await Publication.create({ _id: id, user: req.user._id, payloadHash, organization, preview: commentary.slice(0, 160), status: 'pending' });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const duplicate = await Publication.findOne({ _id: id, user: req.user._id });
    if (!duplicate) throw err;
    return replyExisting(duplicate);
  }
  // Once sent, never automatically retry an ambiguous provider response.
  let response;
  try {
    response = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST', headers: li.headers(token), signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ author: organization, commentary: li.plainCommentary(commentary), visibility: 'PUBLIC',
        distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
        lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false }),
    });
  } catch { /* unknown outcome is recorded below */ }
  let result;
  let statusCode;
  if (response?.status === 201) {
    const postUrn = response.headers.get('x-restli-id') || '';
    result = { status: 'published', postUrn,
      permalink: /^urn:li:(share|ugcPost):[0-9]+$/.test(postUrn) ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/` : '',
      message: 'Published to your LinkedIn company page.' };
    statusCode = 201;
  } else if (response && response.status >= 400 && response.status < 500 && response.status !== 408) {
    result = { status: 'failed', message: response.status === 400 || response.status === 422
      ? 'LinkedIn rejected this post. Review the text before trying again.' : li.providerError(response.status).message };
    statusCode = response.status === 401 ? 409 : response.status;
  } else {
    result = { status: 'unknown', message: 'LinkedIn may have received this post. Check your company page before starting a new post; this request will not be sent again.' };
    statusCode = 502;
  }
  const saved = await Publication.findOneAndUpdate({ _id: id }, { $set: result }, { new: true });
  // Remember only a convenience default; failure must not mask a successful publication.
  if (result.status === 'published') {
    await Connection.updateOne({ _id: connection._id }, { $set: { selectedOrganization: organization } }).catch(() => {});
  }
  res.status(statusCode).json({ publication: publicPublication(saved), message: result.message });
}));
router.delete('/connection', withErrors(async (req, res) => {
  await Connection.deleteOne({ user: req.user._id });
  res.json(li.connectionStatus(null));
}));

module.exports = router;
