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
  signBackgroundUploads,
  listBackgrounds,
  addBackgrounds,
  setDefaultBackground,
  deleteBackground,
  signMoodSetUploads,
  listMoodSets,
  saveMoodSets,
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

// Backgrounds (Brand Kit page) — picture grounds, one per S3 key, per handle
router.post('/backgrounds/sign', asyncHandler(signBackgroundUploads));
router.get('/backgrounds', asyncHandler(listBackgrounds));
router.post('/backgrounds', asyncHandler(addBackgrounds));
router.put('/backgrounds/default', asyncHandler(setDefaultBackground));
router.delete('/backgrounds/:key', asyncHandler(deleteBackground));

// Visual Mood sets (Brand Kit page) — named sets of up to four role references
router.post('/mood-sets/sign', asyncHandler(signMoodSetUploads));
router.get('/mood-sets', asyncHandler(listMoodSets));
router.put('/mood-sets', asyncHandler(saveMoodSets));

// Library Settings (palette, type, layout toggles) — per-handle, synced blob
router.get('/settings', asyncHandler(getSettings));
router.put('/settings', asyncHandler(saveSettings));

module.exports = router;
