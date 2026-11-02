// Boots the API against an in-memory MongoDB, seeds one studio, and records
// the list endpoints' responses — run before and after a change and diff
// (node test/apiRegression.harness.js out.json).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
delete process.env.S3_BUCKET_NAME;
delete process.env.REDIS_URL;
delete process.env.MONGO_URI;
const fs = require('fs');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { MongoMemoryServer } = require('mongodb-memory-server');

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };

async function seed() {
  const User = require('../src/models/User');
  const InstagramProfile = require('../src/models/InstagramProfile');
  const Project = require('../src/models/Project');
  const PlannedPost = require('../src/models/PlannedPost');
  const BrandAnalysisReport = require('../src/models/BrandAnalysisReport');
  const Signal = require('../src/models/Signal');
  const ThemeReference = require('../src/models/ThemeReference');
  const user = await User.create({ name: 'Studio', email: 's@example.test', password: 'x'.repeat(12) });
  await InstagramProfile.create({ user: user._id, username: 'studio', fetchedAt: new Date(Date.now() - 864e5 * 3), activatedAt: new Date() });
  const posts = [];
  for (let i = -40; i <= 40; i += 3) {
    posts.push(await PlannedPost.create({
      user: user._id, instagramUsername: 'studio', date: iso(addDays(i)), format: 'Carousel',
      title: `Post ${i}`, content: { slides: [{ role: 'Hook', title: `t${i}` }], caption: 'c' }, agentTrace: { big: 'x'.repeat(2000) },
    }));
  }
  const mkCapture = (n, extra = {}) => ({
    type: 'note', text: `capture ${n}`, sessionTitle: `S${n}`, sessionSummary: `sum ${n}`,
    conversationTurns: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'What happened?' }],
    understanding: { happened: 'h', summary: 's' }, stories: [{ happened: 'h2', summary: 's2' }],
    attachments: [{ type: 'image', key: `projects/${user._id}/a${n}.jpg`, analysis: { status: 'done', summary: 'img' } }],
    createdAt: addDays(-n), ...extra,
  });
  await Project.create({ user: user._id, instagramUsername: 'studio', name: 'Kitchen', captures: [mkCapture(1, { usedInPosts: [posts[2]._id, posts[5]._id] }), mkCapture(2)] });
  await Project.create({ user: user._id, instagramUsername: 'studio', name: 'Bathroom', captures: [mkCapture(3, { usedInPosts: [posts[7]._id] }), mkCapture(4, { excluded: true })] });
  await Project.create({ user: user._id, instagramUsername: 'studio', name: 'Empty', captures: [] });
  for (let i = 0; i < 3; i++) await BrandAnalysisReport.create({ user: user._id, instagramUsername: 'studio', s3Key: `r${i}`, model: 'm', whatYouOffer: `offer ${i}`, brandVoice: { labels: ['a'] } });
  for (let i = 0; i < 4; i++) await Signal.create({ user: user._id, category: 'trend', title: `sig ${i}` }).catch(() => {});
  await ThemeReference.create({ user: user._id, key: `projects/${user._id}/ref.jpg`, name: 'Ref', lastUsedAt: new Date() }).catch(() => {});
  return { user, posts };
}

async function main() {
  const out = process.argv[2] || 'regression.json';
  const mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const { user, posts } = await seed();
  const app = require('../src/app');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET);
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => (['updatedAt', '__v'].includes(k) ? undefined : x)));
  const from = iso(addDays(-10));
  const to = iso(addDays(20));
  const results = {};
  results.projectsFull = await call('GET', '/projects');
  results.projectsLite = await call('GET', '/projects?lite=1');
  results.postsAll = await call('GET', '/posts');
  results.postsWindow = await call('GET', `/posts?from=${from}&to=${to}`);
  results.reports = await call('GET', '/analysis/reports');
  results.signals = await call('GET', '/signals');
  results.themeRefs = await call('GET', '/posts/theme-references');
  results.postById = await call('GET', `/posts/${posts[20]._id}`);
  results.debugAsUser = await call('GET', `/posts/${posts[20]._id}/debug`);
  results.shiftAll = await call('POST', '/posts/shift', { moves: { [posts[25]._id]: iso(addDays(41)) } });
  results.shiftWindow = await call('POST', '/posts/shift', { moves: { [posts[25]._id]: iso(addDays(42)) }, from, to });
  results.distributeAll = await call('POST', '/posts/distribute', { mode: 'days', days: [1, 3, 5] });
  results.distributeWindow = await call('POST', '/posts/distribute', { mode: 'days', days: [1, 3, 5], from, to });
  results.health = await call('GET', '/health');
  fs.writeFileSync(out, JSON.stringify(strip(results), null, 1));
  console.log('wrote', out, Object.entries(results).map(([k, v]) => `${k}=${v.status}`).join(' '));
  server.close();
  await mongoose.disconnect();
  await mongo.stop();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
