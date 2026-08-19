const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getCurrentRoute,
  getRoutes,
  generateRoute,
  replanWeek,
  markDayPublished,
  polishCaption,
  clearCurrentMonth,
} = require('../controllers/routeController');

const router = express.Router();

router.use(protect);
router.get('/current', asyncHandler(getCurrentRoute));
router.get('/', asyncHandler(getRoutes));
router.post('/generate', asyncHandler(generateRoute));
router.delete('/current-month', asyncHandler(clearCurrentMonth));
router.post('/:id/replan', asyncHandler(replanWeek));
router.post('/:id/day/:index/polish-caption', asyncHandler(polishCaption));
router.patch('/:id/day/:index', asyncHandler(markDayPublished));

module.exports = router;
