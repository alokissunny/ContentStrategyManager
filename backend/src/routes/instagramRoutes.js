const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const { fetchInstagram, getInstagramProfile, activateInstagram, getAuthorityFunnel, getAnalysisOverview, refreshGraphMedia } = require('../controllers/instagramController');

const router = express.Router();

router.use(protect);
router.post('/fetch', aiLimit('heavy'), asyncHandler(fetchInstagram));
router.get('/', asyncHandler(getInstagramProfile));
router.post('/refresh-media', aiLimit('heavy'), asyncHandler(refreshGraphMedia));
router.post('/activate', asyncHandler(activateInstagram));
router.get('/authority', asyncHandler(getAuthorityFunnel));
router.get('/analysis-overview', asyncHandler(getAnalysisOverview));

module.exports = router;
