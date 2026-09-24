const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Connection = require('../src/models/LinkedInConnection');
const Publication = require('../src/models/LinkedInPublication');
const li = require('../src/services/linkedin');
const auth = require('../src/middleware/auth');
auth.protect = (req, res, next) => { req.user = { _id: req.testUser || 'user-a' }; next(); };
const router = require('../src/routes/linkedinRoutes');
const realFetch = global.fetch;
let connection;
let publications;
let providerPosts;
let providerStatus;
let providerFailure;
let roles;
const organization = 'urn:li:organization:123';
const requestId = '12345678-1234-1234-1234-123456789abc';
const body = () => ({ organization, text: 'A company update (today) #News', requestId });
const query = (value) => ({ select: async () => value, lean: async () => value });
function request(path, payload, method = 'POST', testUser = 'user-a') {
  return new Promise((resolve, reject) => {
    router.handle({ method, url: `/${path}`, body: payload || {}, headers: {}, testUser }, {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
    }, reject);
  });
}
beforeEach(() => {
  process.env.LINKEDIN_CLIENT_ID = 'test-client';
  process.env.LINKEDIN_CLIENT_SECRET = 'test-secret';
  process.env.LINKEDIN_REDIRECT_URI = 'http://localhost:5173/dashboard/linkedin/callback';
  process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  connection = { _id: 'connection-a', user: 'user-a', companyAuthorizedAt: new Date(),
    tokenExpiresAt: new Date(Date.now() + 3600000), encryptedAccessToken: li.encryptToken('private-token', 'user-a') };
  publications = new Map();
  providerPosts = [];
  providerStatus = 201;
  providerFailure = false;
  roles = [{ organizationTarget: organization, role: 'ADMINISTRATOR', state: 'APPROVED' }];
  Connection.findOne = ({ user }) => query(connection?.user === user ? connection : null);
  Connection.findOneAndUpdate = async (filter, update) => {
    if (filter.stateHash && (filter.stateHash !== connection?.stateHash || connection.stateExpiresAt <= new Date())) return null;
    if (!connection) return null;
    Object.assign(connection, update.$set);
    for (const key of Object.keys(update.$unset || {})) delete connection[key];
    return connection;
  };
  Connection.updateOne = async () => ({});
  Connection.deleteOne = async ({ user }) => { if (connection?.user === user) connection = null; };
  Publication.findOne = async ({ _id, user }) => {
    const row = publications.get(_id);
    return row && (!user || row.user === user) ? row : null;
  };
  Publication.create = async (row) => {
    if (publications.has(row._id)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    publications.set(row._id, { ...row, createdAt: new Date() });
  };
  Publication.findOneAndUpdate = async ({ _id }, { $set }) => {
    const row = publications.get(_id);
    Object.assign(row, $set);
    return row;
  };
  Publication.find = ({ user }) => ({ sort: () => ({ limit: () => query([...publications.values()].filter((row) => row.user === user)) }) });
  global.fetch = async (url, options = {}) => {
    if (url.includes('/accessToken')) return { ok: true, json: async () => ({ access_token: 'private-token', expires_in: 3600, scope: li.SCOPES.join(' ') }) };
    if (url.includes('/organizationAcls')) return { ok: true, json: async () => ({ elements: roles, paging: { links: [] } }) };
    if (url.includes('/organizations/')) return { ok: true, json: async () => ({ localizedName: 'Test Company' }) };
    if (url.endsWith('/posts')) {
      providerPosts.push(options);
      if (providerFailure) throw new Error('timeout');
      return { status: providerStatus, headers: new Headers({ 'x-restli-id': 'urn:li:share:456' }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
});
afterEach(() => { global.fetch = realFetch; });

test('OAuth uses company permissions and stores only hashed expiring user-bound state', async () => {
  const response = await request('connect');
  assert.equal(response.status, 200);
  const url = new URL(response.data.url);
  assert.equal(url.searchParams.get('scope'), 'rw_organization_admin w_organization_social');
  assert.equal(connection.stateHash, crypto.createHash('sha256').update(response.data.state).digest('hex'));
  assert.ok(connection.stateExpiresAt > new Date());
  assert.ok(!response.data.url.includes('test-secret'));
});
test('secure configuration is required before OAuth', async () => {
  delete process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY;
  assert.equal((await request('connect')).status, 503);
});
test('callback consumes valid state once and persists only encrypted token', async () => {
  const { data } = await request('connect');
  const payload = { code: 'code', state: data.state };
  const response = await request('callback', payload);
  assert.equal(response.status, 200);
  assert.equal(response.data.canPublish, true);
  assert.ok(!JSON.stringify(connection).includes('private-token'));
  assert.ok(!JSON.stringify(response.data).includes(connection.encryptedAccessToken));
  assert.equal(li.decryptToken(connection.encryptedAccessToken, 'user-a'), 'private-token');
  assert.equal((await request('callback', payload)).status, 400);
});
test('callback rejects malformed and expired state', async () => {
  assert.equal((await request('callback', { code: 'x', state: 'bad' })).status, 400);
  const { data } = await request('connect');
  connection.stateExpiresAt = new Date(0);
  assert.equal((await request('callback', { code: 'x', state: data.state })).status, 400);
});
test('encryption authenticates user ownership and detects tampering', () => {
  assert.throws(() => li.decryptToken(connection.encryptedAccessToken, 'user-b'));
  const pieces = connection.encryptedAccessToken.split('.');
  pieces[1] = Buffer.alloc(16).toString('base64');
  assert.throws(() => li.decryptToken(pieces.join('.'), 'user-a'));
});
test('legacy profile connections require reconnection', async () => {
  connection = { user: 'user-a', memberId: 'old-member' };
  const response = await request('status', null, 'GET');
  assert.equal(response.data.needsReconnect, true);
  assert.equal(response.data.canPublish, false);
  assert.equal((await request('publish', body())).status, 409);
});
test('pages exclude revoked and non-publishing roles and return friendly names', async () => {
  roles.push({ organization: 'urn:li:organization:234', role: 'ANALYST', state: 'APPROVED' },
    { organization: 'urn:li:organization:345', role: 'ADMINISTRATOR', state: 'REVOKED' },
    { organization: 'urn:li:organization:456', role: 'DIRECT_SPONSORED_CONTENT_POSTER', state: 'APPROVED' });
  const response = await request('pages', null, 'GET');
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.pages.map((page) => page.urn), [organization]);
  assert.equal(response.data.pages[0].name, 'Test Company');
});
test('page discovery follows pagination and recognizes content admins', async () => {
  let count = 0;
  global.fetch = async (url) => {
    count++;
    assert.ok(url.includes(count === 1 ? 'start=0' : 'start=100'));
    return { ok: true, json: async () => ({ elements: [{ organization, role: 'CONTENT_ADMINISTRATOR', state: 'APPROVED' }],
      paging: { links: count === 1 ? [{ rel: 'next', href: 'https://untrusted.invalid/' }] : [] } }) };
  };
  assert.deepEqual(await li.pageRoles('token'), [{ urn: organization, role: 'CONTENT_ADMINISTRATOR' }]);
  assert.equal(count, 2);
});
test('publishing uses organization author, required headers and escaped plain text', async () => {
  const response = await request('publish', body());
  assert.equal(response.status, 201);
  assert.equal(response.data.publication.status, 'published');
  assert.ok(response.data.publication.permalink.includes('urn%3Ali%3Ashare%3A456'));
  const sent = JSON.parse(providerPosts[0].body);
  assert.equal(sent.author, organization);
  assert.equal(sent.commentary, 'A company update \\(today\\) \\#News');
  assert.equal(sent.lifecycleState, 'PUBLISHED');
  assert.equal(providerPosts[0].headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.equal(providerPosts[0].headers['LinkedIn-Version'], '202603');
});
test('repeated and concurrent requests publish at most once', async () => {
  await Promise.all([request('publish', body()), request('publish', body())]);
  assert.equal(providerPosts.length, 1);
  assert.equal((await request('publish', body())).status, 200);
  assert.equal(providerPosts.length, 1);
  assert.equal((await request('publish', { ...body(), text: 'Changed' })).status, 409);
});
test('expired token, missing ownership, and unauthorized target never create a provider post', async () => {
  assert.equal((await request('publish', body(), 'POST', 'user-b')).status, 409);
  connection.tokenExpiresAt = new Date(0);
  assert.equal((await request('publish', body())).status, 409);
  connection.tokenExpiresAt = new Date(Date.now() + 3600000);
  roles = [];
  assert.equal((await request('publish', body())).status, 403);
  assert.equal(providerPosts.length, 0);
});
test('invalid text, personal author and malformed request ID are rejected', async () => {
  for (const patch of [{ text: '' }, { text: 'x'.repeat(3001) }, { organization: 'urn:li:person:123' }, { requestId: 'bad' }]) {
    assert.equal((await request('publish', { ...body(), ...patch })).status, 400);
  }
  assert.equal(providerPosts.length, 0);
});
test('ambiguous timeout is persisted and never retried with the same ID', async () => {
  providerFailure = true;
  const response = await request('publish', body());
  assert.equal(response.status, 502);
  assert.equal(response.data.publication.status, 'unknown');
  assert.equal((await request('publish', body())).status, 409);
  assert.equal(providerPosts.length, 1);
});
test('provider authorization errors do not log the user out and are recorded', async () => {
  providerStatus = 401;
  const response = await request('publish', body());
  assert.equal(response.status, 409);
  assert.equal(response.data.publication.status, 'failed');
  assert.match(response.data.message, /Reconnect/);
});
test('publication history is private to its user and disconnect deletes credentials', async () => {
  await request('publish', body());
  assert.equal((await request('publications', null, 'GET')).data.publications.length, 1);
  assert.equal((await request('publications', null, 'GET', 'user-b')).data.publications.length, 0);
  assert.equal((await request('connection', null, 'DELETE')).data.connected, false);
  assert.equal(connection, null);
});

test('missing company scope does not overwrite the existing token', async () => {
  const { data } = await request('connect');
  const previousToken = connection.encryptedAccessToken;
  global.fetch = async () => ({ ok: true, json: async () => ({ access_token: 'different-token', expires_in: 3600, scope: 'w_member_social' }) });
  assert.equal((await request('callback', { code: 'code', state: data.state })).status, 403);
  assert.equal(connection.encryptedAccessToken, previousToken);
});
test('status response never exposes encrypted tokens or state', async () => {
  await request('connect');
  const { data } = await request('status', null, 'GET');
  assert.ok(!JSON.stringify(data).includes(connection.encryptedAccessToken));
  assert.ok(!JSON.stringify(data).includes(connection.stateHash));
  assert.equal(data.canPublish, true);
});
test('rate limits and permission denial are definite failures, server errors remain unknown', async () => {
  for (const [status, expected] of [[403, 'failed'], [429, 'failed'], [500, 'unknown'], [408, 'unknown']]) {
    providerStatus = status;
    const response = await request('publish', { ...body(), requestId: `${requestId}-${status}` });
    assert.equal(response.data.publication.status, expected);
    await request('publish', { ...body(), requestId: `${requestId}-${status}` });
  }
  assert.equal(providerPosts.length, 4);
});
test('an accepted post whose database update fails is not resent', async () => {
  Publication.findOneAndUpdate = async () => { throw new Error('database unavailable'); };
  const response = await request('publish', body());
  assert.equal(response.status, 500);
  assert.equal((await request('publish', body())).data.publication.status, 'pending');
  assert.equal(providerPosts.length, 1);
});
