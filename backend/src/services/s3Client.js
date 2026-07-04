const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let client;

function getS3Client() {
  if (!process.env.S3_BUCKET_NAME) {
    throw new Error('S3_BUCKET_NAME is not set. Add it (and AWS credentials) to backend/.env to enable report storage.');
  }
  if (!client) {
    client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  }
  return client;
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

module.exports = { uploadMarkdown, getPresignedDownloadUrl, getObjectText };
