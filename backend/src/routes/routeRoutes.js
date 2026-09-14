const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getCurrentRoute,
  getRoutes,
  getRouteById,
  getRouteOptions,
  getDayDebug,
  generateRoute,
  replanWeek,
  markDayPublished,
  polishCaption,
  rerunDayLayout,
  rerunSlideLayoutVariations,
  renderDayCover,
  clearCurrentMonth,
} = require('../controllers/routeController');

const router = express.Router();

router.use(protect);
router.get('/current', asyncHandler(getCurrentRoute));
router.get('/', asyncHandler(getRoutes));
router.get('/:id', asyncHandler(getRouteById));
router.get('/:id/options', asyncHandler(getRouteOptions));
router.get('/:id/day/:index/debug', asyncHandler(getDayDebug));
router.post('/generate', asyncHandler(generateRoute));
router.delete('/current-month', asyncHandler(clearCurrentMonth));
router.post('/:id/replan', asyncHandler(replanWeek));
router.post('/:id/day/:index/layout', asyncHandler(rerunDayLayout));
router.post('/:id/day/:index/slide/:slideIndex/layout-variations', asyncHandler(rerunSlideLayoutVariations));
router.post('/:id/day/:index/cover', asyncHandler(renderDayCover));
router.post('/:id/day/:index/polish-caption', asyncHandler(polishCaption));
router.patch('/:id/day/:index', asyncHandler(markDayPublished));

module.exports = router;
