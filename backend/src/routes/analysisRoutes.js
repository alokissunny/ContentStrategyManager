const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const { listReports, getReportDownloadUrl, confirmReport, getLatestBrandDna, updateBrandDna, reviseBrandDna, fillBrandDnaGaps, getBrandDnaRaw, fetchBrandVoice } = require('../controllers/analysisController');

const { rerunAnalysis } = require('../controllers/instagramController');

const router = express.Router();

router.use(protect);
router.get('/reports', asyncHandler(listReports));
router.post('/reports/rerun', aiLimit('heavy'), asyncHandler(rerunAnalysis));
router.get('/reports/latest/brand-dna', asyncHandler(getLatestBrandDna));
router.get('/reports/:id/download', asyncHandler(getReportDownloadUrl));
router.patch('/reports/:id', asyncHandler(confirmReport));
router.get('/reports/:id/brand-dna/raw', asyncHandler(getBrandDnaRaw));
router.patch('/reports/:id/brand-dna', asyncHandler(updateBrandDna));
router.post('/reports/:id/brand-dna/revise', aiLimit('light'), asyncHandler(reviseBrandDna));
router.post('/reports/:id/brand-dna/fill-gaps', aiLimit('light'), asyncHandler(fillBrandDnaGaps));
router.post('/reports/:id/brand-voice', aiLimit('light'), asyncHandler(fetchBrandVoice));

module.exports = router;
