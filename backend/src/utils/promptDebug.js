/*
 * Who gets the AI debug panel's rows back (prompts, outputs, tokens, cost). Prompts are internal, so it
 * is admins only — unless AI_DEBUG_ANY_USER=1, for testing flows that run under a brand-new account
 * (the landing page's onboarding signs one up, which is never an admin). Off in production by default.
 * The browser asks with `x-debug-prompts: 1` (frontend api/client.js, Settings › AI debug).
 */
function promptDebugAllowed(user) {
  return Boolean(user) && (user.role === 'admin' || process.env.AI_DEBUG_ANY_USER === '1');
}

function wantsPromptDebug(req) {
  return String(req.get('x-debug-prompts') || '').trim() === '1' && promptDebugAllowed(req.user);
}

module.exports = { wantsPromptDebug, promptDebugAllowed };
