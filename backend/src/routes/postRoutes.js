const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getPosts,
  getPostById,
  getPostOptions,
  getPostDebug,
  generatePlan,
  clearUpcoming,
  distributePosts,
  updatePost,
  polishCaption,
  rerunLayout,
  rerunSlideLayoutVariations,
  renderCover,
} = require('../controllers/postController');

const router = express.Router();

router.use(protect);
router.get('/', asyncHandler(getPosts));
router.post('/generate', asyncHandler(generatePlan));
router.post('/distribute', asyncHandler(distributePosts));
router.delete('/', asyncHandler(clearUpcoming));
router.get('/:id', asyncHandler(getPostById));
router.get('/:id/options', asyncHandler(getPostOptions));
router.get('/:id/debug', asyncHandler(getPostDebug));
router.patch('/:id', asyncHandler(updatePost));
router.post('/:id/layout', asyncHandler(rerunLayout));
router.post('/:id/slide/:slideIndex/layout-variations', asyncHandler(rerunSlideLayoutVariations));
router.post('/:id/cover', asyncHandler(renderCover));
router.post('/:id/polish-caption', asyncHandler(polishCaption));

module.exports = router;
