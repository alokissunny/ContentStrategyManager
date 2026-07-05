const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { register, login, getMe, demoLogin, googleAuth } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/demo-login', asyncHandler(demoLogin));
router.post('/google', asyncHandler(googleAuth));
router.get('/me', protect, asyncHandler(getMe));

module.exports = router;
