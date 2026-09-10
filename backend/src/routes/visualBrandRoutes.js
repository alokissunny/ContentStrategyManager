const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  signMoodUploads,
  listMoodImages,
  addMoodImages,
  deleteMoodImage,
  signLogoUploads,
  listLogos,
  putLogo,
  deleteLogo,
  getSettings,
  saveSettings,
} = require('../controllers/visualBrandController');

const router = express.Router();

router.use(protect);

// Visual Mood images (Library Settings page)
router.post('/mood/sign', asyncHandler(signMoodUploads));
router.get('/mood', asyncHandler(listMoodImages));
router.post('/mood', asyncHandler(addMoodImages));
router.delete('/mood/:key', asyncHandler(deleteMoodImage));

// Logos (Library Settings page) — one file per named slot, per handle
router.post('/logos/sign', asyncHandler(signLogoUploads));
router.get('/logos', asyncHandler(listLogos));
router.post('/logos', asyncHandler(putLogo));
router.delete('/logos/:slot', asyncHandler(deleteLogo));

// Library Settings (palette, type, layout toggles) — per-handle, synced blob
router.get('/settings', asyncHandler(getSettings));
router.put('/settings', asyncHandler(saveSettings));

module.exports = router;
