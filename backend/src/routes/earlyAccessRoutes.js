const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { createRequest } = require('../controllers/earlyAccessController');

const router = express.Router();

router.post('/', asyncHandler(createRequest));

module.exports = router;
