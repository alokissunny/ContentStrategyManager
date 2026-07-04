const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { listReports, getReportDownloadUrl, confirmReport } = require('../controllers/analysisController');

const router = express.Router();

router.use(protect);
router.get('/reports', asyncHandler(listReports));
router.get('/reports/:id/download', asyncHandler(getReportDownloadUrl));
router.patch('/reports/:id', asyncHandler(confirmReport));

module.exports = router;
