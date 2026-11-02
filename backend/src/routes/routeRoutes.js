const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect, requireAdmin } = require('../middleware/auth');
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
router.get('/:id/day/:index/debug', requireAdmin, asyncHandler(getDayDebug));
router.post('/generate', aiLimit('heavy'), asyncHandler(generateRoute));
router.delete('/current-month', asyncHandler(clearCurrentMonth));
router.post('/:id/replan', aiLimit('heavy'), asyncHandler(replanWeek));
router.post('/:id/day/:index/layout', aiLimit('heavy'), asyncHandler(rerunDayLayout));
router.post('/:id/day/:index/slide/:slideIndex/layout-variations', aiLimit('heavy'), asyncHandler(rerunSlideLayoutVariations));
router.post('/:id/day/:index/cover', aiLimit('heavy'), asyncHandler(renderDayCover));
router.post('/:id/day/:index/polish-caption', aiLimit('light'), asyncHandler(polishCaption));
router.patch('/:id/day/:index', asyncHandler(markDayPublished));

module.exports = router;
