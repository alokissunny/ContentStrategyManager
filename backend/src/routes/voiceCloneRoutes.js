const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const vc = require('../services/voiceClone');

// Capture › Reel › voiceover › "Use my cloned voice" (ElevenLabs)
const router = express.Router();
router.use(protect);

const handle = (fn) => asyncHandler(async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    if (err instanceof vc.VoiceCloneError) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

router.get('/', handle((req) => vc.status(req.user._id)));
router.post('/', aiLimit('heavy'), handle((req) => vc.cloneVoice(req.user._id, { keys: req.body?.keys, consent: req.body?.consent === true })));
router.post('/speak', aiLimit('light'), handle((req) => vc.speak(req.user._id, { text: req.body?.text, part: req.body?.part, script: req.body?.script, prevText: req.body?.prevText, nextText: req.body?.nextText })));
router.delete('/', handle((req) => vc.removeVoice(req.user._id)));
module.exports = router;
