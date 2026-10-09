const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getPosts,
  getPostById,
  getPostOptions,
  getPostDebug,
  generatePlan,
  getPlanRun,
  getActivePlanRun,
  clearUpcoming,
  distributePosts,
  getDistribution,
  setDistribution,
  shiftPosts,
  updatePost,
  focusPostPhotos,
  deletePost,
  polishCaption,
  rerunLayout,
  rerunSlideLayoutVariations,
  applyThemeImage,
  removeTheme,
  getPreTheme,
  mapThemeRegions,
  editThemeRegion,
  refinePost,
  addSlideToPost,
  getPostProject,
  renderCover,
  readCompositionPicture,
} = require('../controllers/postController');

const router = express.Router();

router.use(protect);
router.get('/', asyncHandler(getPosts));
router.post('/generate', asyncHandler(generatePlan));
// Queued generation runs (PLAN_QUEUE) — before '/:id' so "runs" isn't read as a post id.
router.get('/runs/active', asyncHandler(getActivePlanRun));
router.get('/runs/:runId', asyncHandler(getPlanRun));
router.post('/distribute', asyncHandler(distributePosts));
router.get('/distribution', asyncHandler(getDistribution));
router.put('/distribution', asyncHandler(setDistribution));
router.post('/shift', asyncHandler(shiftPosts));
router.post('/composition/read', asyncHandler(readCompositionPicture));
router.delete('/', asyncHandler(clearUpcoming));
router.get('/:id', asyncHandler(getPostById));
router.get('/:id/options', asyncHandler(getPostOptions));
router.get('/:id/debug', asyncHandler(getPostDebug));
router.patch('/:id', asyncHandler(updatePost));
router.delete('/:id', asyncHandler(deletePost));
router.post('/:id/layout', asyncHandler(rerunLayout));
router.post('/:id/slide/:slideIndex/layout-variations', asyncHandler(rerunSlideLayoutVariations));
router.post('/:id/theme-image', asyncHandler(applyThemeImage));
router.post('/:id/remove-theme', asyncHandler(removeTheme));
router.get('/:id/pre-theme', asyncHandler(getPreTheme));
router.post('/:id/slide/:slideIndex/theme-regions', asyncHandler(mapThemeRegions));
router.post('/:id/slide/:slideIndex/theme-region', asyncHandler(editThemeRegion));
router.post('/:id/refine', asyncHandler(refinePost));
router.post('/:id/photo-focus', asyncHandler(focusPostPhotos));
router.post('/:id/slides', asyncHandler(addSlideToPost));
router.get('/:id/project', asyncHandler(getPostProject));
router.post('/:id/cover', asyncHandler(renderCover));
router.post('/:id/polish-caption', asyncHandler(polishCaption));

module.exports = router;
