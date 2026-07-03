const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { register, login, getMe, demoLogin } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/demo-login', asyncHandler(demoLogin));
router.get('/me', protect, asyncHandler(getMe));

module.exports = router;
