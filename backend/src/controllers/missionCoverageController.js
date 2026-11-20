const { requestedUsername } = require('../utils/currentProfile');
const { appLocaleOf } = require('../utils/appLocale');
const { wantsPromptDebug } = require('../utils/promptDebug');
const { missionCoverage, fetchRecentMissions } = require('../services/missionCoverage');
const { contentTerritory } = require('../services/contentTerritory');

// GET /api/analysis/missions[?refresh=1] — Analysis › Mission coverage for the current handle.
async function getMissionCoverage(req, res) {
  return respond(req, res, (username, opts) => missionCoverage(req.user._id, username, {
    ...opts, refresh: req.query.refresh === '1' || req.query.refresh === 'true',
  }));
}

// POST /api/analysis/missions/fetch — Fetch recent: adds only posts newer than the newest one stored.
async function fetchRecentMissionPosts(req, res) {
  return respond(req, res, (username, opts) => fetchRecentMissions(req.user._id, username, opts));
}

// GET /api/analysis/topics[?refresh=1] — Analysis › Topic map: Skills / Passion / Story topics, covered or not.
async function getContentTerritory(req, res) {
  return respond(req, res, (username, opts) => contentTerritory(req.user._id, username, {
    ...opts, refresh: req.query.refresh === '1' || req.query.refresh === 'true',
  }), 'topic map');
}

async function respond(req, res, work, mode = 'mission coverage') {
  const username = await requestedUsername(req.user._id, req.query.handle || req.body?.handle);
  if (!username) return res.json({ username: null, total: 0, posts: [] });
  const debug = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  try {
    const out = await work(username, { locale: appLocaleOf(req), debug });
    res.json({
      ...out,
      username,
      ...(debug && debug.length ? {
        debug: {
          mode,
          model: debug[0].model,
          elapsedMs: Date.now() - started,
          agents: debug,
          usage: { estimatedCostUsd: debug.reduce((n, r) => n + (r.usage?.estimatedCostUsd || 0), 0) },
        },
      } : {}),
    });
  } catch (err) {
    console.error(`[analysis] ${mode} for @${username} failed:`, err.message);
    res.status(502).json({ message: mode === 'topic map'
      ? 'We could not map your content topics just now. Please try again.'
      : 'We could not analyse your recent Instagram posts just now. Please try again.' });
  }
}

module.exports = { getMissionCoverage, fetchRecentMissionPosts, getContentTerritory };
