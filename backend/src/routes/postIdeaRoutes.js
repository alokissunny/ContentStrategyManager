const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const { getNextIdeas, updateIdea, getIdeaReelPlan, ideaFromCapture } = require('../controllers/postIdeaController');

// Next-post ideas ("What could you share next?") — services/nextPostIdea.js
const router = express.Router();
router.use(protect);
router.get('/next', aiLimit('light'), asyncHandler(getNextIdeas));
router.post('/from-capture', asyncHandler(ideaFromCapture));
router.patch('/:id', asyncHandler(updateIdea));
router.post('/:id/reel-plan', aiLimit('light'), asyncHandler(getIdeaReelPlan));

module.exports = router;
