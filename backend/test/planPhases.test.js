// The queued generation path (services/planRunSteps) runs the plan in three
// phases across separate jobs, handing state over as JSON through MongoDB.
// These tests pin that it produces exactly what the in-process path does.
// Run: node --test test/planPhases.test.js
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'S3_BUCKET_NAME', 'AWS_ACCESS_KEY_ID']) delete process.env[k];

// Stub the model and the Brand Kit lookup before the orchestrator captures them.
const llm = require('../src/services/llmComplete');
const calls = [];
let briefCount = 3;
llm.completeText = async ({ kind }) => {
  calls.push(kind);
  if (kind === 'strategist') {
    return {
      text: JSON.stringify({
        focus: { headline: 'H' },
        constraints: briefCount ? {} : { insufficientContext: 'Need more.' },
        briefs: Array.from({ length: briefCount }, (_, i) => ({
          pillar: ['discovery', 'credibility', 'trust'][i % 3],
          angle: `Angle ${i}`,
          hookTerritory: `Hook ${i}`,
          format: 'Carousel',
          narrativeUnits: [
            { id: 'u1', index: 1, role: 'hook', purpose: `Hook ${i}`, support: 'S1' },
            { id: 'u2', index: 2, role: 'point', purpose: `Point ${i}`, support: 'S2' },
          ],
        })),
      }),
      stopReason: 'stop',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }
  if (kind === 'carousel') {
    const arts = [1, 2].map((n) => `<article class="slide" data-index="${n}"><h1 data-slot="title">T${n}</h1></article>`).join('');
    return {
      text: `<html><head><style>.slide{width:1080px;height:1350px}</style></head><body><section data-direction="warm-editorial">${arts}</section></body></html>`,
      stopReason: 'stop',
      usage: { input_tokens: 200, output_tokens: 300 },
    };
  }
  throw new Error(`unexpected agent ${kind}`);
};
require('../src/services/brandKitColors').brandKitColors = async () => null;

const orch = require('../src/services/planOrchestrator');
const weekly = require('../src/services/weeklyPlan');

const rt = (x) => JSON.parse(JSON.stringify(x));
const VOLATILE = /^(elapsedMs|started)$/;
function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.test(k)).map(([k, x]) => [k, strip(x)]));
  }
  return v;
}

const profile = { username: 'tester', posts: [] };
const brandDna = { offer: 'Kitchens', audience: 'Homeowners' };
const monthCalendar = {
  month: '2026-10',
  occupied: [],
  emptyDates: [
    { date: '2026-10-07', dayOfMonth: 7, day: 'Wednesday' },
    { date: '2026-10-09', dayOfMonth: 9, day: 'Friday' },
    { date: '2026-10-12', dayOfMonth: 12, day: 'Monday' },
  ],
};
const options = () => ({
  weekDate: new Date('2026-10-06T00:00:00'),
  usedAssetKeys: new Set(),
  monthCalendar,
  userId: '64b000000000000000000001',
});

// What planRunSteps does: prepare → Strategist → each post (any order) →
// finish, with every hand-off through JSON as it is through MongoDB.
async function queuedShape(order = (n) => [...Array(n).keys()]) {
  const pre = rt(weekly.prepareWeeklyPlan(profile, brandDna, null, [], options()));
  const phase = rt(await orch.runStrategistPhase(weekly.multiAgentArgsOf(pre, profile, brandDna, null, [], options())));
  const byIndex = new Map();
  for (const i of order(phase.plannedDays.length)) {
    byIndex.set(i, rt(await orch.writePlanDay(phase, [], phase.plannedDays[i], i)));
  }
  const results = phase.plannedDays.map((_, i) => byIndex.get(i));
  return weekly.finishWeeklyPlan(pre, orch.assemblePlanResult(phase, results), [], { usedAssetKeys: new Set() });
}

before(() => { calls.length = 0; });

test('queued phases produce the same plan as generateWeeklyPlan', async () => {
  briefCount = 3;
  const sync = await weekly.generateWeeklyPlan(profile, brandDna, null, [], options());
  assert.equal(sync.days.length, 3);
  const queued = await queuedShape();
  assert.deepEqual(strip(rt(queued)), strip(rt(sync)));
});

test('post results finishing out of order assemble in brief order', async () => {
  briefCount = 3;
  const sync = await weekly.generateWeeklyPlan(profile, brandDna, null, [], options());
  const queued = await queuedShape((n) => [...Array(n).keys()].reverse());
  assert.deepEqual(queued.days.map((d) => d.date), sync.days.map((d) => d.date));
  assert.deepEqual(strip(rt(queued)), strip(rt(sync)));
});

test('a skipped post is dropped the same way in both paths', async () => {
  briefCount = 3;
  const pre = rt(weekly.prepareWeeklyPlan(profile, brandDna, null, [], options()));
  const phase = rt(await orch.runStrategistPhase(weekly.multiAgentArgsOf(pre, profile, brandDna, null, [], options())));
  const results = [];
  for (let i = 0; i < phase.plannedDays.length; i += 1) {
    results.push(i === 1
      ? { index: 1, dayBrief: { date: phase.plannedDays[1].date }, result: null, skipped: 'failed', debugEntries: [], runUsages: [] }
      : rt(await orch.writePlanDay(phase, [], phase.plannedDays[i], i)));
  }
  const plan = weekly.finishWeeklyPlan(pre, orch.assemblePlanResult(phase, results), [], { usedAssetKeys: new Set() });
  assert.equal(plan.days.length, 2);
});

test('Strategist with no briefs → empty plan carrying its reason', async () => {
  briefCount = 0;
  const sync = await weekly.generateWeeklyPlan(profile, brandDna, null, [], options());
  const queued = await queuedShape();
  assert.equal(sync.days.length, 0);
  assert.equal(queued.constraints.insufficientContext, 'Need more.');
  assert.deepEqual(strip(rt(queued)), strip(rt(sync)));
  briefCount = 3;
});

test('a full calendar returns early without calling any agent', async () => {
  calls.length = 0;
  const pre = weekly.prepareWeeklyPlan(profile, brandDna, null, [], { ...options(), monthCalendar: { month: '2026-10', occupied: [], emptyDates: [] } });
  assert.ok(pre.earlyResult);
  assert.equal(pre.earlyResult.days.length, 0);
  assert.equal(calls.length, 0);
});

test('phase state survives JSON (what PlanRun.state stores)', async () => {
  briefCount = 3;
  const phase = await orch.runStrategistPhase(weekly.multiAgentArgsOf(
    weekly.prepareWeeklyPlan(profile, brandDna, null, [], options()), profile, brandDna, null, [], options(),
  ));
  assert.deepEqual(rt(phase), phase);
});
