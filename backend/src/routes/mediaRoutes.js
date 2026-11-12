const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { proxyMedia, cdnBase, displayMedia, videoMedia } = require('../controllers/mediaController');

// Authless, capability-scoped media proxy (see mediaController for the rationale).
// No `protect` here: the browser's image fetch during publish can't carry the
// bearer token, and the object key already gates access.
const router = express.Router();

router.get('/proxy', asyncHandler(proxyMedia));
router.get('/display', asyncHandler(displayMedia));
router.get('/video', asyncHandler(videoMedia));
router.get('/cdn-base', asyncHandler(cdnBase));

module.exports = router;
