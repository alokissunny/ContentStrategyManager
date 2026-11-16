const mongoose = require('mongoose');
const { currentUsername } = require('../utils/currentProfile');
const { appLocaleOf } = require('../utils/appLocale');
const { wantsPromptDebug } = require('../utils/promptDebug');
const { nextIdeas, decideIdea } = require('../services/nextPostIdea');

// GET /api/ideas/next[?refresh=1] — "What could you share next?" for the current handle.
async function getNextIdeas(req, res) {
  const username = await currentUsername(req.user._id);
  if (!username) return res.json({ ideas: [], username: null });
  const debug = wantsPromptDebug(req) ? [] : null;
  const started = Date.now();
  try {
    const out = await nextIdeas(req.user._id, username, {
      locale: appLocaleOf(req),
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
      debug,
    });
    res.json({
      ...out,
      username,
      ...(debug && debug.length ? {
        debug: {
          mode: 'next-post idea',
          model: debug[0].model,
          elapsedMs: Date.now() - started,
          agents: debug,
          usage: { estimatedCostUsd: debug.reduce((n, r) => n + (r.usage?.estimatedCostUsd || 0), 0) },
        },
      } : {}),
    });
  } catch (err) {
    console.error(`[ideas] next idea for @${username} failed:`, err.message);
    res.status(502).json({ message: 'Bauhly could not think of a next post just now. Please try again.' });
  }
}

// PATCH /api/ideas/:id { status: accepted | saved | dismissed, captureId? }
async function updateIdea(req, res) {
  const { id } = req.params;
  const status = String(req.body?.status || '');
  if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Idea not found.' });
  if (!['accepted', 'saved', 'dismissed'].includes(status)) {
    return res.status(400).json({ message: 'status must be accepted, saved or dismissed.' });
  }
  try {
    const idea = await decideIdea(req.user._id, id, { status, captureId: req.body?.captureId });
    if (!idea) return res.status(404).json({ message: 'Idea not found.' });
    res.json({ idea });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ message: err.message });
    throw err;
  }
}

module.exports = { getNextIdeas, updateIdea };
