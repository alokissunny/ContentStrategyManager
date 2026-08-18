const { getObjectBytes, mediaCdnBaseUrl } = require('../services/s3Client');

// Only ever serve project media: the immutable, content-addressed objects under
// projects/<userId>/<uuid>.<ext>. The pattern also blocks path traversal and any
// attempt to read non-media keys (reports, markdown, etc.).
const KEY_RE = /^projects\/[a-f0-9]{24}\/[A-Za-z0-9._-]+\.(png|jpe?g|webp|gif)$/i;

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
 * the CDN doesn't. The key pattern restricts it to project media only.
 */
async function proxyMedia(req, res) {
  const key = String(req.query.key || '');
  if (!KEY_RE.test(key)) {
    return res.status(400).json({ message: 'Invalid media key' });
  }
  try {
    const { buffer, contentType } = await getObjectBytes(key);
    // Let any origin fetch these bytes — they are already public via the CDN, and
    // the client needs to read them cross-origin to rasterise a post for publish.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'private, max-age=300');
    res.type(contentType);
    return res.send(buffer);
  } catch (err) {
    console.error('[media] proxy failed for', key, err.message);
    return res.status(404).json({ message: 'Media not found' });
  }
}

function cdnBase(req, res) {
  return res.json({ base: mediaCdnBaseUrl() || '' });
}

module.exports = { proxyMedia, cdnBase };
