const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { signUpload, editReel } = require('../controllers/reelController');

// Experimental Reel Editor. The clip uploads straight to S3 via a presigned PUT
// (browser → S3, never through this server); /edit reads the stored bytes and
// runs the multi-agent pipeline.
const router = express.Router();

router.use(protect);

router.post('/uploads/sign', asyncHandler(signUpload));
router.post('/edit', asyncHandler(editReel));

module.exports = router;
