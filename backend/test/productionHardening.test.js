// Production-hardening behaviour against a real (in-memory) MongoDB:
// projects paging, publish retry backoff, Theme Apply heartbeat, AI limits,
// the provider fetch cap. Run: node --test test/productionHardening.test.js
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
delete process.env.S3_BUCKET_NAME;
delete process.env.REDIS_URL;
delete process.env.MONGO_URI;
process.env.SCHEDULE_CRON_SECRET = '';

const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongo; let server; let base; let token; let user;
const User = require('../src/models/User');
const InstagramProfile = require('../src/models/InstagramProfile');
const Project = require('../src/models/Project');
const PlannedPost = require('../src/models/PlannedPost');
const ThemeApplyJob = require('../src/models/ThemeApplyJob');

const call = async (method, path, body, auth = token) => {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};

test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  user = await User.create({ name: 'S', email: 'h@example.test', password: 'x'.repeat(12) });
  await InstagramProfile.create({ user: user._id, username: 'studio', fetchedAt: new Date(), activatedAt: new Date() });
  const app = require('../src/app');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
});

test.after(async () => {
  server?.close();
  await mongoose.disconnect();
  await mongo?.stop();
});

test('GET /projects pages with limit/before and keeps the unpaged shape', async () => {
  for (let i = 0; i < 5; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Project.create({ user: user._id, instagramUsername: 'studio', name: `P${i}`, captures: [] });
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 5));
  }
  const all = await call('GET', '/projects?lite=1');
  assert.strictEqual(all.status, 200);
  assert.strictEqual(all.body.projects.length, 5);
  assert.ok(!('nextBefore' in all.body), 'unpaged response has no paging field');

  const p1 = await call('GET', '/projects?lite=1&limit=2');
  assert.deepStrictEqual(p1.body.projects.map((p) => p.name), ['P4', 'P3']);
  assert.ok(p1.body.nextBefore);
  const p2 = await call('GET', `/projects?lite=1&limit=2&before=${encodeURIComponent(p1.body.nextBefore)}`);
  assert.deepStrictEqual(p2.body.projects.map((p) => p.name), ['P2', 'P1']);
  const p3 = await call('GET', `/projects?lite=1&limit=2&before=${encodeURIComponent(p2.body.nextBefore)}`);
  assert.deepStrictEqual(p3.body.projects.map((p) => p.name), ['P0']);
  assert.strictEqual(p3.body.nextBefore, null);
});

test('projects list resolves capture post dates across projects in one go', async () => {
  const post = await PlannedPost.create({ user: user._id, instagramUsername: 'studio', date: '2031-01-05', title: 'x' });
  await Project.create({ user: user._id, instagramUsername: 'studio', name: 'Linked', captures: [{ text: 'c', usedInPosts: [post._id] }] });
  const r = await call('GET', '/projects?lite=1');
  const linked = r.body.projects.find((p) => p.name === 'Linked');
  assert.deepStrictEqual(linked.captures[0].usedInPosts, [{ id: String(post._id), date: '2031-01-05' }]);
});

test('a failed scheduled post backs off and stops after the last attempt', async () => {
  const { runPublishDue } = require('../src/services/schedulePublish');
  const post = await PlannedPost.create({
    user: user._id, instagramUsername: 'studio', date: '2020-01-01', title: 'due',
    scheduledAt: new Date(Date.now() - 60_000), publishImageKeys: [`projects/${user._id}/a.jpg`], scheduleStatus: 'ready',
  });
  const first = await runPublishDue();
  assert.strictEqual(first.scanned, 1);
  let doc = await PlannedPost.findById(post._id).lean();
  assert.strictEqual(doc.scheduleStatus, 'failed');
  assert.strictEqual(doc.scheduleFailures, 1);
  assert.ok(doc.scheduleRetryAt > new Date(), 'next try is in the future');

  const again = await runPublishDue();
  assert.strictEqual(again.scanned, 0, 'no retry inside the backoff window');

  for (let n = 2; n <= 6; n++) {
    // eslint-disable-next-line no-await-in-loop
    await PlannedPost.updateOne({ _id: post._id }, { $set: { scheduleRetryAt: new Date(Date.now() - 1000) } });
    // eslint-disable-next-line no-await-in-loop
    const r = await runPublishDue();
    assert.strictEqual(r.scanned, 1, `attempt ${n} runs`);
  }
  doc = await PlannedPost.findById(post._id).lean();
  assert.strictEqual(doc.scheduleFailures, 6);
  assert.strictEqual(doc.scheduleRetryAt, null);
  assert.strictEqual((await runPublishDue()).scanned, 0, 'gives up after 6 attempts');

  // the studio's Retry starts a fresh set of attempts
  const retry = await call('PATCH', `/posts/${post._id}`, { scheduleStatus: 'ready' });
  assert.strictEqual(retry.status, 200);
  doc = await PlannedPost.findById(post._id).lean();
  assert.strictEqual(doc.scheduleFailures, 0);
  assert.strictEqual((await runPublishDue()).scanned, 1);
  await PlannedPost.deleteOne({ _id: post._id });
});

test('legacy failed posts (no attempt count) are still retried', async () => {
  const { runPublishDue } = require('../src/services/schedulePublish');
  const post = await PlannedPost.create({
    user: user._id, instagramUsername: 'studio', date: '2020-01-02', title: 'legacy',
    scheduledAt: new Date(Date.now() - 60_000), publishImageKeys: [`projects/${user._id}/b.jpg`],
  });
  await PlannedPost.collection.updateOne({ _id: post._id }, { $set: { scheduleStatus: 'failed' }, $unset: { scheduleFailures: '', scheduleRetryAt: '' } });
  assert.strictEqual((await runPublishDue()).scanned, 1);
  await PlannedPost.deleteOne({ _id: post._id });
});

test('Theme Apply job: live heartbeat = running, stale = interrupted, legacy uses boot id', async () => {
  const post = await PlannedPost.create({ user: user._id, instagramUsername: 'studio', date: '2031-02-01', title: 't' });
  const live = await ThemeApplyJob.create({ user: user._id, post: post._id, bootId: 'other-process', heartbeatAt: new Date() });
  assert.strictEqual((await call('GET', `/posts/theme-jobs/${live._id}`)).body.status, 'running', 'another instance with a live heartbeat');

  const stale = await ThemeApplyJob.create({ user: user._id, post: post._id, heartbeatAt: new Date(Date.now() - 5 * 60_000) });
  assert.strictEqual((await call('GET', `/posts/theme-jobs/${stale._id}`)).body.status, 'interrupted');

  const legacy = await ThemeApplyJob.create({ user: user._id, post: post._id, bootId: 'old-boot' });
  await ThemeApplyJob.collection.updateOne({ _id: legacy._id }, { $unset: { heartbeatAt: '' } });
  assert.strictEqual((await call('GET', `/posts/theme-jobs/${legacy._id}`)).body.status, 'interrupted');
});

test('a second Theme Apply on a post with a live run joins it', async () => {
  const post = await PlannedPost.create({ user: user._id, instagramUsername: 'studio', date: '2031-02-02', title: 't' });
  const live = await ThemeApplyJob.create({ user: user._id, post: post._id, heartbeatAt: new Date() });
  const r = await call('POST', `/posts/${post._id}/theme-image`, { async: true });
  assert.strictEqual(r.status, 202);
  assert.strictEqual(r.body.jobId, String(live._id));
  assert.strictEqual(r.body.reused, true);
});

test('debug endpoints are admin-only', async () => {
  const post = await PlannedPost.create({ user: user._id, instagramUsername: 'studio', date: '2031-03-01', title: 'd', agentTrace: { a: 1 } });
  assert.strictEqual((await call('GET', `/posts/${post._id}/debug`)).status, 403);
  assert.strictEqual((await call('POST', '/debug/rerun-prompt', { prompt: 'x' })).status, 403);
  await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  require('../src/middleware/auth').invalidateUserCache(String(user._id));
  assert.strictEqual((await call('GET', `/posts/${post._id}/debug`)).status, 200);
  await User.updateOne({ _id: user._id }, { $set: { role: 'user' } });
  require('../src/middleware/auth').invalidateUserCache(String(user._id));
});

test('AI routes answer 429 with Retry-After past the per-minute cap', async () => {
  const other = await User.create({ name: 'L', email: 'l@example.test', password: 'x'.repeat(12) });
  const t = jwt.sign({ id: String(other._id) }, process.env.JWT_SECRET);
  const codes = [];
  for (let i = 0; i < 7; i++) {
    // no profile → 404 from the handler, but the limiter counts the call first
    // eslint-disable-next-line no-await-in-loop
    codes.push((await call('POST', '/posts/generate', {}, t)).status);
  }
  assert.deepStrictEqual(codes.slice(0, 6), [404, 404, 404, 404, 404, 404]);
  assert.strictEqual(codes[6], 429);
});

test('limitFetch caps in-flight calls and honours abort while queued', async () => {
  const { limitFetch } = require('../src/utils/limitFetch');
  let inFlight = 0; let peak = 0;
  const slow = async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 30)); inFlight--; return 'ok'; };
  const limited = limitFetch(slow, { name: 'x', max: 2 });
  const out = await Promise.all(Array.from({ length: 6 }, () => limited('u', {})));
  assert.deepStrictEqual(out, Array(6).fill('ok'));
  assert.strictEqual(peak, 2);

  const ac = new AbortController();
  const hold = [limited('u', {}), limited('u', {})];
  const queued = limited('u', { signal: ac.signal });
  ac.abort();
  await assert.rejects(queued);
  await Promise.all(hold);
  assert.deepStrictEqual(limited.stats(), { active: 0, waiting: 0, cap: 2 });
  assert.strictEqual(limitFetch(slow, { name: 'unset' }), slow, 'no cap configured → untouched');
});
