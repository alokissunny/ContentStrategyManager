const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { fetchInstagram, getInstagramProfile } = require('../controllers/instagramController');

const router = express.Router();

router.use(protect);
router.post('/fetch', asyncHandler(fetchInstagram));
router.get('/', asyncHandler(getInstagramProfile));

module.exports = router;
