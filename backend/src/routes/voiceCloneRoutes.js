const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { aiLimit } = require('../middleware/aiRateLimit');
const { protect } = require('../middleware/auth');
const vc = require('../services/voiceClone');
const { wantsPromptDebug } = require('../utils/promptDebug');

// Capture › Reel › voiceover › "Use my cloned voice" (ElevenLabs)
const router = express.Router();
router.use(protect);

// the AI debug panel's rows (ElevenLabs credits, the voice director's tokens) only when asked
const handle = (fn) => asyncHandler(async (req, res) => {
  try {
    const out = await fn(req);
    res.json(out && out.debug && !wantsPromptDebug(req) ? { ...out, debug: undefined } : out);
  } catch (err) {
    if (err instanceof vc.VoiceCloneError) return res.status(err.status).json({ message: err.message });
    throw err;
  }
});

router.get('/', handle((req) => vc.status(req.user._id)));
const cloneArgs = (req, profileId = '') => ({
  keys: req.body?.keys, consent: req.body?.consent === true, name: req.body?.name, note: req.body?.note, profileId,
});
router.post('/', aiLimit('heavy'), handle((req) => vc.cloneVoice(req.user._id, cloneArgs(req))));
router.post('/speak', aiLimit('light'), handle((req) => vc.speak(req.user._id, {
  text: req.body?.text, part: req.body?.part, script: req.body?.script, prevText: req.body?.prevText, nextText: req.body?.nextText,
  profileId: typeof req.body?.profileId === 'string' ? req.body.profileId : '',
})));
// a profile: re-record (clone again), rename / describe / make default, hear it, delete
router.post('/:id/clone', aiLimit('heavy'), handle((req) => vc.cloneVoice(req.user._id, cloneArgs(req, req.params.id))));
router.patch('/:id', handle((req) => vc.updateProfile(req.user._id, req.params.id, {
  name: req.body?.name, note: req.body?.note, isDefault: req.body?.isDefault === true,
})));
router.post('/:id/preview', aiLimit('light'), handle((req) => vc.preview(req.user._id, req.params.id)));
router.delete('/:id', handle((req) => vc.removeProfile(req.user._id, req.params.id)));
module.exports = router;
