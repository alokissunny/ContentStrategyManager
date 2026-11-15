const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { createRequest, joinWaitlist, checkInvite } = require('../controllers/earlyAccessController');
const { incr } = require('../middleware/aiRateLimit');

const router = express.Router();

router.post('/', asyncHandler(createRequest));

/* both are reachable with no account, so each is held per address: a 4-character code must not be
   guessable by trying them all, and the waitlist must not be filled by a script */
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || 'unknown';
}
function perIp(name, windowMs, max, message) {
  return (req, res, next) => {
    const slot = Math.floor(Date.now() / windowMs);
    incr(`${name}:ip:${clientIp(req)}:${slot}`, windowMs).then(({ count }) => {
      if (count > max) return res.status(429).json({ message, reason: 'limited' });
      return next();
    }).catch(next);
  };
}
const HOUR = 3_600_000;
const DAY = 86_400_000;

// POST /api/early-access/invite/check { code } → { ok } | { ok:false, reason: invalid|redeemed }
router.post('/invite/check', perIp('invitecheck', HOUR, 20, 'Too many tries. Try again in an hour.'), asyncHandler(checkInvite));
// POST /api/early-access/waitlist { email, source } → { ok, already }
router.post('/waitlist', perIp('waitlist', DAY, 10, 'Too many requests today. Try again tomorrow.'), asyncHandler(joinWaitlist));

module.exports = router;
