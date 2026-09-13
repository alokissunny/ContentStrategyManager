const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { getCarouselModel, updateCarouselModel } = require('../controllers/settingsController');

const router = express.Router();

router.use(protect);
router.get('/carousel-model', asyncHandler(getCarouselModel));
router.put('/carousel-model', asyncHandler(updateCarouselModel));

module.exports = router;
