const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client;

// Immutable caching for project media. Object keys are content-addressed UUIDs
// (projects/<userId>/<uuid>.<ext>) that are never overwritten, so the bytes at a
// key never change — safe to cache "forever" at the CDN edge and in the browser.
const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

function getS3Client() {
  if (!process.env.S3_BUCKET_NAME) {
    throw new Error('S3_BUCKET_NAME is not set. Add it (and AWS credentials) to backend/.env to enable report storage.');
  }
  if (!client) {
    client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      // Recent AWS SDK versions add a default CRC32 checksum to PutObject, which
      // leaks `x-amz-sdk-checksum-algorithm` into presigned upload URLs and then
      // demands extra `x-amz-checksum-*` headers the browser can't easily send —
      // the PUT fails (and reads as a CORS error). PutObject doesn't require a
      // checksum, so only add one WHEN_REQUIRED, keeping presigned PUTs a plain
      // `fetch(url, { method: 'PUT', body })`.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}

// Whether S3 is configured at all — lets project media degrade gracefully to
// text-only captures when the bucket isn't set up yet.
function isS3Configured() {
  return Boolean(process.env.S3_BUCKET_NAME);
}

function mediaExpiry() {
  return Number(process.env.S3_PRESIGN_EXPIRY_SECONDS) || 3600;
}

// ── CDN delivery ────────────────────────────────────────────────────────────
// When MEDIA_CDN_BASE_URL is set (e.g. https://d111.cloudfront.net or a custom
// CloudFront domain in front of the bucket), media is served from stable,
// cacheable public URLs instead of rotating short-lived presigned S3 URLs.
// Access then relies on the unguessable UUID object keys rather than an expiring
// signature — see backend/aws/CLOUDFRONT_CDN.md for the full setup.
function mediaCdnBaseUrl() {
  return (process.env.MEDIA_CDN_BASE_URL || '').trim().replace(/\/+$/, '');
}
function isCdnConfigured() {
  return Boolean(mediaCdnBaseUrl());
}

// The public CDN URL for a stored key, or '' when no CDN is configured. Keys are
// path-like (projects/<uuid>/<uuid>.jpg) and only contain URL-safe characters,
// so each path segment is encoded without touching the slashes.
function publicMediaUrl(key) {
  const base = mediaCdnBaseUrl();
  if (!base || !key) return '';
  const path = String(key).split('/').map(encodeURIComponent).join('/');
  return `${base}/${path}`;
}

// The URL the client should load a media object from: the CDN URL when a CDN is
// configured (stable + cacheable), otherwise a short-lived presigned S3 URL.
async function getMediaUrl(key) {
  if (!key) return '';
  if (isCdnConfigured()) return publicMediaUrl(key);
  return getPresignedMediaUrl(key);
}

// A presigned PUT the browser uploads a file straight to — the media never
// passes through this server. The client MUST send the same Content-Type.
async function getPresignedUploadUrl(key, contentType) {
  const s3 = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
    // Store an immutable cache header so the CDN edge and the browser cache the
    // object long-term. It's a signed header, so the browser MUST echo the same
    // value on the PUT — the /sign endpoint returns it for the client to send.
    CacheControl: MEDIA_CACHE_CONTROL,
  });
  return getSignedUrl(s3, command, { expiresIn: mediaExpiry() });
}

// A short-lived read URL for one stored object.
async function getPresignedMediaUrl(key) {
  const s3 = getS3Client();
  const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key });
  return getSignedUrl(s3, command, { expiresIn: mediaExpiry() });
}

// Best-effort cleanup — deleting the DB record is what matters, so an orphaned
// object must never fail the request that removed its owner.
async function deleteObjects(keys) {
  const list = (keys || []).filter(Boolean);
  if (!list.length || !isS3Configured()) return;
  const s3 = getS3Client();
  try {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Delete: { Objects: list.map((Key) => ({ Key })), Quiet: true },
      })
    );
  } catch (err) {
    console.error('[s3] could not delete objects:', err.message);
  }
}

async function uploadMarkdown(key, content) {
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: content,
      ContentType: 'text/markdown; charset=utf-8',
    })
  );
  return key;
}

/** Upload raw bytes (e.g. a profile avatar fetched from Instagram/Graph). */
async function uploadBytes(key, body, contentType = 'application/octet-stream') {
  const s3 = getS3Client();
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

async function getPresignedDownloadUrl(key) {
  const s3 = getS3Client();
  const expiresIn = Number(process.env.S3_REPORT_PRESIGN_EXPIRY_SECONDS) || 3600;
  const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

async function getObjectText(key) {
  const s3 = getS3Client();
  const result = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
  return result.Body.transformToString();
}

// Fetch the raw bytes of a stored object (e.g. an image to send to a vision
// model). Returns the buffer plus the object's stored Content-Type.
async function getObjectBytes(key) {
  const s3 = getS3Client();
  const result = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
  const bytes = await result.Body.transformToByteArray();
  return { buffer: Buffer.from(bytes), contentType: result.ContentType || 'application/octet-stream' };
}

module.exports = {
  uploadMarkdown,
  uploadBytes,
  getPresignedDownloadUrl,
  getObjectText,
  getObjectBytes,
  isS3Configured,
  getPresignedUploadUrl,
  getPresignedMediaUrl,
  getMediaUrl,
  publicMediaUrl,
  isCdnConfigured,
  MEDIA_CACHE_CONTROL,
  deleteObjects,
};
