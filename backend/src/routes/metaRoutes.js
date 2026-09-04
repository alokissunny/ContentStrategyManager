const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getStatus,
  startConnect,
  completeConnect,
  disconnect,
  publishDay,
} = require('../services/metaPublish');

const router = express.Router();

router.use(protect);

router.get('/status', asyncHandler(getStatus));
router.post('/connect', asyncHandler(startConnect));
router.post('/connect/complete', asyncHandler(completeConnect));
// Per-account disconnect: DELETE /connect/:igUserId
router.delete('/connect/:igUserId', asyncHandler(disconnect));
// Legacy: disconnect every Meta connection for this user
router.delete('/connect', asyncHandler(disconnect));

// Publish a planned day to Instagram (requires Meta connection).
router.post('/publish/:id/day/:index', asyncHandler(publishDay));

module.exports = router;
