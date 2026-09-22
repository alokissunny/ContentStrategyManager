const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { signUpload, assembleReel, editReel } = require('../controllers/reelController');

// Experimental Reel Editor. The clip uploads straight to S3 via a presigned PUT
// (browser → S3, never through this server); /edit reads the stored bytes and
// runs the multi-agent pipeline.
const router = express.Router();

router.use(protect);

router.post('/uploads/sign', asyncHandler(signUpload));
router.post('/assemble', asyncHandler(assembleReel));
router.post('/edit', asyncHandler(editReel));
router.post('/prompt-edit', asyncHandler(async (req, res) => {
  try {
    res.json(await require('../services/reelPromptEdit').promptEdit(req.body || {}));
  } catch (error) {
    res.status(error.statusCode === 400 ? 400 : 502).json({ message: error.statusCode === 400 ? error.message : 'Could not apply this edit. Your reel is unchanged. Try again.' });
  }
}));

module.exports = router;
