const router = require('express').Router();
const { protect } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { generateCarousel } = require('../services/researchCarousel');
const { loadResearchBrandKit } = require('../services/researchBrandKit');
const active = new Set();
router.use(protect);
router.post('/carousel', asyncHandler(async (req, res) => {
  if (req.get('x-research-enabled') !== '1') return res.status(403).json({ message: 'Enable Research in Experimental features first.' });
  const userId = String(req.user._id);
  if (active.has(userId)) return res.status(429).json({ message: 'A carousel is already generating. Please wait for it to finish.' });
  active.add(userId);
  const agents = [];
  const debugEnabled = req.get('x-debug-prompts') === '1';
  const debug = () => debugEnabled ? { debug: { agents } } : {};
  try {
    const brandKit = await loadResearchBrandKit(userId, req.body?.brandFonts);
    const result = await generateCarousel(req.body, userId, { brandKit, onAiCall: debugEnabled ? entry => agents.push(entry) : undefined });
    res.json({ ...result, ...debug() });
  }
  catch (error) {
    console.error('[research]', error.message);
    res.status(error.statusCode || 502).json({ ...debug(), message: error.statusCode ? error.message : 'Carousel generation or validation failed. Please try again with a more specific topic.' });
  } finally { active.delete(userId); }
}));
module.exports = router;
