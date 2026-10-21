const express = require('express');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const canva = require('../services/canvaMcp');
const { allowedOrigins } = require('../config/origins');

// Settings › Experimental features › Design in Canva: link the studio's own
// Canva account (OAuth against Canva's MCP server). The browser comes back to
// the studio's /dashboard/canva/callback page, which posts code + state here.
const router = express.Router();
router.use(protect);
const withErrors = (fn) => asyncHandler(async (req, res) => {
  try { await fn(req, res); }
  catch (err) {
    if (!err.status) console.error('[canva]', err.message);
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Could not complete the Canva request.', code: err.code || 'CANVA_ERROR' });
  }
});
// only this app's own callback page, on the origin the studio is using
function redirectUriOf(req) {
  const raw = String(req.body?.redirectUri || '');
  let url;
  try { url = new URL(raw); } catch { throw canva.error(400, 'Invalid Canva redirect.'); }
  const local = process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  if (url.pathname !== '/dashboard/canva/callback' || (!local && !allowedOrigins().has(url.origin))) {
    throw canva.error(400, 'Invalid Canva redirect.');
  }
  return `${url.origin}${url.pathname}`;
}

router.get('/status', withErrors(async (req, res) => res.json(await canva.status(req.user._id))));
router.post('/connect', withErrors(async (req, res) => res.json(await canva.startConnect(req.user._id, redirectUriOf(req)))));
router.post('/callback', withErrors(async (req, res) => res.json(await canva.finishConnect(req.user._id, req.body?.code, req.body?.state))));
router.delete('/connection', withErrors(async (req, res) => res.json(await canva.disconnect(req.user._id))));

module.exports = router;
