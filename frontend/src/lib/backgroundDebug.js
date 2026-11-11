/*
 * AI calls the backend ran in the background (onboarding's Instagram analysis when it finished after
 * sign-up, the background Brand Voice read): no request was waiting to carry their debug rows, so the
 * backend keeps them (models/AiDebugCall.js) and this fetches them into the AI debug panel while it is on.
 */
import client from '../api/client';
import { ingestPlanDebug } from '../api/posts';
import { isAiDebugEnabled } from './aiDebug';

const AFTER_KEY = 'bauhly.debugBackgroundAfter';
const POLL_MS = 10000;

function readAfter() {
  try { return localStorage.getItem(AFTER_KEY) || ''; } catch { return ''; }
}
function writeAfter(at) {
  try { localStorage.setItem(AFTER_KEY, at); } catch { /* the in-memory value holds */ }
}

let after = readAfter() || new Date(Date.now() - 60 * 60 * 1000).toISOString();
let busy = false;

export async function pullBackgroundDebug() {
  if (busy || !isAiDebugEnabled()) return;
  busy = true;
  try {
    const { data } = await client.get('/debug/background', { params: { after } });
    (data?.calls || []).forEach((call) => {
      ingestPlanDebug(call.label || 'Background AI call', { debug: call.debug });
      if (call.at && call.at > after) after = call.at;
    });
    writeAfter(after);
  } catch {
    /* logged out, offline, or an older backend: the panel just has nothing new */
  } finally {
    busy = false;
  }
}

/* polls while the tab is visible; returns the way to stop */
export function watchBackgroundDebug() {
  pullBackgroundDebug();
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') pullBackgroundDebug();
  }, POLL_MS);
  return () => clearInterval(timer);
}
