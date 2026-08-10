# CloudFront CDN for project media

The **Projects** page loads a lot of images and video thumbnails. By default the
API serves each one as a short-lived **presigned S3 URL** — private, but with a
rotating signature that a CDN can't cache. This guide puts **Amazon CloudFront**
in front of the bucket so project media is served from **stable, long-cached**
URLs instead.

It is **opt-in**: nothing changes until you set `MEDIA_CDN_BASE_URL`. With it
unset, the app keeps using presigned URLs exactly as before.

---

## How it works (code side)

- Media objects are stored under the private prefix `projects/<userId>/<uuid>.<ext>`.
  The key is a random UUID, so it's unguessable, and it's **never overwritten** —
  the bytes at a key never change.
- When `MEDIA_CDN_BASE_URL` is set, the API returns
  `<MEDIA_CDN_BASE_URL>/<object-key>` for every attachment
  (`getMediaUrl` in [`src/services/s3Client.js`](../src/services/s3Client.js)),
  instead of a presigned S3 URL.
- Uploads are stamped with `Cache-Control: public, max-age=31536000, immutable`,
  so CloudFront and the browser can cache each asset for a year.

Because objects are content-addressed and immutable, aggressive caching is safe:
a given URL always returns the same bytes.

> **Bucket stays private.** With CloudFront **Origin Access Control (OAC)**, only
> the distribution can read from S3 — you do **not** make the bucket public. The
> CDN URLs are unsigned (public to anyone who has the unguessable key), which is
> the delivery model chosen here. If you ever need strict per-request auth on
> media, use CloudFront **signed URLs/cookies** or keep presigned S3 URLs.

---

## Prerequisites

- Access to the AWS account that owns the `S3_BUCKET_NAME` bucket
  (currently `jobcracker`, region `eu-north-1`).
- Permissions to create a CloudFront distribution and edit the bucket policy.
- (Optional) A custom domain + an **ACM certificate in `us-east-1`** if you want
  `cdn.yourdomain.com` instead of the default `dxxxx.cloudfront.net`.

---

## Step 1 — Create the distribution with OAC

CloudFront → **Create distribution**:

1. **Origin domain** — pick the bucket's **REST** endpoint from the dropdown
   (`jobcracker.s3.eu-north-1.amazonaws.com`). Do **not** use the website
   endpoint — OAC needs the REST endpoint.
2. **Origin access** — choose **Origin access control settings (recommended)** →
   **Create control setting** → keep defaults (Sign requests, S3) → Create.
3. **Viewer protocol policy** — **Redirect HTTP to HTTPS**.
4. **Cache policy** — **CachingOptimized** (managed). It honours the origin
   `Cache-Control` (our `immutable, max-age=1y`) up to a 1-year max TTL.
5. **Origin request policy** — none needed for public objects. (If you serve
   video with range requests, that works out of the box.)
6. Create the distribution and note its domain, e.g. `d111abcdef8.cloudfront.net`.

## Step 2 — Let CloudFront read the bucket (OAC bucket policy)

After creating the distribution, CloudFront shows a banner: **"Copy policy"**.
Copy it and add it to the bucket (S3 → bucket → **Permissions** → **Bucket
policy**). It looks like this — scoped to the `projects/*` prefix so only media
(not private reports) is reachable through the CDN:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontReadProjectMedia",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::jobcracker/projects/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>"
        }
      }
    }
  ]
}
```

Replace `<ACCOUNT_ID>` and `<DISTRIBUTION_ID>`. **Block Public Access can stay
fully ON** — OAC is not "public", it's a signed service principal.

> Uploads still go **browser → S3 via presigned PUT**, so keep the CORS rule in
> [`README.md`](./README.md) in place. `AllowedHeaders: ["*"]` already covers the
> `Cache-Control` header the browser now sends on upload.

## Step 3 — (Optional) Custom domain

To use `cdn.yourdomain.com` instead of `dxxxx.cloudfront.net`:

1. Request/import an **ACM certificate in `us-east-1`** for `cdn.yourdomain.com`
   (CloudFront only reads certs from `us-east-1`, regardless of your bucket region).
2. In the distribution → **Settings** → add it under **Alternate domain names
   (CNAMEs)** and select the certificate.
3. In your DNS, add a `CNAME` (or Route 53 alias) `cdn` → `dxxxx.cloudfront.net`.

## Step 4 — Turn it on in the app

Set the env var (locally in `backend/.env`, and in Render for production) to the
distribution domain (no trailing slash):

```
MEDIA_CDN_BASE_URL=https://d111abcdef8.cloudfront.net
```

…or your custom domain: `MEDIA_CDN_BASE_URL=https://cdn.yourdomain.com`

Restart the backend. New project-page loads now serve media from CloudFront. No
frontend change is needed — the API simply returns CDN URLs. Existing objects are
served immediately; there's no migration (the URL is derived from the stored key).

---

## Verify

1. Open the Projects page (or a project detail) in the browser.
2. DevTools → **Network** → filter images. Their URLs should be
   `https://<dist>.cloudfront.net/projects/...`, **not** `...amazonaws.com/...?X-Amz-...`.
3. Reload — responses should show `x-cache: Hit from cloudfront` (after the first
   `Miss`) and `cache-control: public, max-age=31536000, immutable`.

From the shell:

```bash
curl -sI https://<dist>.cloudfront.net/projects/<userId>/<uuid>.jpg | grep -i -E 'cache|x-amz-cf|via'
```

---

## Rollback

Unset `MEDIA_CDN_BASE_URL` (or blank it) and restart the backend — the API goes
straight back to presigned S3 URLs. You can leave the distribution in place; it
just stops being referenced.

## Invalidation (rarely needed)

Keys are immutable, so you almost never invalidate. If you must (e.g. you deleted
media and want the edge copy gone), create an invalidation for `/projects/*` in
the distribution. Note deletes already remove the S3 object; the CDN copy just
ages out.

## Optional: real thumbnails at the edge

Today `thumbnailUrl` equals the full-size `url`. You can generate resized
variants at the edge with a **CloudFront Function / Lambda@Edge** image resizer
(or front the distribution with a serverless image handler). That's a follow-up:
the API would return a transformed `thumbnailUrl` for image attachments when a
CDN is configured.
