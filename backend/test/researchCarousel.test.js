const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateInput, validatePlan, slideDocuments } = require('../src/services/researchCarousel');
const source = { title: 'Example source', url: 'https://example.com/report', quote: 'Supporting evidence.' };
const plan = () => ({ caption: 'Explore this topic.', sources: [source], slides: Array.from({ length: 7 }, () => ({ title: 'A practical idea', body: 'Try this approach.', sourceIds: [1] })) });
test('input rejects blank, oversized and unsupported requests', () => {
  assert.deepEqual(validateInput({ topic: ' Test ' }), { topic: 'Test', platform: 'linkedin', theme: 'default' });
  for (const input of [{ topic: '' }, { topic: 'x'.repeat(501) }, { topic: 'Test', platform: '__proto__' }, { topic: 'Test', theme: '../default' }]) assert.throws(() => validateInput(input), { statusCode: 400 });
});
test('source URLs must come from web-search evidence and slide citations must exist', () => {
  const evidence = { urls: [source.url] };
  assert.equal(validatePlan(plan(), evidence, 'linkedin').slides.length, 7);
  assert.throws(() => validatePlan(plan(), { urls: [] }, 'linkedin'));
  const bad = plan(); bad.slides[0].sourceIds = [2];
  assert.throws(() => validatePlan(bad, evidence, 'linkedin'));
  const long = plan(); long.slides[0].body = 'word '.repeat(41);
  assert.throws(() => validatePlan(long, evidence, 'linkedin'));
  assert.throws(() => validatePlan(plan(), evidence, 'x'));
});
test('all themes escape generated copy, disable remote resources, and append visible sources', async () => {
  const value = plan(); value.slides[0].title = '<script>alert("x")</script>';
  for (const theme of ['default', 'bold', 'technical']) {
    const documents = await slideDocuments(value, theme);
    assert.equal(documents.length, 8);
    assert.ok(!documents[0].includes('<script>'));
    assert.match(documents[0], /&lt;script&gt;/);
    assert.ok(!documents[0].includes('<link'));
    assert.match(documents[0], /Content-Security-Policy/);
    assert.match(documents[0], /Swipe →/);
    assert.match(documents[7], /Sources/);
    assert.match(documents[7], /https:\/\/example.com\/report/);
    assert.match(documents[7], /8 \/ 8/);
  }
});
