/* Background AI calls for the debug panel (models/AiDebugCall.js). Never throws: debug must not sink the work. */
const AiDebugCall = require('../models/AiDebugCall');

async function recordBackgroundDebug(userId, label, debug) {
  if (!userId || !debug || !Array.isArray(debug.agents) || !debug.agents.length) return;
  try {
    await AiDebugCall.create({ user: userId, label, debug });
  } catch (err) {
    console.warn('[aiDebugLog] could not record', label, err.message);
  }
}

async function listBackgroundDebug(userId, after) {
  const since = after ? new Date(after) : null;
  const filter = { user: userId };
  if (since && !Number.isNaN(since.getTime())) filter.createdAt = { $gt: since };
  const rows = await AiDebugCall.find(filter).sort({ createdAt: 1 }).limit(50).lean();
  return rows.map((r) => ({ id: String(r._id), label: r.label, debug: r.debug, at: r.createdAt }));
}

module.exports = { recordBackgroundDebug, listBackgroundDebug };
