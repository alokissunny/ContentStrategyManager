const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect, requireAdmin } = require('../middleware/auth');
const { createReel, listReels, getReel, deleteReel, reelSystem } = require('../controllers/captureReelController');

// Captures › Generate reel. POST starts a background job; the page polls GET.
const router = express.Router();
router.use(protect);
router.get('/', asyncHandler(listReels));
router.post('/', aiLimit('heavy'), asyncHandler(createReel));
router.get('/system', requireAdmin, asyncHandler(reelSystem));
router.get('/:id', asyncHandler(getReel));
router.delete('/:id', asyncHandler(deleteReel));
module.exports = router;
