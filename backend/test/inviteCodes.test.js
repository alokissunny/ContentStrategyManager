/* Invitation codes on sign-up: required, 4 chars, one use, released if the account fails. */
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const InviteCode = require('../src/models/InviteCode');
const User = require('../src/models/User');
const { register } = require('../src/controllers/authController');

let mongo;
before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([InviteCode.init(), User.init()]);
});
after(async () => { await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => { await InviteCode.deleteMany({}); await User.deleteMany({}); });

function call(body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
    };
    register({ body }, res).catch(reject);
  });
}
const base = (over = {}) => ({ name: 'Ana', email: 'ana@x.com', password: 'secret1', acceptTerms: true, ...over });

test('a code is required', async () => {
  const r = await call(base());
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'INVITE_REQUIRED');
  assert.equal(await User.countDocuments(), 0);
});

test('a good code makes the account once, any case', async () => {
  await InviteCode.create({ code: 'AB2C' });
  const r = await call(base({ inviteCode: 'ab-2c' }));
  assert.equal(r.status, 201);
  const inv = await InviteCode.findOne({ code: 'AB2C' }).lean();
  assert.ok(inv.usedAt);
  assert.equal(inv.usedByEmail, 'ana@x.com');
  assert.equal(String(inv.usedBy), String(r.body.user.id));
  assert.equal((await User.findOne({ email: 'ana@x.com' }).lean()).inviteCode, 'AB2C');

  const again = await call(base({ email: 'leo@x.com', inviteCode: 'AB2C' }));
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'INVITE_INVALID');
});

test('revoked, unknown and malformed codes are refused', async () => {
  await InviteCode.create({ code: 'ZZ99', revokedAt: new Date() });
  for (const inviteCode of ['ZZ99', 'QQQQ', 'TOOLONG']) {
    const r = await call(base({ inviteCode }));
    assert.equal(r.status, 400, inviteCode);
  }
});

test('two sign-ups racing one code: only one gets in', async () => {
  await InviteCode.create({ code: 'RACE' });
  const [a, b] = await Promise.all([
    call(base({ email: 'a@x.com', inviteCode: 'RACE' })),
    call(base({ email: 'b@x.com', inviteCode: 'RACE' })),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 400]);
  assert.equal(await User.countDocuments(), 1);
});

test('the code is handed back if the account cannot be made', async () => {
  await InviteCode.create({ code: 'BACK' });
  // a password too short fails in User.create, after the claim
  await assert.rejects(call(base({ password: '123', inviteCode: 'BACK' })));
  const inv = await InviteCode.findOne({ code: 'BACK' }).lean();
  assert.equal(inv.usedAt, null);
});
