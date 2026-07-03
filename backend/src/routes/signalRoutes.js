const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { protect } = require('../middleware/auth');
const {
  getSignals,
  createSignal,
  updateSignal,
  deleteSignal,
} = require('../controllers/signalController');

const router = express.Router();

router.use(protect);
router.route('/').get(asyncHandler(getSignals)).post(asyncHandler(createSignal));
router.route('/:id').put(asyncHandler(updateSignal)).delete(asyncHandler(deleteSignal));

module.exports = router;
