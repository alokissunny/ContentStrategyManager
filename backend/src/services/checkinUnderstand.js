/*
 * Check-in understanding — same Capture Conversation agent as Projects,
 * plus the project list so a matching name can be returned on ready.
 */

const { understandCapture, UNDERSTAND_TOOL, TOOL_NAME } = require('./captureUnderstand');

async function understandCheckin(input = {}) {
  const result = await understandCapture({ ...input, kind: 'checkin' });
  const choice = String(result.understanding?.visualAssetChoice || '').toLowerCase();
  const hasAssets = (input.attachments || []).length > 0;
  const visualGaps = Array.isArray(result.understanding?.visualLimitations)
    ? result.understanding.visualLimitations.filter(Boolean).length
    : 0;
  result.ack = '';
  result.matchedProjectName = result.matchedProjectName || '';
  result.matchedProjectId = null;
  result.askForAssets = !hasAssets && (visualGaps > 0 || (choice !== 'generate' && choice !== 'none'));
  if (Array.isArray(input.projects) && result.matchedProjectName) {
    const n = result.matchedProjectName.toLowerCase();
    const hit = input.projects.find((p) => String(p.name || '').toLowerCase() === n);
    if (hit) result.matchedProjectId = hit.id || hit._id || null;
  }
  return result;
}

module.exports = {
  understandCheckin,
  UNDERSTAND_TOOL,
  TOOL_NAME,
};
