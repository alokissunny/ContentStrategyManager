/*
 * Shared inputs for plan generation — the loaders that gather everything the
 * planner grounds a plan in: the account's Brand DNA, its assigned competitor
 * cohort's analysis, and the studio's project captures/photos (auto-analyzing
 * any image that has never been through vision).
 *
 * These were originally private helpers inside routeController (the legacy
 * week-based flow). They're extracted here so the post-centric postController
 * can reuse them without importing the legacy controller. The legacy
 * routeController keeps its own copies.
 */
const BrandAnalysisReport = require('../models/BrandAnalysisReport');
const Project = require('../models/Project');
const { analyzeImageAsset } = require('./imageAnalysis');
const { loadCompetitorOverviewForUser } = require('../controllers/competitorController');
const { findMetaConnectionForUsername } = require('./graphInstagram');

const MAX_AUTO_ANALYZE = Number(process.env.PLAN_AUTO_ANALYZE_LIMIT) || 16;

/** Human age of a Date for plan-source logs. */
function ageLabel(date) {
  if (!date) return 'unknown age';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Trace where Instagram inputs for a plan come from. Planning always reads the
 * saved InstagramProfile snapshot (it does not live-call Apify/Graph) — so we
 * log the snapshot's origin (`dataSource`) plus whether Meta is connected now.
 */
async function logPlanInstagramSource(userId, profile, trigger = 'generate') {
  const username = profile?.username || '?';
  const origin = profile?.dataSource || 'unknown';
  const posts = Array.isArray(profile?.posts) ? profile.posts.length : 0;
  const hasInsights = Boolean(
    profile?.insights &&
      (profile.insights.reach != null ||
        profile.insights.impressions != null ||
        profile.insights.profileViews != null ||
        profile.insights.views != null),
  );
  let metaConnected = false;
  try {
    metaConnected = Boolean(await findMetaConnectionForUsername(userId, username));
  } catch (err) {
    console.warn(`[posts] could not check Meta connection for @${username}:`, err.message);
  }

  const sourceNote =
    origin === 'graph'
      ? 'SAVED snapshot originally from Meta Graph API'
      : origin === 'apify'
        ? 'SAVED snapshot originally from Apify scrape'
        : 'SAVED snapshot (origin unknown — analyze before this field existed)';

  console.log(
    `[posts] ${trigger} @${username} · Instagram input: ${sourceNote}` +
      ` · fetched ${ageLabel(profile?.fetchedAt)}` +
      ` · posts=${posts}` +
      ` · graphInsights=${hasInsights ? 'yes' : 'no'}` +
      ` · metaConnectedNow=${metaConnected ? 'yes' : 'no'}` +
      ` · dataSource=${origin}`,
  );
}

// Competitor cohort (Business Type + Location assigned in the back office) and
// its saved analysis dashboard. Null when none is assigned yet.
async function loadCohortCompetitorInsights(userId, username) {
  const overview = await loadCompetitorOverviewForUser(userId, username);
  if (!overview || !overview.cohort || !overview.dashboard) return null;
  return { cohort: overview.cohort, scopeUsed: overview.scopeUsed, dashboard: overview.dashboard };
}

// Brand DNA axes from the latest confirmed report; blanked when cleared.
async function loadBrandDna(userId, username) {
  const report = await BrandAnalysisReport.findOne({ user: userId, instagramUsername: username }).sort({
    createdAt: -1,
  });
  if (!report) return null;
  if (report.brandDnaClearedAt) {
    return {
      whatYouOffer: '', whoYouHelp: '', firstProblem: '', position: '',
      proof: '', howYouSound: '', visualStyle: '', neverDo: '',
    };
  }
  return {
    whatYouOffer: report.whatYouOffer || '',
    whoYouHelp: report.whoYouHelp || '',
    firstProblem: report.firstProblem || '',
    position: report.position || '',
    proof: report.proof || '',
    howYouSound: report.howYouSound || '',
    visualStyle: report.visualStyle || '',
    neverDo: report.neverDo || '',
  };
}

// Never truncate originalCapture — the planner must see the full story.
function captureSourceText(c) {
  const u = c.understanding;
  return String(u?.originalCapture || c.text || c.sessionSummary || '').trim();
}

// Auto-analyze any project image that has never been through vision, bounded
// per run. Best-effort: a bad image or missing key never blocks generation.
async function ensureProjectImagesAnalyzed(projects) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  let budget = MAX_AUTO_ANALYZE;
  for (const p of projects) {
    if (budget <= 0) break;
    let dirty = false;
    for (const c of p.captures || []) {
      for (const a of c.attachments || []) {
        if (budget <= 0) break;
        if (a.type !== 'image' || !a.key) continue;
        if (a.analysis && a.analysis.status === 'done') continue;
        budget -= 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          const result = await analyzeImageAsset(a.key, { type: a.type });
          a.analysis = { status: 'done', ...result, error: '', analyzedAt: new Date() };
          dirty = true;
        } catch (err) {
          console.error('[posts] auto-analyse failed for', a.key, err.message);
          a.analysis = { status: 'error', error: err.message || 'Analysis failed', analyzedAt: new Date() };
          dirty = true;
        }
      }
    }
    if (dirty) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await p.save();
      } catch (err) {
        console.error('[posts] could not persist auto-analysis for project', p._id?.toString(), err.message);
      }
    }
  }
}

function asPlain(doc) {
  if (!doc) return null;
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
}

function storiesOfCapture(c) {
  const stories = Array.isArray(c.stories) ? c.stories.filter(Boolean) : [];
  if (stories.length) return stories;
  if (c.understanding) return [c.understanding];
  return [null];
}

function mergeStoriesForPlan(stories, originalCapture) {
  const rows = (stories || []).map(asPlain).filter(Boolean);
  if (!rows.length) return originalCapture ? { originalCapture } : null;
  const first = { ...rows[0], originalCapture: rows[0].originalCapture || originalCapture };
  if (rows.length === 1) return first;
  first.internalStories = rows.flatMap((r) => r.internalStories || []).slice(0, 12);
  first.verifiedFacts = rows.flatMap((r) => r.verifiedFacts || []).slice(0, 24);
  first.clarificationAnswers = rows.flatMap((r) => r.clarificationAnswers || []).slice(0, 8);
  first.storyRelationships = rows.flatMap((r) => r.storyRelationships || []).slice(0, 16);
  first.captureAssets = rows.flatMap((r) => r.captureAssets || []).slice(0, 8);
  if (!first.summary) {
    first.summary = rows.map((r) => r.summary || r.captureSummary).filter(Boolean).join(' · ');
  }
  return first;
}

async function loadProjectAssets(userId, username) {
  const filter = { user: userId };
  // Strict handle match — unscoped / other-account projects must not be planned
  // onto this account's calendar.
  if (username) filter.instagramUsername = username;
  const projects = await Project.find(filter).sort({ updatedAt: -1 }).limit(12);
  await ensureProjectImagesAnalyzed(projects);
  return projects.map((p) => {
    const capturesNewest = [...(p.captures || [])].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );
    const notes = [];
    const assets = [];
    for (const c of capturesNewest) {
      const captureAssets = [];
      for (const a of c.attachments || []) {
        if (a.type === 'image' && a.key) {
          const an = a.analysis && a.analysis.status === 'done' ? a.analysis : null;
          const item = {
            key: a.key,
            note: '',
            vision: an
              ? {
                  summary: an.summary || '',
                  description: an.description || '',
                  subjects: (an.subjects || []).slice(0, 8),
                  tags: (an.tags || []).slice(0, 10),
                  colors: (an.colors || []).slice(0, 6),
                  mood: an.mood || '',
                  text: an.text || '',
                }
              : null,
          };
          captureAssets.push(item);
          assets.push(item);
        }
      }
      const sessionId = String(c.sessionId || '').trim();
      const storyRows = storiesOfCapture(c);
      const primary = asPlain(storyRows[0]);
      const originalCapture = captureSourceText({
        text: c.text,
        sessionSummary: c.sessionSummary,
        understanding: primary,
      });
      const filled = mergeStoriesForPlan(storyRows, originalCapture);
      if (originalCapture || captureAssets.length || filled) {
        notes.push({
          id: filled?.captureId || (c._id ? String(c._id) : ''),
          text: originalCapture,
          createdAt: c.createdAt || null,
          sessionId,
          assets: captureAssets,
          understanding: filled,
        });
      }
    }
    return {
      id: p._id.toString(),
      name: p.name,
      notes,
      assets: assets.slice(0, 24),
    };
  });
}

// Asset keys already claimed by existing posts' slides — so a fresh generation
// never re-uses a photo that another planned post is already using.
function collectUsedAssetKeys(posts) {
  const used = new Set();
  for (const p of posts || []) {
    for (const sl of p.content?.slides || []) {
      if (sl.assetKey) used.add(sl.assetKey);
    }
  }
  return used;
}

module.exports = {
  logPlanInstagramSource,
  loadCohortCompetitorInsights,
  loadBrandDna,
  loadProjectAssets,
  collectUsedAssetKeys,
};
