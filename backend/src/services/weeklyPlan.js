const fs = require('fs');
const path = require('path');
const getAnthropicClient = require('./anthropicClient');
const { computeAuthorityFunnel } = require('./authorityFunnel');

const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'weekly-plan-prompt.md');
let promptTemplate;
function loadPrompt() {
  if (!promptTemplate) promptTemplate = fs.readFileSync(PROMPT_PATH, 'utf8');
  return promptTemplate;
}

// Defensive JSON extraction — models wrap output in ```json fences, a bare
// object, or prose before it. (Same approach as competitorFinder.)
function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced) return JSON.parse(fenced[1]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  return JSON.parse(text);
}

const PILLAR_LABEL = { discovery: 'Discovery', credibility: 'Credibility', trust: 'Trust' };
const GOAL_TAG = { discovery: 'Get noticed', credibility: 'Show expertise', trust: 'Build confidence' };

// The authority funnel gives a verdict per pillar; the dashboard's stage bars
// need a numeric 0–100. Map the verdict to a representative score.
const VERDICT_SCORE = { 'Strong': 82, 'Moderate': 60, 'Early stage': 44, 'Not established': 26 };
function scoreForVerdict(verdict) {
  return VERDICT_SCORE[verdict] ?? 40;
}

// Monday-anchored week range → { weekOf: Date, weekLabel: "Jul 6 – Jul 12" }.
function weekRange(date = new Date()) {
  const d = new Date(date);
  const monday = new Date(d);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { weekOf: monday, weekLabel: `${fmt(monday)} – ${fmt(sunday)}`, monday };
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Split the 7 days across Discovery / Credibility / Trust in proportion to how
// much each pillar *needs* work (weaker score → more days), so a week for an
// account with strong Discovery but weak Credibility/Trust leans C+T. Every
// pillar keeps at least one day so the whole funnel stays warm.
function allocateDays(funnel, totalDays = 7) {
  const needs = funnel.map((f) => ({ pillar: f.pillar, need: Math.max(1, 100 - (f.score || 0)) }));
  const totalNeed = needs.reduce((s, n) => s + n.need, 0) || 1;

  const alloc = {};
  needs.forEach((n) => { alloc[n.pillar] = 1; });

  let remaining = totalDays - needs.length;
  const shares = needs.map((n) => ({ pillar: n.pillar, exact: (n.need / totalNeed) * remaining }));
  shares.forEach((s) => {
    const whole = Math.floor(s.exact);
    alloc[s.pillar] += whole;
    remaining -= whole;
  });
  // Hand out any leftover days by largest fractional remainder.
  shares.sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (let i = 0; i < shares.length && remaining > 0; i += 1, remaining -= 1) {
    alloc[shares[i].pillar] += 1;
  }
  return alloc;
}

function buildSnapshot(profile, brandDna) {
  return {
    username: profile.username,
    fullName: profile.fullName,
    biography: profile.biography,
    followersCount: profile.followersCount,
    externalUrl: profile.externalUrl,
    brandDna: brandDna || null,
    recentCaptions: (profile.posts || []).slice(0, 12).map((p) => p.caption).filter(Boolean),
  };
}

// Deterministic funnel (Discovery/Credibility/Trust) + numeric scores + the
// week's focus pillar, all derived from the scraped snapshot.
function buildFunnelWithScores(profile) {
  const { week, funnel } = computeAuthorityFunnel(profile);
  const scored = funnel.map((row) => ({
    pillar: row.pillar,
    score: scoreForVerdict(row.verdict),
    verdict: row.verdict,
    evidence: row.evidence,
    whyMatters: row.whyMatters,
    recommendation: row.recommendation,
  }));
  return { funnel: scored, focusPillar: week.focus, confidence: week.confidence, seed: week };
}

// Render the competitor context the plan should react to: who they are plus the
// "what's working / what's not" insights pulled from the competitor analysis.
function renderCompetitorInsights(competitorInsights) {
  if (!competitorInsights) return 'No competitor analysis available yet — plan from the account\'s own data.';
  const { competitors = [], insights = '' } = competitorInsights;
  const parts = [];
  if (competitors.length) {
    parts.push(
      'Competitors:\n' +
        competitors
          .map((c) => `- @${c.username} — ${c.followers || '?'} followers, ${c.cohort || 'peer'}${c.designStyle ? `, ${c.designStyle}` : ''}`)
          .join('\n')
    );
  }
  if (insights) parts.push(`\nFrom their last 30 days:\n${insights}`);
  return parts.join('\n') || 'No competitor analysis available yet.';
}

/**
 * Generate a full weekly content plan for a profile.
 * @param {object} profile
 * @param {object} brandDna
 * @param {object} [competitorInsights]  { competitors, insights } from the competitor analysis.
 * @returns {Promise<{ weekOf, weekLabel, model, focus, funnel, days }>}
 */
async function generateWeeklyPlan(profile, brandDna, competitorInsights = null) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const { funnel, focusPillar, confidence, seed } = buildFunnelWithScores(profile);
  const { weekOf, weekLabel, monday } = weekRange();

  const dayAllocation = allocateDays(funnel);
  const focusSummary = {
    pillar: focusPillar,
    pillarLabel: PILLAR_LABEL[focusPillar],
    confidence,
    seedObservation: seed.observation,
    seedHeadline: seed.headline,
    funnel: funnel.map((f) => ({ pillar: f.pillar, verdict: f.verdict, score: f.score, recommendation: f.recommendation })),
    // How many of the 7 days each pillar must get, weighted by how weak it is.
    dayAllocation,
  };

  const snapshot = buildSnapshot(profile, brandDna);
  // Replacements use a function so `$` sequences in the data (prices, `$&`…)
  // are inserted literally rather than treated as replacement patterns.
  const prompt = loadPrompt()
    .replace('{{FOCUS_JSON}}', () => JSON.stringify(focusSummary, null, 2))
    .replace('{{SNAPSHOT_JSON}}', () => JSON.stringify(snapshot, null, 2))
    .replace('{{COMPETITOR_INSIGHTS}}', () => renderCompetitorInsights(competitorInsights));

  const insightNote = competitorInsights ? 'with competitor insights' : 'no competitor insights';
  console.log(`[weeklyPlan] Generating plan for @${snapshot.username} (focus: ${focusPillar}, ${insightNote}) with ${model}`);

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    // A 7-day plan with full per-day content is long; give it room so the JSON
    // is never cut off mid-array (a truncated block can't be parsed).
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  });
  const fullText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');

  let parsed;
  try {
    parsed = extractJson(fullText);
  } catch (err) {
    // Surface why it failed — truncation (stop_reason "max_tokens") vs malformed
    // output — instead of a bare JSON error.
    const pos = Number((err.message.match(/position (\d+)/) || [])[1]);
    const around = Number.isFinite(pos) ? fullText.slice(Math.max(0, pos - 160), pos + 160) : fullText.slice(-320);
    console.error(
      `[weeklyPlan] Could not parse plan JSON for @${snapshot.username} ` +
        `(stop_reason=${response.stop_reason}, chars=${fullText.length}): ${err.message}\n...${around}...`
    );
    throw new Error(`Weekly plan generation returned unparseable JSON (stop_reason=${response.stop_reason})`);
  }

  const focusOut = parsed.focus || {};
  const focus = {
    pillar: focusPillar,
    headline: focusOut.headline || seed.headline,
    hypothesis: focusOut.hypothesis || seed.hypothesis,
    recommendation: focusOut.recommendation || '',
    whyMatters: focusOut.whyMatters || seed.whyMatters,
    observation: focusOut.observation || seed.observation,
  };

  const days = (parsed.days || []).slice(0, 7).map((d, i) => {
    const pillar = ['discovery', 'credibility', 'trust'].includes(d.pillar) ? d.pillar : focusPillar;
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const c = d.content || {};
    return {
      day: d.day || DAY_NAMES[i],
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      time: d.time || '',
      format: ['Reel', 'Carousel', 'Post', 'Story'].includes(d.format) ? d.format : 'Post',
      contentType: d.contentType || '',
      pillar,
      goalTag: d.goalTag || GOAL_TAG[pillar],
      title: d.title || '',
      direction: d.direction || '',
      published: false,
      content: {
        onScreenText: Array.isArray(c.onScreenText) ? c.onScreenText : [],
        caption: c.caption || '',
        cta: c.cta || '',
        hashtags: Array.isArray(c.hashtags) ? c.hashtags.map((h) => String(h).replace(/^#/, '')) : [],
        strategy: c.strategy || '',
        prompts: Array.isArray(c.prompts) ? c.prompts : [],
        plan: c.plan || '',
      },
    };
  });

  const actual = days.reduce((acc, d) => ({ ...acc, [d.pillar]: (acc[d.pillar] || 0) + 1 }), {});
  const matches = Object.keys(dayAllocation).every((p) => (actual[p] || 0) === dayAllocation[p]);
  console.log(
    `[weeklyPlan] @${snapshot.username}: ${days.length} days generated · ` +
      `pillar mix ${JSON.stringify(actual)} (target ${JSON.stringify(dayAllocation)})${matches ? '' : ' — MISMATCH'}`
  );

  return { weekOf, weekLabel, model, focus, funnel, days, dayAllocation };
}

module.exports = { generateWeeklyPlan, buildFunnelWithScores, weekRange, allocateDays };
