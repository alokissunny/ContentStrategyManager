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

/**
 * Generate a full weekly content plan for a profile.
 * @returns {Promise<{ weekOf, weekLabel, model, focus, funnel, days }>}
 */
async function generateWeeklyPlan(profile, brandDna) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const { funnel, focusPillar, confidence, seed } = buildFunnelWithScores(profile);
  const { weekOf, weekLabel, monday } = weekRange();

  const focusSummary = {
    pillar: focusPillar,
    pillarLabel: PILLAR_LABEL[focusPillar],
    confidence,
    seedObservation: seed.observation,
    seedHeadline: seed.headline,
    funnel: funnel.map((f) => ({ pillar: f.pillar, verdict: f.verdict, score: f.score, recommendation: f.recommendation })),
  };

  const snapshot = buildSnapshot(profile, brandDna);
  const prompt = loadPrompt()
    .replace('{{FOCUS_JSON}}', JSON.stringify(focusSummary, null, 2))
    .replace('{{SNAPSHOT_JSON}}', JSON.stringify(snapshot, null, 2));

  console.log(`[weeklyPlan] Generating plan for @${snapshot.username} (focus: ${focusPillar}) with ${model}`);

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  });
  const fullText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const parsed = extractJson(fullText);

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

  console.log(`[weeklyPlan] @${snapshot.username}: ${days.length} days generated`);

  return { weekOf, weekLabel, model, focus, funnel, days };
}

module.exports = { generateWeeklyPlan, buildFunnelWithScores, weekRange };
