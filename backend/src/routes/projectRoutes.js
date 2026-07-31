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
} = require('../controllers/projectController');

const router = express.Router();

router.use(protect);

router.post('/uploads/sign', asyncHandler(signUploads));

router.get('/', asyncHandler(listProjects));
router.post('/', asyncHandler(createProject));
router.patch('/:id', asyncHandler(renameProject));
router.delete('/:id', asyncHandler(deleteProject));

router.post('/:id/captures', asyncHandler(addCapture));
router.patch('/:id/captures/:captureId', asyncHandler(updateCapture));
router.delete('/:id/captures/:captureId', asyncHandler(deleteCapture));
router.post('/:id/captures/:captureId/move', asyncHandler(moveCapture));

module.exports = router;
