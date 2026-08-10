# S3 setup for project media

Project media is uploaded **browser → S3** with presigned PUT URLs, so the
bucket must return CORS headers allowing the app origin to `PUT`/`GET`. Without
this, uploads fail in the browser as a **"CORS error"** (the `/sign` call
succeeds, the PUT to S3 is blocked).

## Apply the CORS rule

The bucket (`S3_BUCKET_NAME`) is shared, so **merge** — don't replace all rules.

### Option A — the merge script (recommended, preserves other rules)

```bash
cd backend
node src/scripts/setupMediaCors.js
```

Requires credentials with `s3:GetBucketCORS` + `s3:PutBucketCORS`. The default
`s3-uploader` IAM user does **not** have these — run it with an admin profile:

```bash
AWS_PROFILE=admin node src/scripts/setupMediaCors.js
```

It reads the current CORS, keeps every existing rule, and sets just the
`bauhly-project-media` rule (origins from `CLIENT_URL` + `http://localhost:5173`,
plus any in `MEDIA_CORS_ORIGINS`).

### Option B — AWS CLI (⚠ replaces ALL rules on the bucket)

Only if the bucket has no other CORS rules you need to keep:

```bash
aws s3api put-bucket-cors --bucket <S3_BUCKET_NAME> \
  --cors-configuration file://backend/aws/project-media-cors.json
```

### Option C — AWS Console

S3 → your bucket → **Permissions** → **Cross-origin resource sharing (CORS)** →
Edit → paste the `CORSRules` array from `project-media-cors.json` (merge it with
any existing rules) → Save.

## Production

Add your deployed frontend origin to `AllowedOrigins` (in the JSON, or via
`CLIENT_URL` / `MEDIA_CORS_ORIGINS` when using the script).

## Serving media through a CDN (CloudFront)

By default the API hands the browser short-lived **presigned** S3 read URLs,
which a CDN can't cache. To serve project media from **stable, long-cached**
CloudFront URLs instead, set `MEDIA_CDN_BASE_URL` and follow
[`CLOUDFRONT_CDN.md`](./CLOUDFRONT_CDN.md). It's opt-in — unset, nothing changes.

## Note on checksums

Recent AWS SDK versions add a default CRC32 checksum to `PutObject`, which put
`x-amz-sdk-checksum-algorithm` into presigned URLs and broke plain browser PUTs.
The S3 client is configured with `requestChecksumCalculation: 'WHEN_REQUIRED'`
(see `src/services/s3Client.js`) so presigned PUTs stay a simple
`fetch(url, { method: 'PUT', body })`.
