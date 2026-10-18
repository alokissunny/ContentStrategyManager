const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getCarouselModel, updateCarouselModel, getBrandVoiceModel, updateBrandVoiceModel,
  getThemeRegionsModel, updateThemeRegionsModel, getStrategistModel, updateStrategistModel,
  getThemeApplyPhotoMode, updateThemeApplyPhotoMode,
  getArtDirector, updateArtDirector,
} = require('../controllers/settingsController');

const router = express.Router();

router.use(protect);
router.get('/carousel-model', asyncHandler(getCarouselModel));
router.put('/carousel-model', asyncHandler(updateCarouselModel));
router.get('/strategist-model', asyncHandler(getStrategistModel));
router.put('/strategist-model', asyncHandler(updateStrategistModel));
router.get('/brand-voice-model', asyncHandler(getBrandVoiceModel));
router.put('/brand-voice-model', asyncHandler(updateBrandVoiceModel));
router.get('/theme-regions-model', asyncHandler(getThemeRegionsModel));
router.put('/theme-regions-model', asyncHandler(updateThemeRegionsModel));
router.get('/theme-apply-photo', asyncHandler(getThemeApplyPhotoMode));
router.put('/theme-apply-photo', asyncHandler(updateThemeApplyPhotoMode));
router.get('/art-director', asyncHandler(getArtDirector));
router.put('/art-director', asyncHandler(updateArtDirector));

module.exports = router;
