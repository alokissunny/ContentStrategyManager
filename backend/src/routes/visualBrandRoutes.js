const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  signMoodUploads,
  listMoodImages,
  addMoodImages,
  deleteMoodImage,
} = require('../controllers/visualBrandController');

const router = express.Router();

router.use(protect);

// Visual Mood images (Library Settings page)
router.post('/mood/sign', asyncHandler(signMoodUploads));
router.get('/mood', asyncHandler(listMoodImages));
router.post('/mood', asyncHandler(addMoodImages));
router.delete('/mood/:key', asyncHandler(deleteMoodImage));

module.exports = router;
