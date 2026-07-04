# WideSignals

MERN boilerplate for a content-strategy platform: surfaces audience/market/opportunity
signals and turns them into a weekly action route.

```
IgSignal/
├── backend/    Express + Mongoose API (JWT auth, signals, weekly routes)
└── frontend/   Vite + React app (landing page, auth, dashboard)
```

## Backend

```
cd backend
cp .env.example .env   # set MONGO_URI / JWT_SECRET / APIFY_TOKEN
npm install
npm run dev             # nodemon, http://localhost:5000
```

Endpoints:
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/demo-login`, `GET /api/auth/me`
- `GET/POST /api/signals`, `PUT/DELETE /api/signals/:id`
- `GET /api/routes/current`, `GET/POST /api/routes`, `PUT /api/routes/:id`
- `POST /api/instagram/fetch` (body: `{ username }`), `GET /api/instagram` — scrapes a profile + recent
  posts via Apify, stores the latest snapshot per user, and (if configured) generates a Brand DNA report
- `GET /api/analysis/reports`, `GET /api/analysis/reports/:id/download` — list a user's generated
  reports and get a fresh presigned S3 URL for one

`demo-login` needs no credentials — it finds-or-creates a fixed `demo@widesignals.com` account and
returns a real JWT, for quickly exercising the app without registering.

### Instagram scraping (Apify)

The `/api/instagram/fetch` endpoint uses the [Apify](https://apify.com) API via `apify-client` to run
a profile scraper and a post scraper for a given Instagram username, normalizes the results, and
upserts them onto an `InstagramProfile` document tied to the requesting user. Set in `.env`:

- `APIFY_TOKEN` — your Apify API token (required; calls fail with a clear error if unset)
- `APIFY_INSTAGRAM_PROFILE_ACTOR` — defaults to `apify/instagram-profile-scraper`
- `APIFY_INSTAGRAM_POST_ACTOR` — defaults to `apify/instagram-post-scraper`
- `INSTAGRAM_POSTS_LIMIT` — how many recent posts to pull (default 12)

The normalizer in `src/services/instagramScraper.js` reads a few common field-name aliases from actor
output, but actor schemas can change — verify against a live run and adjust the aliases there if fields
come back empty.

### Brand DNA analysis (Anthropic + S3)

Right after a successful Instagram scrape, `fetchInstagram` also calls Claude to generate a Markdown
"Brand DNA" report (Business / Positioning / Content Strategy interpretation, each a table of specific
findings and evidence) and uploads it to S3. This is best-effort — if Claude or S3 fails, the scrape
still succeeds and the response includes `reportError` instead of `report`.

- The prompt template lives in its own file at `backend/prompts/brand-analysis-prompt.md` — edit it
  there to change what the report covers; `{{SNAPSHOT_JSON}}` is replaced with the scraped profile/posts.
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (defaults to `claude-sonnet-5`) — used by
  `src/services/brandAnalysis.js`
- `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` — used by
  `src/services/s3Client.js` to upload the report to a unique key
  (`reports/{userId}/{username}-{timestamp}.md`) and to mint presigned download URLs
- `S3_REPORT_PRESIGN_EXPIRY_SECONDS` — how long a presigned download URL stays valid (default 3600)
- Reports are stored **privately** — every download goes through a presigned URL rather than a public
  object, minted on demand via `GET /api/analysis/reports/:id/download`

## Frontend

```
cd frontend
cp .env.example .env    # set VITE_API_URL
npm install
npm run dev              # http://localhost:5173
```

Routes: `/` landing page, `/auth` login & sign up (plus a "Continue as demo user" shortcut),
`/onboarding` (protected — "Analyze my Instagram" flow: connect a handle, watch it scrape via the
backend, then view the profile + recent posts it found), `/dashboard` (protected, reads signals +
current route from the API).

Requires a running MongoDB instance (local or Atlas) for the backend to connect, and an Apify token
to actually run the Instagram scrape (without one, `/onboarding` will show a clear error at the
analyze step).
