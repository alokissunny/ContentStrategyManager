const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { fetchCompetitors, getCompetitors } = require('../controllers/competitorController');

const router = express.Router();

router.use(protect);
router.post('/fetch', asyncHandler(fetchCompetitors));
router.get('/', asyncHandler(getCompetitors));

module.exports = router;
