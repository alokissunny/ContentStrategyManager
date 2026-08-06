/*
 * Cache an Instagram / Graph profile picture into our S3 bucket so the header
 * avatar doesn't break when Meta's signed CDN URL expires (often within hours).
 */

const { isS3Configured, uploadBytes } = require('./s3Client');

function extFromContentType(ct) {
  const t = String(ct || '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  return 'jpg';
}

/**
 * Download `url` and store under profiles/<userId>/<username>.<ext>.
 * Returns the S3 key, or '' on failure / when S3 isn't configured.
 */
async function cacheProfilePicture(userId, username, url) {
  if (!url || !userId || !username || !isS3Configured()) return '';
  try {
    const res = await fetch(url, {
      headers: {
        // Instagram CDNs often reject requests that look like hotlinks.
        'User-Agent': 'Bauhly/1.0 (+https://bauhly.com)',
        Accept: 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      console.warn(`[avatar] download failed for @${username}: HTTP ${res.status}`);
      return '';
    }
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      console.warn(`[avatar] unexpected content-type for @${username}: ${contentType}`);
      return '';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return '';
    const ext = extFromContentType(contentType);
    const key = `profiles/${userId}/${String(username).toLowerCase()}.${ext}`;
    await uploadBytes(key, buf, contentType.split(';')[0].trim());
    console.log(`[avatar] cached @${username} → ${key} (${buf.length} bytes)`);
    return key;
  } catch (err) {
    console.warn(`[avatar] could not cache @${username}:`, err.message);
    return '';
  }
}

module.exports = { cacheProfilePicture };
