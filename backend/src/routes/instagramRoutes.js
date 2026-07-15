const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { fetchInstagram, getInstagramProfile, getAuthorityFunnel } = require('../controllers/instagramController');

const router = express.Router();

router.use(protect);
router.post('/fetch', asyncHandler(fetchInstagram));
router.get('/', asyncHandler(getInstagramProfile));
router.get('/authority', asyncHandler(getAuthorityFunnel));

module.exports = router;
