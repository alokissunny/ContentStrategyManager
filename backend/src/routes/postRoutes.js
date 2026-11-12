const express = require('express');
const { listThemeReferences, deleteThemeReference } = require('../controllers/themeReferenceController');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect, requireAdmin } = require('../middleware/auth');
const { postEditLog } = require('../middleware/postEditLog');
const {
  getPosts,
  getPostById,
  getPostOptions,
  getPostDebug,
  generatePlan,
  getRemixSources,
  getPlanRun,
  getActivePlanRun,
  clearUpcoming,
  distributePosts,
  getDistribution,
  setDistribution,
  shiftPosts,
  updatePost,
  focusPostPhotos,
  markPostSeen,
  deletePost,
  polishCaption,
  rerunLayout,
  rerunStrategy,
  rerunSlideLayoutVariations,
  applyThemeImage,
  getThemeApplyJob,
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
// what the studio changes after generation → backoffice Customers › Activity › Edits
router.use(postEditLog);
router.get('/', asyncHandler(getPosts));
// Choose from library › Your references (uploaded theme references, kept for re-apply)
router.get('/theme-references', asyncHandler(listThemeReferences));
// a background Theme Apply run (POST /:id/theme-image with async: true)
router.get('/theme-jobs/:jobId', asyncHandler(getThemeApplyJob));
router.delete('/theme-references/:refId', asyncHandler(deleteThemeReference));
router.post('/generate', aiLimit('heavy'), asyncHandler(generatePlan));
// Post remix (experimental): the last 10 Instagram posts to build on
router.get('/remix-sources', aiLimit('heavy'), asyncHandler(getRemixSources));
// Queued generation runs (PLAN_QUEUE) — before '/:id' so "runs" isn't read as a post id.
router.get('/runs/active', asyncHandler(getActivePlanRun));
router.get('/runs/:runId', asyncHandler(getPlanRun));
router.post('/distribute', asyncHandler(distributePosts));
router.get('/distribution', asyncHandler(getDistribution));
router.put('/distribution', asyncHandler(setDistribution));
router.post('/shift', asyncHandler(shiftPosts));
router.post('/composition/read', aiLimit('light'), asyncHandler(readCompositionPicture));
// Editor ⋯ › Theme › HTML themes (experimental): the templates, with a sample preview each
router.get('/html-themes', (req, res) => {
  const { htmlThemePreviews, HTML_THEME_FONTS_URL } = require('../services/htmlThemes');
  res.json({ fontsUrl: HTML_THEME_FONTS_URL, themes: htmlThemePreviews() });
});
router.delete('/', asyncHandler(clearUpcoming));
router.get('/:id', asyncHandler(getPostById));
router.get('/:id/options', asyncHandler(getPostOptions));
router.get('/:id/debug', requireAdmin, asyncHandler(getPostDebug));
router.patch('/:id', asyncHandler(updatePost));
router.delete('/:id', asyncHandler(deletePost));
router.post('/:id/layout', aiLimit('heavy'), asyncHandler(rerunLayout));
router.post('/:id/strategy', aiLimit('heavy'), asyncHandler(rerunStrategy));
router.post('/:id/slide/:slideIndex/layout-variations', aiLimit('heavy'), asyncHandler(rerunSlideLayoutVariations));
router.post('/:id/theme-image', aiLimit('heavy'), asyncHandler(applyThemeImage));
router.post('/:id/remove-theme', asyncHandler(removeTheme));
router.get('/:id/pre-theme', asyncHandler(getPreTheme));
router.post('/:id/slide/:slideIndex/theme-regions', aiLimit('heavy'), asyncHandler(mapThemeRegions));
router.post('/:id/slide/:slideIndex/theme-region', aiLimit('heavy'), asyncHandler(editThemeRegion));
router.post('/:id/refine', aiLimit('heavy'), asyncHandler(refinePost));
router.post('/:id/photo-focus', aiLimit('heavy'), asyncHandler(focusPostPhotos));
router.post('/:id/seen', asyncHandler(markPostSeen));
router.post('/:id/slides', aiLimit('heavy'), asyncHandler(addSlideToPost));
router.get('/:id/project', asyncHandler(getPostProject));
router.post('/:id/cover', aiLimit('heavy'), asyncHandler(renderCover));
router.post('/:id/polish-caption', aiLimit('light'), asyncHandler(polishCaption));

module.exports = router;
