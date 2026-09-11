const { getObjectBytes, mediaCdnBaseUrl } = require('../services/s3Client');
const { toVisionImage } = require('../services/visionImage');

// Only ever serve project media: the immutable, content-addressed objects under
// projects/<userId>/<uuid>.<ext>. The pattern also blocks path traversal and any
// attempt to read non-media keys (reports, markdown, etc.).
const PROJECT_KEY_RE = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|hei[cf])$/i;
const LOGO_KEY_RE = /^visualbrand\/[a-f0-9]{24}\/[a-z0-9._-]+\/logos\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif|svg)$/i;
// Rendered video covers (Animated Carousel Cover agent). Streamed as-is, with
// Range support so <video> can play/seek, never run through the vision path.
const VIDEO_KEY_RE = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(mp4|webm|mov)$/i;
const VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

function streamVideo(req, res, buffer, contentType, key) {
  const ext = String(key.split('.').pop() || '').toLowerCase();
  const type = contentType && /^video\//.test(contentType) ? contentType : (VIDEO_MIME[ext] || 'video/mp4');
  const total = buffer.length;
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Accept-Ranges', 'bytes');
  res.type(type);

  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    let start = m[1] === '' ? 0 : parseInt(m[1], 10);
    let end = m[2] === '' ? total - 1 : parseInt(m[2], 10);
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.set('Content-Range', `bytes */${total}`);
      return res.status(416).end();
    }
    end = Math.min(end, total - 1);
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${end}/${total}`);
    res.set('Content-Length', String(end - start + 1));
    return res.end(buffer.subarray(start, end + 1));
  }
  res.set('Content-Length', String(total));
  return res.end(buffer);
}

/*
 * Same-origin media proxy — streams a stored image back through the API with the
 * CORS headers the browser needs to FETCH it (and thus draw it to a canvas).
 *
 * Why this exists: publishing renders each post slide (layout + words + photo) to
 * an image on the client via html-to-image, which must fetch every <img> to
 * inline it. The slide photos are served from the CloudFront CDN, which does NOT
 * send Access-Control-Allow-Origin, so those fetches are CORS-blocked and the
 * render fails. Loading the same bytes through this endpoint (same-origin in dev
 * via the Vite proxy, CORS-allowed in prod via the app's cors() middleware) lets
 * the renderer inline them.
 *
 * Authless by design: the object key is an unguessable capability, exactly like
 * the public CDN URL these same objects already have — so this grants no access
 * the CDN doesn't. The key pattern restricts it to project photos and the
 * studio's own logo files (Library Settings), never reports or other prefixes.
 */
async function proxyMedia(req, res) {
  const key = String(req.query.key || '');
  const isLogo = LOGO_KEY_RE.test(key);
  const isVideo = VIDEO_KEY_RE.test(key);
  if (!PROJECT_KEY_RE.test(key) && !isLogo && !isVideo) {
    return res.status(400).json({ message: 'Invalid media key' });
  }
  try {
    const { buffer, contentType } = await getObjectBytes(key);
    // Video covers stream straight through (with Range) — never vision-processed.
    if (isVideo) {
      return streamVideo(req, res, buffer, contentType, key);
    }
    // Logos are not vision inputs — stream the stored bytes (including SVG)
    // so publish can inline them onto the slide canvas.
    if (isLogo) {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      res.set('Cache-Control', 'private, max-age=300');
      res.type(contentType || (/\.svg$/i.test(key) ? 'image/svg+xml' : 'image/png'));
      return res.send(buffer);
    }
    const vision = await toVisionImage(buffer, contentType, key);
    // Let any origin fetch these bytes — they are already public via the CDN, and
    // the client needs to read them cross-origin to rasterise a post for publish.
    // HEIC is transcoded to JPEG here so Chrome/Firefox can display iPhone photos.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(vision.mediaType);
    return res.send(vision.buffer);
  } catch (err) {
    console.error('[media] proxy failed for', key, err.message);
    return res.status(404).json({ message: 'Media not found' });
  }
}

function cdnBase(req, res) {
  return res.json({ base: mediaCdnBaseUrl() || '' });
}

module.exports = { proxyMedia, cdnBase };
