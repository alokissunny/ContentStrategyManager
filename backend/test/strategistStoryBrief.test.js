// The Strategist writes a story-level brief (plan-strategist.md): no hook,
// slides, caption or CTA. Its story moments become the outline, its evidence
// map the allocated photos, and the carousel agent writes the caption + CTA.
// Run: node --test test/strategistStoryBrief.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

for (const k of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'S3_BUCKET_NAME', 'AWS_ACCESS_KEY_ID']) delete process.env[k];
process.env.CAROUSEL_LAYOUT_CHECK = '0';
process.env.CAROUSEL_CONTRAST_CHECK = '0';

const llm = require('../src/services/llmComplete');
const prompts = {};
llm.completeText = async ({ kind, user, prompt, system }) => {
  prompts[kind] = `${system || ''}\n${user || prompt || ''}`;
  if (kind === 'strategist') {
    return {
      text: JSON.stringify({
        focus: { headline: 'H' },
        constraints: {},
        briefs: [{
          angle: 'Why the island moved back',
          audienceLens: { reader: 'Homeowners with a narrow kitchen' },
          audienceTension: 'They fear an island will block the room',
          story: 'The island was pulled back so two people can pass.',
          centralFact: 'Island pulled back 20 cm',
          storyAngle: 'authority',
          relevance: { chosenInsight: 'Clearance matters more than island size' },
          supportingFacts: [
            { fact: 'Island pulled back 20 cm', source: 'capture', status: 'completed' },
            { fact: 'Pantry wall planned', source: 'capture', status: 'proposed' },
          ],
          evidenceMap: [{ key: 'k1', stage: 'completed', area: 'island', shows: 'The new island', supports: 'The clearance', cannotProve: ['the old layout'], moments: ['m2'] }],
          storyMoments: [
            { id: 'm1', moment: 'The narrow kitchen problem', facts: ['narrow'], visualNeed: 'helpful', photos: [] },
            { id: 'm2', moment: 'Pulling the island back', facts: ['20 cm'], visualNeed: 'essential', photos: ['k1'] },
          ],
          readerAction: { goal: 'Consider a layout consultation', stage: 'considering' },
          caption: 'SHOULD BE DROPPED',
          format: 'Carousel',
        }],
      }),
      stopReason: 'stop',
      usage: {},
    };
  }
  if (kind === 'carousel') {
    const roles = ['hook', 'resolution', 'cta'];
    const arts = roles.map((r, i) => `<article class="slide" data-index="${i + 1}" data-role="${r}"><h1 data-slot="title">T${i + 1}</h1></article>`).join('');
    return {
      text: `<html><head><style>.slide{width:1080px;height:1350px}</style></head><body><section data-direction="warm-editorial"><!-- hook-reasoning {"hook":"T1","audience":"a","payoffSlide":2} --><!-- post-copy {"caption":"Carousel caption","cta":"Book a layout call"} --><!-- post-review {"openingHonest":"yes","payoffDelivered":"fixed: tightened slide 2","lengthJustified":"no, padded"} -->${arts}</section></body></html>`,
      stopReason: 'stop',
      usage: {},
    };
  }
  throw new Error(`unexpected agent ${kind}`);
};
require('../src/services/brandKitColors').brandKitColors = async () => null;

const orch = require('../src/services/planOrchestrator');
const weekly = require('../src/services/weeklyPlan');

const profile = { username: 'tester', posts: [] };
const brandDna = { offer: 'Kitchens', audience: 'Homeowners' };
const options = () => ({
  weekDate: new Date('2026-10-06T00:00:00'),
  usedAssetKeys: new Set(),
  monthCalendar: { month: '2026-10', occupied: [], emptyDates: [{ date: '2026-10-07', dayOfMonth: 7, day: 'Wednesday' }] },
  userId: '64b000000000000000000001',
});

test('story-level brief → moments outline, no Strategist copy, carousel writes caption + CTA', async () => {
  const pre = weekly.prepareWeeklyPlan(profile, brandDna, null, [], options());
  const phase = await orch.runStrategistPhase(weekly.multiAgentArgsOf(pre, profile, brandDna, null, [], options()));
  const brief = phase.plannedDays[0];
  assert.equal(brief.caption, '');
  assert.equal(brief.storyMoments.length, 2);
  assert.deepEqual(brief.narrativeUnits.map((u) => u.id), ['m1', 'm2']);
  assert.equal(brief.readerAction.goal, 'Consider a layout consultation');
  assert.ok(phase.focusOut.codeReview.some((p) => /wrote caption/.test(p)));

  const day = await orch.writePlanDay(phase, [], brief, 0);
  assert.equal(day.content.caption, 'Carousel caption');
  assert.equal(day.content.cta, 'Book a layout call');
  assert.equal(day.content.slides.length, 3);
  assert.ok(!/post-copy|post-review/.test(day.content.carouselHtml || ''));
  const checks = day.layout.storyChecks;
  assert.equal(day.layout.postReview.openingHonest, 'yes');
  assert.ok(checks.some((c) => /hook reasoning missing .*curiosity/.test(c)));
  // k1 is not a known asset here, so allocation drops it: no false 'missing photo' warning
  assert.ok(!checks.some((c) => /essential moment/.test(c)));
  assert.ok(checks.some((c) => /review not passed: lengthJustified$/.test(c)));
  assert.ok(!checks.some((c) => /resolution|CTA|payoffSlide|caption/.test(c)));
  assert.ok(/post-review/.test(prompts.carousel) && /curiosity/.test(prompts.carousel));
  assert.ok(/storyMoments/.test(prompts.carousel) && /readerAction/.test(prompts.carousel));
  assert.ok(!/SHOULD BE DROPPED/.test(prompts.carousel));
});
