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

// Content-pillar priority: Discovery > Credibility > Trust. When two pillars are
// both gaps, the higher-priority one always earns more days. Used to weight the
// day split so the week leans hardest on the highest-priority gap.
const PILLAR_ORDER = ['discovery', 'credibility', 'trust'];
const PRIORITY_WEIGHT = { discovery: 3, credibility: 2, trust: 1 };

// A pillar is a "gap" (needs work this week) when it hasn't reached Strong.
// Moderate/Strong pillars are already carrying their weight, so they only keep
// the single baseline day that keeps the whole funnel warm.
function isGapVerdict(verdict) {
  return verdict === 'Not established' || verdict === 'Early stage';
}

// This week's focus = the highest-priority pillar that is a gap (Discovery
// first), regardless of which gap is numerically largest. Falls back to
// Discovery when nothing is clearly lacking, so reach stays warm.
function pickFocus(funnel) {
  const verdictOf = Object.fromEntries(funnel.map((f) => [f.pillar, f.verdict]));
  return PILLAR_ORDER.find((p) => isGapVerdict(verdictOf[p])) || 'discovery';
}

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

// Split the 7 days across Discovery / Credibility / Trust by content-pillar gap,
// with a firm priority of Discovery > Credibility > Trust:
//   • Every pillar keeps 1 baseline day, so the week always covers all of D/C/T.
//   • The remaining days go to the *gap* pillars (those below Strong), weighted
//     by priority — so when D and T are both gaps, D always gets more days than
//     C and T. Priority, not gap size, decides the order: a bigger Trust gap
//     never out-weights a Discovery gap.
//   • If nothing is a clear gap, the extra days still lean by priority so
//     Discovery (reach) stays warm.
function allocateDays(funnel, totalDays = 7) {
  const alloc = { discovery: 1, credibility: 1, trust: 1 };
  let remaining = totalDays - PILLAR_ORDER.length;
  if (remaining <= 0) return alloc;

  const gaps = funnel.filter((f) => isGapVerdict(f.verdict));
  const pool = gaps.length ? gaps : funnel; // no gaps → lean by priority
  const weights = pool.map((f) => ({ pillar: f.pillar, w: PRIORITY_WEIGHT[f.pillar] }));
  const totalW = weights.reduce((s, x) => s + x.w, 0) || 1;

  // Largest-remainder apportionment of the remaining days, weighted by priority.
  const exact = weights.map((x) => ({ pillar: x.pillar, x: (x.w / totalW) * remaining }));
  exact.forEach((e) => {
    const whole = Math.floor(e.x);
    alloc[e.pillar] += whole;
    remaining -= whole;
  });
  // Leftover days by largest fractional remainder, ties broken by priority so
  // the higher-priority pillar wins.
  exact.sort((a, b) => (b.x % 1) - (a.x % 1) || PRIORITY_WEIGHT[b.pillar] - PRIORITY_WEIGHT[a.pillar]);
  for (let i = 0; i < exact.length && remaining > 0; i += 1, remaining -= 1) {
    alloc[exact[i].pillar] += 1;
  }
  return alloc;
}

// Compact historical read of the account, so the plan is explicitly grounded in
// the account's own history (not just its Brand DNA). The authority funnel turns
// these same signals into per-pillar verdicts; this surfaces the raw numbers to
// the planner too.
function summarizeHistory(profile) {
  const posts = Array.isArray(profile?.posts) ? profile.posts : [];
  const now = Date.now();
  const THIRTY = 30 * 24 * 60 * 60 * 1000;
  const last30 = posts.filter((p) => p.timestamp && now - new Date(p.timestamp).getTime() <= THIRTY);
  const reels = posts.filter((p) => /video|reel|clip/i.test(p.type || '')).length;
  const engaged = posts.filter((p) => p.likesCount != null || p.commentsCount != null);
  const avg = (key) =>
    engaged.length ? Math.round(engaged.reduce((s, p) => s + (p[key] || 0), 0) / engaged.length) : 0;
  return {
    totalPostsAnalyzed: posts.length,
    postsLast30: last30.length,
    reels,
    avgLikes: avg('likesCount'),
    avgComments: avg('commentsCount'),
  };
}

function buildSnapshot(profile, brandDna) {
  return {
    username: profile.username,
    fullName: profile.fullName,
    biography: profile.biography,
    followersCount: profile.followersCount,
    externalUrl: profile.externalUrl,
    brandDna: brandDna || null,
    history: summarizeHistory(profile),
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
  // Focus by content-pillar priority (Discovery > Credibility > Trust) rather
  // than by which gap is largest, so the week's lead matches the day split.
  const focusPillar = pickFocus(scored);
  return { funnel: scored, focusPillar, confidence: week.confidence, seed: week };
}

const trendPp = (changePp) =>
  changePp == null ? '' : `, ${changePp > 0 ? '+' : ''}${changePp}pp`;

// Render the assigned competitor cohort's analysis (the same dashboard the back
// office / Competitor Overview shows) into a compact "what's working for the
// cohort" brief, grouped so the planner can lean into what works within each
// pillar. When the user has no assigned cohort (or no analysis yet), the plan
// falls back to the account's own Brand DNA and history.
function renderCompetitorInsights(cohortInsights) {
  if (!cohortInsights || !cohortInsights.dashboard) {
    return "No competitor cohort assigned (or no analysis yet) — plan from the account's own Brand DNA and history.";
  }
  const { cohort, scopeUsed, dashboard } = cohortInsights;
  const ca = dashboard.captionAnalysis || {};
  const lines = [];

  const closest =
    scopeUsed && cohort && scopeUsed.location !== cohort.location
      ? ` (no analysis for ${cohort.location} yet — using the closest cohort: ${scopeUsed.location})`
      : '';
  lines.push(`Competitor cohort: ${cohort.businessCategory} · ${cohort.location}${closest}.`);
  const kp = ca.kpis || {};
  if (kp.competitors || kp.captions) {
    lines.push(`Based on ${kp.competitors || '?'} competitors · ${kp.captions || '?'} public captions (last 30 days).`);
  }

  const patterns = (ca.patterns || []).slice(0, 6);
  if (patterns.length) {
    lines.push('\nTop caption patterns that work for the cohort (pillar in brackets):');
    patterns.forEach((p) =>
      lines.push(
        `- [${p.pillar || '—'}] ${p.name} — ${p.sharePct}% of captions${trendPp(p.trend && p.trend.changePp)}` +
          `${p.whatWeDetected ? `: ${p.whatWeDetected}` : ''}`
      )
    );
  }

  const hooks = (dashboard.hooks || []).slice(0, 5);
  if (hooks.length) {
    lines.push('\nHooks the cohort opens with:');
    hooks.forEach((h) =>
      lines.push(`- [${h.pillar || '—'}] ${h.hookType} — used in ${h.useRate}% of captions${h.trend ? `, ${h.trend}` : ''}`)
    );
  }

  const topics = (dashboard.topics || []).slice(0, 5);
  if (topics.length) {
    lines.push('\nTopics the cohort posts about:');
    topics.forEach((t) => lines.push(`- [${t.pillar || '—'}] ${t.topic} — ${t.sharePct}% of posts${trendPp(t.changePp)}`));
  }

  const formats = (ca.formats || []).slice(0, 4);
  if (formats.length) {
    lines.push('\nFormat mix (share of posts):');
    formats.forEach((f) => lines.push(`- ${f.label} — ${f.sharePct}%${trendPp(f.changePp)}`));
  }

  const days = (ca.days || []).slice(0, 4);
  if (days.length) {
    lines.push('\nBusiest days / peak times:');
    days.forEach((d) => lines.push(`- ${d.label}${d.peakTime ? ` — ${d.peakTime}` : ''} (${d.sharePct}% of posts)`));
  }

  return lines.join('\n');
}

// Project inventory for the planner: names, notes, and image keys it can assign
// to slides. Kept compact so the prompt stays within context.
function renderProjectAssets(projects) {
  if (!projects?.length) {
    return 'No project assets on file yet. Keep posts specific to the niche but do not invent named projects or claim photos exist.';
  }
  const parts = projects.map((p) => {
    const lines = [`### ${p.name}`];
    if (p.notes?.length) {
      lines.push('Notes:');
      p.notes.forEach((n) => lines.push(`- ${n}`));
    }
    if (p.assets?.length) {
      lines.push('Photos (use assetKey on matching slides):');
      p.assets.forEach((a) => {
        const note = a.note ? ` — ${a.note}` : '';
        lines.push(`- assetKey: ${a.key}${note}`);
      });
    } else {
      lines.push('Photos: none yet');
    }
    return lines.join('\n');
  });
  return parts.join('\n\n');
}

const SLIDE_ROLES = {
  Carousel: ['Hook', 'Setup', 'Process', 'Process', 'Result', 'CTA'],
  Reel: ['Hook', 'Setup', 'CTA'],
  Story: ['Hook', 'Beat', 'CTA'],
  Post: ['Hook', 'CTA'],
};

function normalizeSlides(rawSlides, onScreenText, format, title, cta) {
  const roles = SLIDE_ROLES[format] || SLIDE_ROLES.Post;
  let slides = Array.isArray(rawSlides)
    ? rawSlides.map((s) => ({
        role: String(s.role || '').trim(),
        title: String(s.title || '').trim(),
        assetKey: String(s.assetKey || '').trim(),
      })).filter((s) => s.title || s.role)
    : [];

  if (!slides.length) {
    const texts = Array.isArray(onScreenText) ? onScreenText.filter(Boolean) : [];
    if (texts.length) {
      slides = texts.map((t, i) => ({
        role: roles[Math.min(i, roles.length - 1)],
        title: String(t),
        assetKey: '',
      }));
    } else {
      slides = [
        { role: 'Hook', title: title || 'Open with the strongest frame', assetKey: '' },
        ...(format === 'Carousel'
          ? [
              { role: 'Setup', title: 'Set the context', assetKey: '' },
              { role: 'Process', title: 'Show the work', assetKey: '' },
              { role: 'Result', title: 'The outcome', assetKey: '' },
            ]
          : []),
        { role: 'CTA', title: cta || 'Invite them to enquire', assetKey: '' },
      ];
    }
  }

  return slides.map((s, i) => ({
    role: s.role || roles[Math.min(i, roles.length - 1)],
    title: s.title || '',
    assetKey: s.assetKey || '',
  }));
}

/**
 * Generate a full weekly content plan for a profile.
 * @param {object} profile
 * @param {object} brandDna
 * @param {object} [competitorInsights]  { cohort, scopeUsed, dashboard } — the assigned
 *   competitor cohort's analysis, or null when the user has no cohort / no analysis yet.
 * @param {object[]} [projects]  Project names + notes + image assetKeys from the studio.
 * @returns {Promise<{ weekOf, weekLabel, model, focus, funnel, days }>}
 */
async function generateWeeklyPlan(profile, brandDna, competitorInsights = null, projects = []) {
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
    // Per-pillar verdict + the historical evidence behind it, so the planner
    // grounds the week in the account's own history, not just its Brand DNA.
    funnel: funnel.map((f) => ({
      pillar: f.pillar,
      verdict: f.verdict,
      score: f.score,
      evidence: f.evidence,
      recommendation: f.recommendation,
    })),
    // How many of the 7 days each pillar gets — weighted by the content-pillar
    // gap with priority Discovery > Credibility > Trust.
    dayAllocation,
  };

  const snapshot = buildSnapshot(profile, brandDna);
  // Replacements use a function so `$` sequences in the data (prices, `$&`…)
  // are inserted literally rather than treated as replacement patterns.
  const prompt = loadPrompt()
    .replace('{{FOCUS_JSON}}', () => JSON.stringify(focusSummary, null, 2))
    .replace('{{SNAPSHOT_JSON}}', () => JSON.stringify(snapshot, null, 2))
    .replace('{{COMPETITOR_INSIGHTS}}', () => renderCompetitorInsights(competitorInsights))
    .replace('{{PROJECT_ASSETS}}', () => renderProjectAssets(projects));

  const insightNote = competitorInsights ? 'with competitor insights' : 'no competitor insights';
  const assetCount = projects.reduce((n, p) => n + (p.assets?.length || 0), 0);
  console.log(
    `[weeklyPlan] Generating plan for @${snapshot.username} (focus: ${focusPillar}, ${insightNote}, ` +
      `${projects.length} projects / ${assetCount} photos) with ${model}`
  );

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
  // Fallbacks reference the chosen (priority-based) focus pillar, which can
  // differ from the funnel's own seed focus.
  const focusRow = funnel.find((f) => f.pillar === focusPillar);
  const focusLabel = PILLAR_LABEL[focusPillar];
  const focus = {
    pillar: focusPillar,
    headline:
      focusOut.headline ||
      (confidence === 'low' ? 'Build Your Authority Foundation' : `Strengthen Your ${focusLabel}`),
    hypothesis:
      focusOut.hypothesis ||
      `If we focus on ${focusLabel} this week, we can turn the account's momentum into measurable growth.`,
    recommendation: focusOut.recommendation || focusRow?.recommendation || '',
    whyMatters: focusOut.whyMatters || focusRow?.whyMatters || seed.whyMatters,
    observation: focusOut.observation || seed.observation,
  };

  const days = (parsed.days || []).slice(0, 7).map((d, i) => {
    const pillar = ['discovery', 'credibility', 'trust'].includes(d.pillar) ? d.pillar : focusPillar;
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const c = d.content || {};
    const format = ['Reel', 'Carousel', 'Post', 'Story'].includes(d.format) ? d.format : 'Post';
    const slides = normalizeSlides(c.slides, c.onScreenText, format, d.title, c.cta);
    const onScreenText = Array.isArray(c.onScreenText) && c.onScreenText.length
      ? c.onScreenText
      : slides.map((s) => s.title).filter(Boolean);
    return {
      day: d.day || DAY_NAMES[i],
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      time: d.time || '',
      format,
      contentType: d.contentType || '',
      pillar,
      goalTag: d.goalTag || GOAL_TAG[pillar],
      title: d.title || '',
      direction: d.direction || '',
      published: false,
      content: {
        slides,
        onScreenText,
        caption: c.caption || '',
        cta: c.cta || '',
        hashtags: Array.isArray(c.hashtags) ? c.hashtags.map((h) => String(h).replace(/^#/, '')) : [],
        strategy: c.strategy || '',
        prompts: Array.isArray(c.prompts) ? c.prompts : [],
        plan: c.plan || '',
        notes: c.notes || '',
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

module.exports = { generateWeeklyPlan, buildFunnelWithScores, weekRange, allocateDays, normalizeSlides };
