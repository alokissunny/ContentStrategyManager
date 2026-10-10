const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { getCarouselModel, updateCarouselModel, getBrandVoiceModel, updateBrandVoiceModel } = require('../controllers/settingsController');

const router = express.Router();

router.use(protect);
router.get('/carousel-model', asyncHandler(getCarouselModel));
router.put('/carousel-model', asyncHandler(updateCarouselModel));
router.get('/brand-voice-model', asyncHandler(getBrandVoiceModel));
router.put('/brand-voice-model', asyncHandler(updateBrandVoiceModel));

module.exports = router;
