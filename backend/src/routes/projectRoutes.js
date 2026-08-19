const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  signUploads,
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  addCapture,
  updateCapture,
  deleteCapture,
  moveCapture,
  analyzeAsset,
  analyzeProject,
  understandDraft,
  understandCheckinDraft,
  transcribeDraft,
} = require('../controllers/projectController');

const router = express.Router();

router.use(protect);

router.post('/uploads/sign', asyncHandler(signUploads));

// Capture-time intelligence — before `/:id` so "captures" is not a project id.
router.post('/captures/understand', asyncHandler(understandDraft));
router.post('/checkin/understand', asyncHandler(understandCheckinDraft));
router.post(
  '/captures/transcribe',
  express.raw({ type: () => true, limit: '12mb' }),
  asyncHandler(transcribeDraft)
);

router.get('/', asyncHandler(listProjects));
router.post('/', asyncHandler(createProject));
router.patch('/:id', asyncHandler(renameProject));
router.delete('/:id', asyncHandler(deleteProject));

router.post('/:id/captures', asyncHandler(addCapture));
router.patch('/:id/captures/:captureId', asyncHandler(updateCapture));
router.delete('/:id/captures/:captureId', asyncHandler(deleteCapture));
router.post('/:id/captures/:captureId/move', asyncHandler(moveCapture));

// AI analysis — one asset, or every image asset in the project.
router.post('/:id/analyze', asyncHandler(analyzeProject));
router.post('/:id/captures/:captureId/attachments/:attachmentId/analyze', asyncHandler(analyzeAsset));

module.exports = router;
