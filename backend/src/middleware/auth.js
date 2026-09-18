const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { createTtlCache } = require('../utils/ttlCache');

// Auth user docs change rarely on the request path; a short TTL skips one Atlas
// round-trip (~1–2s on M0) for every protected API call.
const userCache = createTtlCache({ ttlMs: 30_000, max: 200 });

// Keep protect payloads light — logos / mood / generated images are loaded by
// their own endpoints. Shipping them on every request just slows Atlas reads.
const AUTH_SELECT = 'name email avatar role business authProvider googleId createdAt updatedAt';

function invalidateUserCache(userId) {
  if (userId != null) userCache.del(userId);
}

async function protect(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const id = String(decoded.id || '');
    if (!id) return res.status(401).json({ message: 'Not authorized, token failed' });

    const cached = userCache.get(id);
    if (cached) {
      req.user = cached;
      return next();
    }

    const user = await User.findById(id).select(AUTH_SELECT);
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }
    userCache.set(id, user);
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
}

module.exports = { protect, invalidateUserCache };
