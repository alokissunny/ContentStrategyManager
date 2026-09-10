const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { publishDueHandler } = require('../services/schedulePublish');

const router = express.Router();

// Daily cron: publish due scheduled posts. Auth is SCHEDULE_CRON_SECRET, not a user JWT.
router.post('/publish-due', asyncHandler(publishDueHandler));

module.exports = router;
