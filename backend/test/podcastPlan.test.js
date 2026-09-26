const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInput, normalizePlan, fallbackPlan, planPodcast } = require('../src/services/podcastPlan');
const owner = 'a'.repeat(24);
const assets = [{ id: 'h', key: `projects/${owner}/h.mp4`, role: 'host', name: 'Host', startSec: 0, endSec: 10, offsetSec: 0 }, { id: 'g', key: `projects/${owner}/g.mp4`, role: 'guest', name: 'Guest', startSec: 0, endSec: 8, offsetSec: 2 }];
test('validates ownership, source IDs, host/guest and numeric bounds', () => {
  assert.equal(validateInput({ assets, mode: 'conversation' }, owner).assets.length, 2);
  for (const bad of [assets.map(a => ({ ...a, role: 'host' })), assets.map(a => ({ ...a, id: 'same' })), assets.map(a => ({ ...a, key: a.key.replace(owner, 'b'.repeat(24)) })), assets.map(a => ({ ...a, offsetSec: NaN }))]) assert.throws(() => validateInput({ assets: bad, mode: 'conversation' }, owner));
});
test('conversation enforces continuous master audio timeline and manual offsets', () => {
  const raw = { segments: [{ assetId: 'h', sourceStart: 0, sourceEnd: 4 }, { assetId: 'g', sourceStart: 2, sourceEnd: 8 }] };
  assert.equal(normalizePlan(raw, assets, 'conversation').durationSec, 10);
  assert.throws(() => normalizePlan({ segments: [{ assetId: 'g', sourceStart: 0, sourceEnd: 8 }] }, assets, 'conversation'), /synchronized/);
  assert.throws(() => normalizePlan({ segments: [{ assetId: 'h', sourceStart: 0, sourceEnd: 9 }] }, assets, 'conversation'), /complete/);
});
test('separate segments retain source chronology and reject fabricated ranges', () => {
  assert.equal(fallbackPlan(assets, 'segments').durationSec, 18);
  assert.throws(() => normalizePlan({ segments: [{ assetId: 'h', sourceStart: 5, sourceEnd: 10 }, { assetId: 'h', sourceStart: 1, sourceEnd: 2 }] }, assets, 'segments'), /chronological/);
  assert.throws(() => normalizePlan({ segments: [{ assetId: 'h', sourceStart: 0, sourceEnd: 99 }] }, assets, 'segments'), /trim/);
});
test('three agents run separately and rejected critique yields conservative review plan', async () => {
  const analyzed = assets.map(a => ({ ...a, transcript: { segments: [{ start: 0, end: 1, text: 'Hello' }] } }));
  const calls = [];
  const output = await planPodcast({ assets: analyzed, mode: 'segments' }, { completeToolCall: async args => {
    calls.push(args.system);
    return { parsed: calls.length === 1 ? { notes: 'notes', warnings: [] } : calls.length === 2 ? { title: 'Episode', summary: 'Story', segments: [{ assetId: 'h', sourceStart: 0, sourceEnd: 10 }, { assetId: 'g', sourceStart: 0, sourceEnd: 8 }] } : { approved: false, warnings: ['Meaning changed'] } };
  } });
  assert.equal(calls.length, 3); assert.equal(output.agents.length, 3);
  assert.match(output.plan.summary, /Original uploads/); assert.ok(output.plan.warnings.some(w => /conservative/.test(w)));
});
