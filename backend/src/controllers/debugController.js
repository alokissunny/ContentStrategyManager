const { rerunPrompt } = require('../services/promptRerun');

// POST /api/debug/rerun-prompt
// Body: { model, systemPrompt?, prompt } → { output, model }
async function rerunDebugPrompt(req, res) {
  const prompt = String(req.body?.prompt || '');
  if (!prompt.trim()) {
    return res.status(400).json({ message: 'Input is required.' });
  }
  try {
    const result = await rerunPrompt({
      model: req.body?.model,
      systemPrompt: req.body?.systemPrompt,
      prompt,
    });
    if (!String(result.output || '').trim()) {
      return res.status(502).json({ message: 'Nothing came back — try adjusting the input.' });
    }
    return res.json(result);
  } catch (err) {
    const status = err.statusCode || err.status || 502;
    console.error('[debug] prompt rerun failed:', err.message);
    return res.status(status).json({ message: err.message || 'Could not rerun the prompt.' });
  }
}

module.exports = { rerunDebugPrompt };
