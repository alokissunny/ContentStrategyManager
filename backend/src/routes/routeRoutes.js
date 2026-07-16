const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getCurrentRoute,
  getRoutes,
  generateRoute,
  markDayPublished,
} = require('../controllers/routeController');

const router = express.Router();

router.use(protect);
router.get('/current', asyncHandler(getCurrentRoute));
router.get('/', asyncHandler(getRoutes));
router.post('/generate', asyncHandler(generateRoute));
router.patch('/:id/day/:index', asyncHandler(markDayPublished));

module.exports = router;
