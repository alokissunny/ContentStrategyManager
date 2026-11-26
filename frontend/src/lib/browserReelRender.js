/*
 * Rendering a capture reel's MP4 in this browser (@remotion/web-renderer).
 *
 * The server does every AI step; when the cut is ready and a capable studio is
 * watching, the worker offers the render here (backend
 * services/browserReelRender.js). A desktop browser renders the same
 * composition ~10x faster than the reel worker. The server stays the fallback:
 * a phone, a hidden tab, a failure or a closed studio hands it back.
 *
 * Off switch for this device: localStorage 'bauhly.browserRender' = 'off'.
 */
import { claimBrowserRender, browserRenderProgress, browserRenderDone, browserRenderFail } from '../api/captureReels';

const CDN_HOST = 'd35l1g85oy1mmk.cloudfront.net';

/* ── can this device render reels? (asked once per page load) ── */
let capable = null;
export function browserCanRenderReels() {
  if (capable) return capable;
  capable = (async () => {
    try {
      if (localStorage.getItem('bauhly.browserRender') === 'off') return false;
    } catch { /* private mode */ }
    if (typeof window === 'undefined' || typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return false;
    const ua = navigator.userAgent || '';
    const phone = navigator.userAgentData?.mobile || /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || window.Capacitor?.isNativePlatform?.();
    if (phone) return false;
    if ((navigator.hardwareConcurrency || 0) < 4) return false;
    if (navigator.deviceMemory && navigator.deviceMemory < 4) return false;
    try {
      const { canRenderMediaOnWeb } = await import('@remotion/web-renderer');
      const can = await canRenderMediaOnWeb({ width: 1080, height: 1920, container: 'mp4', videoCodec: 'h264' });
      return Boolean(can?.canRender);
    } catch {
      return false;
    }
  })();
  return capable;
}

// dev: CloudFront media through the dev server (same origin) — the CDN sends
// no CORS headers yet, and the renderer must read pixels and samples
function viaDevProxy(timeline) {
  if (!import.meta.env.DEV) return timeline;
  return JSON.parse(JSON.stringify(timeline).split(`https://${CDN_HOST}/`).join('/__cdn/'));
}

// Every video/audio URL must be readable cross-origin, or the render stalls
// for a minute and fails. Checked up front (one tiny range request each).
async function mediaReadable(timeline) {
  const urls = [...new Set((JSON.stringify(timeline).match(/(https?:\/\/|\/__cdn\/)[^"]+?\.(mp4|mov|m4v|webm|mp3|m4a|wav|aac)(\?[^"]*)?(?=")/gi) || []))];
  const results = await Promise.all(urls.slice(0, 40).map((u) => fetch(u, { headers: { Range: 'bytes=0-1' }, mode: 'cors', cache: 'no-store' })
    .then((r) => r.ok || r.status === 206)
    .catch(() => false)));
  return results.every(Boolean);
}

/* ── one render at a time in this tab ── */
let running = null; // { reelId, abort }
export const browserRenderRunning = () => running?.reelId || '';

/**
 * Claim and render one offered reel. Resolves when it is uploaded (or handed
 * back). onState({ phase: 'checking'|'rendering'|'uploading'|'done'|'handed-back', pct, reason })
 */
export async function renderOfferedReel(reelId, { onState = () => {} } = {}) {
  if (running) return false;
  const controller = new AbortController();
  running = { reelId, abort: (why) => controller.abort(new Error(why || 'stopped')) };
  const giveBack = async (reason) => {
    onState({ phase: 'handed-back', reason });
    await browserRenderFail(reelId, reason).catch(() => {});
  };
  // a hidden tab stops drawing frames (requestAnimationFrame) — hand it back
  const onHidden = () => { if (document.visibilityState === 'hidden') running?.abort('the tab was hidden'); };
  document.addEventListener('visibilitychange', onHidden);
  let claimed = null;
  try {
    onState({ phase: 'checking', pct: 0 });
    claimed = await claimBrowserRender(reelId).catch(() => null);
    if (!claimed) return false; // someone else took it, or the server already moved on
    const timeline = viaDevProxy(claimed.timeline);
    if (!(await mediaReadable(timeline))) {
      await giveBack('media not readable from this browser (CDN CORS)');
      return false;
    }
    const [{ renderMediaOnWeb }, { CaptureReel }] = await Promise.all([
      import('@remotion/web-renderer'),
      import('@reel/CaptureReel'),
    ]);
    const f = timeline.format;
    let lastSent = 0;
    let lastPct = 0;
    let stopFromServer = false;
    const t0 = performance.now();
    onState({ phase: 'rendering', pct: 0 });
    const beat = async (pct) => {
      try {
        await browserRenderProgress(reelId, pct);
      } catch (e) {
        if (e?.response?.status === 409) { stopFromServer = true; running?.abort('the server took it back'); }
      }
    };
    // heartbeat even while a slow frame holds the progress still
    const heartbeat = setInterval(() => beat(lastPct), 5000);
    let result;
    // the browser mix is +3 dB over the server's — lib/reelWebMedia.js scales it back
    window.__reelRenderGain = Math.SQRT1_2;
    try {
      result = await renderMediaOnWeb({
        composition: { component: CaptureReel, id: 'CaptureReel', width: f.width, height: f.height, fps: f.fps, durationInFrames: f.durationInFrames },
        inputProps: { reel: timeline },
        container: 'mp4',
        videoCodec: 'h264',
        // ~ the server render's size (CRF 21 ≈ 3–6 Mbps for these reels)
        videoBitrate: 6_000_000,
        audioBitrate: 'high',
        hardwareAcceleration: 'prefer-hardware',
        delayRenderTimeoutInMilliseconds: 30000,
        signal: controller.signal,
        logLevel: 'error',
        onProgress: (p) => {
          const pct = Math.min(99, Math.round(p.progress * 100));
          lastPct = pct;
          onState({ phase: 'rendering', pct });
          if (Date.now() - lastSent > 2000) { lastSent = Date.now(); beat(pct); }
        },
      });
    } finally {
      clearInterval(heartbeat);
      window.__reelRenderGain = 1;
    }
    if (stopFromServer) return false;
    const blob = await result.getBlob();
    const renderSec = (performance.now() - t0) / 1000;
    onState({ phase: 'uploading', pct: 100 });
    await beat(100);
    const put = await fetch(claimed.uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'video/mp4', 'Cache-Control': claimed.cacheControl },
    });
    if (!put.ok) throw new Error(`upload failed (${put.status})`);
    await browserRenderDone(reelId, renderSec);
    onState({ phase: 'done', pct: 100 });
    return true;
  } catch (err) {
    if (claimed) await giveBack(String(err?.message || err).slice(0, 280));
    return false;
  } finally {
    document.removeEventListener('visibilitychange', onHidden);
    running = null;
  }
}

/** Stop the render in this tab (the studio closed): the server takes over. */
export function stopBrowserRender(reelId, why = 'the studio was closed') {
  if (running && (!reelId || running.reelId === reelId)) running.abort(why);
}
