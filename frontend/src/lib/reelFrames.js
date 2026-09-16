/*
 * Sample a few frames from a local clip (blob objectURL) via canvas, so the
 * Reel editor's vision agent can SEE the video and anchor pointers to what's on
 * screen — without any server-side ffmpeg step. Blob URLs are same-origin, so
 * the canvas is never tainted and toDataURL works.
 *
 * We also DERIVE the accent colour from the clip's own pixels (the dominant
 * vibrant hue). Nothing about the look is hardcoded — if the clip has no strong
 * colour, no accent is returned and the overlay stays neutral.
 */

function seekTo(video, t) {
  return new Promise((resolve) => {
    const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
    video.addEventListener('seeked', onSeeked);
    // Clamp just inside the end — seeking exactly to duration can never fire.
    video.currentTime = Math.max(0, Math.min(t, (video.duration || t) - 0.05));
  });
}

function rgbToHsl(r, g, b) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function toHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

// Dominant vibrant colour across the sampled frames — a 12-bucket hue histogram
// of pixels that are colourful enough (not near-grey, not too dark/bright).
function makeAccentPicker() {
  const buckets = Array.from({ length: 12 }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  let considered = 0;
  let scanned = 0;
  return {
    add(data) {
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
        scanned += 1;
        const [h, s, l] = rgbToHsl(r, g, b);
        if (s < 0.35 || l < 0.22 || l > 0.72) continue;
        const bkt = buckets[Math.min(11, Math.floor(h / 30))];
        bkt.n += 1; bkt.r += r; bkt.g += g; bkt.b += b;
        considered += 1;
      }
    },
    pick() {
      if (!scanned) return '';
      let best = null;
      for (const bkt of buckets) if (!best || bkt.n > best.n) best = bkt;
      // Need a real colour presence, not a stray few pixels.
      if (!best || best.n < 40 || best.n / scanned < 0.03) return '';
      return toHex(best.r / best.n, best.g / best.n, best.b / best.n);
    },
  };
}

/**
 * @returns Promise<{ frames: [{ t, mediaType, data }], accentColor: string }>
 * `data` is base64 JPEG (no prefix). Resolves to empty on any failure.
 */
export async function sampleVideoFrames(url, { count = 5, maxDim = 512, quality = 0.6 } = {}) {
  if (!url) return { frames: [], accentColor: '' };
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('Could not read the clip for frame sampling.'));
      setTimeout(() => reject(new Error('Frame sampling timed out.')), 15000);
    });

    const dur = video.duration || 0;
    const vw = video.videoWidth || 0;
    const vh = video.videoHeight || 0;
    if (!dur || !vw || !vh) return { frames: [], accentColor: '' };

    const scale = Math.min(1, maxDim / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vw * scale));
    canvas.height = Math.max(1, Math.round(vh * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Tiny canvas just for accent sampling — cheap to read pixels from.
    const accW = 64;
    const accH = Math.max(1, Math.round((vh / vw) * accW));
    const accCanvas = document.createElement('canvas');
    accCanvas.width = accW; accCanvas.height = accH;
    const accCtx = accCanvas.getContext('2d', { willReadFrequently: true });
    const accent = makeAccentPicker();

    const frames = [];
    for (let i = 0; i < count; i += 1) {
      const t = dur * ((i + 0.5) / count); // evenly spread, avoiding the very edges
      // eslint-disable-next-line no-await-in-loop
      await seekTo(video, t);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const data = dataUrl.split(',')[1];
      if (data) frames.push({ t: Math.round(t * 100) / 100, mediaType: 'image/jpeg', data });
      try {
        accCtx.drawImage(video, 0, 0, accW, accH);
        accent.add(accCtx.getImageData(0, 0, accW, accH).data);
      } catch { /* accent is best-effort */ }
    }
    return { frames, accentColor: accent.pick() };
  } catch {
    return { frames: [], accentColor: '' };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
