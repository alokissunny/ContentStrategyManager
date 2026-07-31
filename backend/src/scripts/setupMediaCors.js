/*
 * One-off: allow the browser to upload project media straight to S3.
 *
 * Project media is uploaded browser→S3 with presigned PUT URLs, so the bucket
 * must send CORS headers permitting the app origin to PUT/GET. This reads the
 * bucket's CURRENT CORS config and MERGES in a rule for our origins — it never
 * blindly overwrites, because the bucket is shared with other features.
 *
 * Run:  node src/scripts/setupMediaCors.js
 * Idempotent — safe to run again; it replaces only the rule it owns (matched by
 * a marker ID) and leaves every other rule untouched.
 */

require('dotenv').config();
const {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} = require('@aws-sdk/client-s3');

const RULE_ID = 'bauhly-project-media'; // our marker, so re-runs update in place

function originsFromEnv() {
  const set = new Set(['http://localhost:5173']); // dev
  const client = (process.env.CLIENT_URL || '').trim().replace(/\/$/, '');
  if (client) set.add(client);
  const extra = (process.env.MEDIA_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  extra.forEach((o) => set.add(o.replace(/\/$/, '')));
  return [...set];
}

async function main() {
  const bucket = process.env.S3_BUCKET_NAME;
  if (!bucket) throw new Error('S3_BUCKET_NAME is not set');
  const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

  let existing = [];
  try {
    const cur = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
    existing = cur.CORSRules || [];
  } catch (err) {
    if (err.name !== 'NoSuchCORSConfiguration') throw err; // no CORS yet is fine
  }

  const ours = {
    ID: RULE_ID,
    AllowedOrigins: originsFromEnv(),
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3000,
  };

  // keep every rule that isn't ours; append/replace ours
  const kept = existing.filter((r) => r.ID !== RULE_ID);
  const next = [...kept, ours];

  await s3.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: next } }));

  console.log(`✓ CORS updated on s3://${bucket}`);
  console.log(`  kept ${kept.length} existing rule(s), set "${RULE_ID}" for origins:`);
  ours.AllowedOrigins.forEach((o) => console.log(`    - ${o}`));
}

main().catch((err) => {
  console.error('Failed to set bucket CORS:', err.message);
  process.exit(1);
});
