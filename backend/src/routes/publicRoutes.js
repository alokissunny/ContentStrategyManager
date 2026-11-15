const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { incr } = require('../middleware/aiRateLimit');
const { startVisitorRead } = require('../services/visitorInstagram');
const { transcribeAudio } = require('../services/transcribeAudio');

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

/* ── A VISITOR'S VOICE NOTE (landing Capture's mic, before sign-up) ── the same transcriber the signed-in
   `/projects/captures/transcribe` uses, held to its own per-address and daily caps, a smaller body and no
   debug payload. Nothing is stored: the words come back and the audio is dropped. */
const VOICE_MAX_BYTES = 8 * 1024 * 1024;
function voiceLimit(req, res, next) {
  const ip = clientIp(req);
  const slot = Math.floor(Date.now() / DAY);
  Promise.all([
    incr(`visitorvoice:ip:${ip}:${slot}`, DAY),
    incr(`visitorvoice:all:${slot}`, DAY),
  ]).then(([mine, all]) => {
    if (mine.count > envInt('VISITOR_VOICE_PER_IP_PER_DAY', 15) || all.count > envInt('VISITOR_VOICE_PER_DAY', 1000)) {
      return res.status(429).json({ message: 'Too many voice notes today. Type it in instead.' });
    }
    return next();
  }).catch(next);
}
function headerText(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '';
  try { return decodeURIComponent(String(raw)).trim(); } catch { return String(raw).trim(); }
}
function headerList(value) {
  return headerText(value).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

// POST /api/public/transcribe  (raw audio body) → { text }
router.post(
  '/transcribe',
  express.raw({ type: () => true, limit: VOICE_MAX_BYTES }),
  voiceLimit,
  asyncHandler(async (req, res) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    if (!buffer.length) return res.status(400).json({ message: 'No audio to transcribe' });
    const type = String(req.headers['content-type'] || '');
    if (!/^(audio|video)\//.test(type)) return res.status(415).json({ message: 'Send audio' });
    try {
      const result = await transcribeAudio(buffer, type, {
        hint: headerText(req.headers['x-transcript-hint']).slice(0, 1500),
        keywords: [],
        languages: headerList(req.headers['x-transcript-languages']),
      });
      res.json({ text: result?.text || '' });
    } catch (err) {
      res.status(err.statusCode || 500).json({ message: 'Transcription failed' });
    }
  }),
);

module.exports = router;
