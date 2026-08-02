const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { getCompetitorOverview } = require('../controllers/competitorController');

const router = express.Router();

router.use(protect);
router.get('/overview', asyncHandler(getCompetitorOverview));

module.exports = router;
