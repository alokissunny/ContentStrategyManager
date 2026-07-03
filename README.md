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
  posts via Apify and stores the latest snapshot per user

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
