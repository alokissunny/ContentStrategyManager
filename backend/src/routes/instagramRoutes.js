const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const { fetchInstagram, getInstagramProfile, activateInstagram, getAuthorityFunnel, getAnalysisOverview, refreshGraphMedia } = require('../controllers/instagramController');

const { claimVisitorRead } = require('../services/visitorInstagram');
const { wantsPromptDebug } = require('../utils/promptDebug');

const router = express.Router();

router.use(protect);
router.post('/fetch', aiLimit('heavy'), asyncHandler(fetchInstagram));
router.get('/', asyncHandler(getInstagramProfile));
router.post('/refresh-media', aiLimit('heavy'), asyncHandler(refreshGraphMedia));
router.post('/activate', asyncHandler(activateInstagram));
router.get('/authority', asyncHandler(getAuthorityFunnel));
router.get('/analysis-overview', asyncHandler(getAnalysisOverview));
// A landing visitor who has just made an account: their Instagram read (if they gave one) and their
// studio answers become this account's profile and Business memory (services/visitorInstagram.js).
// POST /api/instagram/visitor-claim { token?, answers? } → { username, instagram }
router.post('/visitor-claim', aiLimit('heavy'), asyncHandler(async (req, res) => {
  const out = await claimVisitorRead(req.user, { token: req.body?.token, answers: req.body?.answers, debug: wantsPromptDebug(req) });
  res.json(out);
}));

module.exports = router;
