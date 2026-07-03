const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getCurrentRoute,
  getRoutes,
  createRoute,
  updateRoute,
} = require('../controllers/routeController');

const router = express.Router();

router.use(protect);
router.get('/current', asyncHandler(getCurrentRoute));
router.route('/').get(asyncHandler(getRoutes)).post(asyncHandler(createRoute));
router.put('/:id', asyncHandler(updateRoute));

module.exports = router;
