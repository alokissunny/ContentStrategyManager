const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect, requireAdmin } = require('../middleware/auth');
const { rerunDebugPrompt } = require('../controllers/debugController');

const { wantsPromptDebug } = require('../utils/promptDebug');
const { listBackgroundDebug } = require('../services/aiDebugLog');

const router = express.Router();

// AI calls that ran in the background for this studio (onboarding's reads), for the debug panel.
// GET /api/debug/background?after=<ISO> → { calls: [{ id, label, debug, at }] }
router.get('/background', protect, asyncHandler(async (req, res) => {
  if (!wantsPromptDebug(req)) return res.json({ calls: [] });
  res.json({ calls: await listBackgroundDebug(req.user._id, req.query.after) });
}));

router.use(protect, requireAdmin);
router.post('/rerun-prompt', asyncHandler(rerunDebugPrompt));

module.exports = router;
