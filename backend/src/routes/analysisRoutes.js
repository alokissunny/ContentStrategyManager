const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const { listReports, getReportDownloadUrl, confirmReport, getLatestBrandDna, updateBrandDna, reviseBrandDna, fillBrandDnaGaps, getBrandDnaRaw } = require('../controllers/analysisController');

const router = express.Router();

router.use(protect);
router.get('/reports', asyncHandler(listReports));
router.get('/reports/latest/brand-dna', asyncHandler(getLatestBrandDna));
router.get('/reports/:id/download', asyncHandler(getReportDownloadUrl));
router.patch('/reports/:id', asyncHandler(confirmReport));
router.get('/reports/:id/brand-dna/raw', asyncHandler(getBrandDnaRaw));
router.patch('/reports/:id/brand-dna', asyncHandler(updateBrandDna));
router.post('/reports/:id/brand-dna/revise', asyncHandler(reviseBrandDna));
router.post('/reports/:id/brand-dna/fill-gaps', asyncHandler(fillBrandDnaGaps));

module.exports = router;
