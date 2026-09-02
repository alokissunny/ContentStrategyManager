/*
 * Prepare a stored image for a vision model. Claude accepts JPEG, PNG, GIF,
 * and WebP — iPhone captures are often HEIC, so those are converted to JPEG.
 */

const heicConvert = require('heic-convert');

const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const HEIC_BRANDS = /heic|heix|heif|heis|heim|mif1|msf1/;

function header(buffer, start, length) {
  if (!buffer || buffer.length < start + length) return '';
  return Buffer.from(buffer).slice(start, start + length).toString('ascii');
}

function isJpeg(buffer) {
  return Boolean(buffer && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff);
}

function isPng(buffer) {
  return Boolean(buffer && buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47);
}

function isGif(buffer) {
  const tag = header(buffer, 0, 6);
  return tag === 'GIF87a' || tag === 'GIF89a';
}

function isWebp(buffer) {
  return header(buffer, 0, 4) === 'RIFF' && header(buffer, 8, 4) === 'WEBP';
}

function isHeicBuffer(buffer) {
  return header(buffer, 4, 4) === 'ftyp' && HEIC_BRANDS.test(header(buffer, 8, 4).toLowerCase());
}

function heicByName(contentType, key) {
  const ct = String(contentType || '').toLowerCase();
  if (/heic|heif/.test(ct)) return true;
  const ext = String(key || '').toLowerCase().split('.').pop();
  return ext === 'heic' || ext === 'heif';
}

function resolveMediaType(contentType, key, buffer) {
  if (isJpeg(buffer)) return 'image/jpeg';
  if (isPng(buffer)) return 'image/png';
  if (isGif(buffer)) return 'image/gif';
  if (isWebp(buffer)) return 'image/webp';
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (SUPPORTED_MEDIA_TYPES.includes(ct)) return ct;
  if (ct === 'image/jpg') return 'image/jpeg';
  const ext = (key || '').toLowerCase().split('.').pop();
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
  return byExt[ext] || null;
}

async function convertHeicToJpeg(buffer) {
  const out = await heicConvert({
    buffer: Buffer.from(buffer),
    format: 'JPEG',
    quality: 0.92,
  });
  return Buffer.from(out);
}

/**
 * Returns { buffer, mediaType } ready for Claude/OpenAI vision.
 * HEIC/HEIF is transcoded to JPEG. Throws UNSUPPORTED_TYPE when the bytes
 * are not a usable still image.
 */
async function toVisionImage(buffer, contentType, key) {
  const needsHeic = isHeicBuffer(buffer) || (heicByName(contentType, key) && !resolveMediaType(contentType, key, buffer));
  if (needsHeic) {
    try {
      const jpeg = await convertHeicToJpeg(buffer);
      return { buffer: jpeg, mediaType: 'image/jpeg' };
    } catch (err) {
      const wrapped = new Error('Could not convert this HEIC photo for analysis');
      wrapped.code = 'UNSUPPORTED_TYPE';
      wrapped.cause = err;
      throw wrapped;
    }
  }
  const mediaType = resolveMediaType(contentType, key, buffer);
  if (mediaType) return { buffer, mediaType };
  const err = new Error('This image format can’t be analysed (try JPEG, PNG, GIF, WebP or HEIC)');
  err.code = 'UNSUPPORTED_TYPE';
  throw err;
}

module.exports = {
  SUPPORTED_MEDIA_TYPES,
  resolveMediaType,
  toVisionImage,
};
