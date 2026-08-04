const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { fetchInstagram, getInstagramProfile, activateInstagram, getAuthorityFunnel, getAnalysisOverview } = require('../controllers/instagramController');

const router = express.Router();

router.use(protect);
router.post('/fetch', asyncHandler(fetchInstagram));
router.get('/', asyncHandler(getInstagramProfile));
router.post('/activate', asyncHandler(activateInstagram));
router.get('/authority', asyncHandler(getAuthorityFunnel));
router.get('/analysis-overview', asyncHandler(getAnalysisOverview));

module.exports = router;
