const { currentUsername } = require('../utils/currentProfile');
const { appLocaleOf } = require('../utils/appLocale');
const { wantsPromptDebug } = require('../utils/promptDebug');
const { missionCoverage } = require('../services/missionCoverage');

// GET /api/analysis/missions[?refresh=1] — Analysis › Mission coverage for the current handle.
async function getMissionCoverage(req, res) {
  const username = await currentUsername(req.user._id);
  if (!username) return res.json({ username: null, total: 0, posts: [] });
  const debug = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  try {
    const out = await missionCoverage(req.user._id, username, {
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
      locale: appLocaleOf(req),
      debug,
    });
    res.json({
      ...out,
      username,
      ...(debug && debug.length ? {
        debug: {
          mode: 'mission coverage',
          model: debug[0].model,
          elapsedMs: Date.now() - started,
          agents: debug,
          usage: { estimatedCostUsd: debug.reduce((n, r) => n + (r.usage?.estimatedCostUsd || 0), 0) },
        },
      } : {}),
    });
  } catch (err) {
    console.error(`[analysis] mission coverage for @${username} failed:`, err.message);
    res.status(502).json({ message: 'We could not analyse your recent Instagram posts just now. Please try again.' });
  }
}

module.exports = { getMissionCoverage };
