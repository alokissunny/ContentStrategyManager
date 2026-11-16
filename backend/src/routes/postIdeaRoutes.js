const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const { getNextIdeas, updateIdea } = require('../controllers/postIdeaController');

// Next-post ideas ("What could you share next?") — services/nextPostIdea.js
const router = express.Router();
router.use(protect);
router.get('/next', aiLimit('light'), asyncHandler(getNextIdeas));
router.patch('/:id', asyncHandler(updateIdea));

module.exports = router;
