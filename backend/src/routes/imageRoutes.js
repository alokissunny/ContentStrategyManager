const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { createImage } = require('../controllers/imageController');

const router = express.Router();

router.use(protect);

// Generate an image from a prompt (WeekView "Create image").
router.post('/create', asyncHandler(createImage));

module.exports = router;
