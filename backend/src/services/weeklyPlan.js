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

// USD per million tokens — approximate list prices for cost display in the app.
// Override via ANTHROPIC_INPUT_USD_PER_MTOK / ANTHROPIC_OUTPUT_USD_PER_MTOK if needed.
function ratesForModel(model = '') {
  const m = String(model).toLowerCase();
  const envIn = Number(process.env.ANTHROPIC_INPUT_USD_PER_MTOK);
  const envOut = Number(process.env.ANTHROPIC_OUTPUT_USD_PER_MTOK);
  if (Number.isFinite(envIn) && Number.isFinite(envOut)) return { in: envIn, out: envOut };
  if (m.includes('opus')) return { in: 15, out: 75 };
  if (m.includes('haiku')) return { in: 0.8, out: 4 };
  return { in: 3, out: 15 }; // sonnet family default
}

function estimatePlanCostUsd(model, inputTokens, outputTokens) {
  const { in: inRate, out: outRate } = ratesForModel(model);
  const usd = (inputTokens / 1e6) * inRate + (outputTokens / 1e6) * outRate;
  return Math.round(usd * 1e6) / 1e6; // micro-dollar precision
}

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

// One line describing what a photo actually shows, drawn from its AI image
// analysis (summary/subjects/tags/mood/colours/any legible text). This is what
// lets the planner put a *relevant* photo on a slide rather than a random key.
function describeAsset(a) {
  const v = a.vision;
  if (!v) {
    // Not analysed yet — fall back to the capture note, and flag it so the
    // planner treats the assignment as a guess rather than a described match.
    return a.note ? `${a.note} (not yet analysed)` : 'not analysed yet';
  }
  const bits = [];
  if (v.summary) bits.push(v.summary);
  if (v.subjects?.length) bits.push(`shows: ${v.subjects.join(', ')}`);
  if (v.mood) bits.push(`mood: ${v.mood}`);
  if (v.colors?.length) bits.push(`colours: ${v.colors.join(', ')}`);
  if (v.tags?.length) bits.push(`tags: ${v.tags.join(', ')}`);
  if (v.text) bits.push(`text in image: "${v.text}"`);
  if (a.note) bits.push(`studio note: ${a.note}`);
  return bits.join(' · ') || (a.note || 'no description');
}

// Searchable keyword text for one asset — its AI analysis plus the capture note.
// Used to rank an unassigned photo against a post when auto-filling images.
function assetKeywords(a) {
  const v = a.vision;
  return [
    v?.summary,
    ...(v?.subjects || []),
    ...(v?.tags || []),
    v?.mood,
    v?.text,
    a.note,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const FILL_STOP = new Set('the a an and or of to for with in on at from your our this that these those is are be as by it its into out up over under about you we they them their post reel story slide day week content'.split(' '));
function fillKeywordSet(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !FILL_STOP.has(w))
  );
}
function scoreAssetForWords(words, kw) {
  if (!kw) return 0;
  const set = fillKeywordSet(kw);
  let hits = 0;
  words.forEach((w) => { if (set.has(w)) hits += 1; });
  return hits;
}

// Project inventory for the planner: names, notes, and image assets — each with
// a content description from AI analysis — that it can assign to slides. Kept
// compact so the prompt stays within context.
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
      lines.push('Photos — put an assetKey on a slide only when the photo genuinely fits that slide:');
      p.assets.forEach((a) => lines.push(`- assetKey: ${a.key} — ${describeAsset(a)}`));
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

function normalizeSlides(rawSlides, onScreenText, format, title, cta, validKeys = null, usedKeys = null) {
  const roles = SLIDE_ROLES[format] || SLIDE_ROLES.Post;
  // Only keep an assetKey the model returns if it's a real project asset. The
  // model sometimes echoes a placeholder, a partial key, or a key from another
  // project — dropping unknown keys is what stops an irrelevant/nonexistent
  // photo from riding through to the post. Null = no project context to check.
  const keepKey = (k) => (validKeys ? (validKeys.has(k) ? k : '') : k);
  let slides = Array.isArray(rawSlides)
    ? rawSlides.map((s) => ({
        role: String(s.role || '').trim(),
        title: String(s.title || '').trim(),
        assetKey: keepKey(String(s.assetKey || '').trim()),
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

  // Each image is used at most once. `usedKeys` is shared across a post's slides
  // and (when the caller threads one set through the whole month) across every
  // post in the plan — so no photo repeats within a post or across posts. A key
  // that's already been claimed is blanked so its slide falls back to no photo.
  const seen = usedKeys || new Set();
  return slides.map((s, i) => {
    let assetKey = s.assetKey || '';
    if (assetKey) {
      if (seen.has(assetKey)) assetKey = '';
      else seen.add(assetKey);
    }
    return {
      role: s.role || roles[Math.min(i, roles.length - 1)],
      title: s.title || '',
      assetKey,
    };
  });
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
async function generateWeeklyPlan(profile, brandDna, competitorInsights = null, projects = [], options = {}) {
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const { funnel, focusPillar: gapPillar, confidence, seed } = buildFunnelWithScores(profile);
  // A month's four weeks share one focus (the month's pillar-gap pillar), so the
  // caller can override the per-week gap pillar. Defaults to the gap pillar.
  const focusPillar = options.focusPillar || gapPillar;
  // Anchor to a specific week when generating a month of consecutive weeks.
  const { weekOf, weekLabel, monday } = weekRange(options.weekDate);

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
  // Compact JSON (no pretty-print) keeps the prompt smaller without changing content.
  const prompt = loadPrompt()
    .replace('{{FOCUS_JSON}}', () => JSON.stringify(focusSummary))
    .replace('{{SNAPSHOT_JSON}}', () => JSON.stringify(snapshot))
    .replace('{{COMPETITOR_INSIGHTS}}', () => renderCompetitorInsights(competitorInsights))
    .replace('{{PROJECT_ASSETS}}', () => renderProjectAssets(projects));

  const insightNote = competitorInsights ? 'with competitor insights' : 'no competitor insights';
  const assetCount = projects.reduce((n, p) => n + (p.assets?.length || 0), 0);
  const analyzedCount = projects.reduce(
    (n, p) => n + (p.assets || []).filter((a) => a.vision).length,
    0
  );
  console.log(
    `[weeklyPlan] Generating plan for @${snapshot.username} (focus: ${focusPillar}, ${insightNote}, ` +
      `${projects.length} projects / ${assetCount} photos, ${analyzedCount} with vision analysis) with ${model}`
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

  const inputTokens = Number(response.usage?.input_tokens) || 0;
  const outputTokens = Number(response.usage?.output_tokens) || 0;
  const usage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: estimatePlanCostUsd(model, inputTokens, outputTokens),
    model,
  };

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

  // Every real project image key — assetKeys the model returns are validated
  // against this so a hallucinated or mismatched key can't reach a slide.
  const validKeys = new Set(
    projects.flatMap((p) => (p.assets || []).map((a) => a.key)).filter(Boolean)
  );

  // One shared claim-set for the whole plan run: an image assigned to any slide
  // on any day can't be assigned again. When the caller (a month generation)
  // passes options.usedAssetKeys, the same set spans every week, so no photo
  // repeats across the whole monthly plan. Otherwise it's scoped to this week.
  const usedAssetKeys = options.usedAssetKeys || new Set();

  const days = (parsed.days || []).slice(0, 7).map((d, i) => {
    const pillar = ['discovery', 'credibility', 'trust'].includes(d.pillar) ? d.pillar : focusPillar;
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const c = d.content || {};
    const format = ['Reel', 'Carousel', 'Post', 'Story'].includes(d.format) ? d.format : 'Post';
    const slides = normalizeSlides(c.slides, c.onScreenText, format, d.title, c.cta, validKeys, usedAssetKeys);
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

  // Auto-fill: give any post the model left imageless a single relevant, still
  // unused photo — spread one per post, drawn from the same month-wide claim-set
  // so no image ever repeats within a post or across the plan. When the photos
  // run out, the post simply stays without an image (never a repeat). Persisting
  // the key here means the frontend renders it directly and never has to invent
  // a placeholder that could collide across weeks.
  const assetPool = projects.flatMap((p) =>
    (p.assets || []).map((a) => ({ key: a.key, kw: assetKeywords(a) }))
  );
  for (const d of days) {
    const slides = d.content.slides || [];
    if (slides.some((s) => s.assetKey)) continue; // post already has an image
    const available = assetPool.filter((a) => !usedAssetKeys.has(a.key));
    if (!available.length) continue; // no photos left — leave imageless
    const words = fillKeywordSet(`${d.title} ${d.direction} ${d.content.caption} ${slides[0]?.title || ''}`);
    let best = available[0];
    let bestScore = scoreAssetForWords(words, best.kw);
    for (const a of available) {
      const sc = scoreAssetForWords(words, a.kw);
      if (sc > bestScore) { best = a; bestScore = sc; }
    }
    // Put it on the post's first slide (its lead frame).
    if (slides[0]) {
      slides[0].assetKey = best.key;
      usedAssetKeys.add(best.key);
    }
  }

  const actual = days.reduce((acc, d) => ({ ...acc, [d.pillar]: (acc[d.pillar] || 0) + 1 }), {});
  const matches = Object.keys(dayAllocation).every((p) => (actual[p] || 0) === dayAllocation[p]);
  console.log(
    `[weeklyPlan] @${snapshot.username}: ${days.length} days generated · ` +
      `pillar mix ${JSON.stringify(actual)} (target ${JSON.stringify(dayAllocation)})${matches ? '' : ' — MISMATCH'} · ` +
      `${usage.totalTokens} tokens (~$${usage.estimatedCostUsd.toFixed(4)})`
  );

  return { weekOf, weekLabel, model, focus, funnel, days, dayAllocation, usage };
}

module.exports = { generateWeeklyPlan, buildFunnelWithScores, weekRange, allocateDays, normalizeSlides, estimatePlanCostUsd };
