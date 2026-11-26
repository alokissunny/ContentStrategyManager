const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect, requireAdmin } = require('../middleware/auth');
const {
  createReel, voiceoverScript, regenerateReel, listReels, getReel, deleteReel, reelSystem,
  claimBrowserRender, browserRenderProgress, browserRenderDone, browserRenderFail,
} = require('../controllers/captureReelController');

// Captures › Generate reel. POST starts a background job; the page polls GET.
const router = express.Router();
router.use(protect);
router.get('/', asyncHandler(listReels));
router.post('/', aiLimit('heavy'), asyncHandler(createReel));
router.post('/voiceover-script', aiLimit('light'), asyncHandler(voiceoverScript));
router.get('/system', requireAdmin, asyncHandler(reelSystem));
router.post('/:id/regenerate', aiLimit('heavy'), asyncHandler(regenerateReel));
// rendering in the studio's browser (services/browserReelRender.js)
router.post('/:id/browser-render/claim', asyncHandler(claimBrowserRender));
router.post('/:id/browser-render/progress', asyncHandler(browserRenderProgress));
router.post('/:id/browser-render/done', asyncHandler(browserRenderDone));
router.post('/:id/browser-render/fail', asyncHandler(browserRenderFail));
router.get('/:id', asyncHandler(getReel));
router.delete('/:id', asyncHandler(deleteReel));
module.exports = router;
