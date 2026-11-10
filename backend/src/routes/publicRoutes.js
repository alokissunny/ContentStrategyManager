const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { incr } = require('../middleware/aiRateLimit');
const { startVisitorRead } = require('../services/visitorInstagram');

/*
 * Routes a landing visitor reaches before they have an account. Each one costs money (an Apify
 * scrape and a model call), so each is held to a few per address per day and a daily total.
 */
const router = express.Router();

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}
const DAY = 86_400_000;
function visitorLimit(req, res, next) {
  const ip = clientIp(req);
  const slot = Math.floor(Date.now() / DAY);
  Promise.all([
    incr(`visitorig:ip:${ip}:${slot}`, DAY),
    incr(`visitorig:all:${slot}`, DAY),
  ]).then(([mine, all]) => {
    if (mine.count > envInt('VISITOR_IG_PER_IP_PER_DAY', 5) || all.count > envInt('VISITOR_IG_PER_DAY', 300)) {
      return res.status(429).json({ message: 'Too many profiles read today. Try again tomorrow.' });
    }
    req.visitorIp = ip;
    return next();
  }).catch(next);
}

// POST /api/public/instagram-read { handle } → { token }
router.post('/instagram-read', visitorLimit, asyncHandler(async (req, res) => {
  try {
    const out = await startVisitorRead(req.body?.handle, req.visitorIp);
    res.status(202).json({ token: out.token, handle: out.handle });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Could not start reading that profile.' });
  }
}));

module.exports = router;
