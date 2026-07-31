const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client;

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

// A presigned PUT the browser uploads a file straight to — the media never
// passes through this server. The client MUST send the same Content-Type.
async function getPresignedUploadUrl(key, contentType) {
  const s3 = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
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

module.exports = {
  uploadMarkdown,
  getPresignedDownloadUrl,
  getObjectText,
  isS3Configured,
  getPresignedUploadUrl,
  getPresignedMediaUrl,
  deleteObjects,
};
