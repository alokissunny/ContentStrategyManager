const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { aiLimit } = require('../middleware/aiRateLimit');
const { listReelStyles, createReelStyle, removeReelStyle } = require('../controllers/reelStyleController');

// Reel styles for Captures › Generate reel › Choose reel style
const router = express.Router();
router.use(protect);
router.get('/', asyncHandler(listReelStyles));
router.post('/', aiLimit('heavy'), asyncHandler(createReelStyle));
router.delete('/:id', asyncHandler(removeReelStyle));
module.exports = router;
