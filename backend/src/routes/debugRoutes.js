const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { rerunDebugPrompt } = require('../controllers/debugController');

const router = express.Router();

router.use(protect);
router.post('/rerun-prompt', asyncHandler(rerunDebugPrompt));

module.exports = router;
