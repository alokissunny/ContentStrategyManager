const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  createImage,
  listGeneratedImages,
  deleteGeneratedImage,
} = require('../controllers/imageController');

const router = express.Router();

router.use(protect);

// Generate an image from a prompt (WeekView "Create image").
router.post('/create', asyncHandler(createImage));

// The studio's generated-image library (the "Generated" asset folder).
router.get('/generated', asyncHandler(listGeneratedImages));
router.delete('/generated/:key', asyncHandler(deleteGeneratedImage));

module.exports = router;
