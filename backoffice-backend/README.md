# Bauhly Backoffice — API

Internal API for the competitor register and collection. Serves
`bauhlybackoffice/` (the internal UI). Separate from `backend/` (the
customer-facing API) so internal, cross-customer endpoints don't sit on the
public surface and heavy collection runs can't starve customer requests. It
points at the **same MongoDB**, so it can still join to customer records.

## Status

**Phase 1 — competitor register + collection.** This backs the Competitors →
**Accounts** sub-tab. The **Overview** (intelligence) tab is still served from
mock data in the UI; it needs post classification + aggregation (phase 2).

## Data model

Append-only by design — a collection run adds rows, it never edits old ones, so
any "observed change" can be re-derived and audited:

| Collection | Holds |
|---|---|
| `competitoraccounts` | Identity + management state (role, approval status, notes). Metric fields are denormalized copies of the latest snapshot. |
| `accountsnapshots` | One profile reading per collection run. |
| `posts` | Immutable post facts. Upserted on re-collection (unique per account + platform id). |
| `postmetricsnapshots` | Likes/comments/views per reading. |
| `collectionruns` | Per-run log incl. per-account outcome. |

Derived values (follower change, posts/week, median engagement) are computed
from snapshots at read time — never stored.

## Endpoints — `/api/backoffice`

`POST /auth/login` · `GET /auth/me` — admin-only (role checked server-side on
every request).

`GET /competitors` · `GET /competitors/:id` · `POST /competitors/lookup` ·
`POST /competitors` · `PATCH /competitors/status` · `GET /competitor-groups` ·
`GET /competitor-suggestions` · `PATCH /competitor-suggestions/:id` ·
`GET /collection/status` · `POST /collection/run` · `POST /collection/scrape-posts` ·
`POST /collection/enrich-accounts` · `GET /analysis/latest` · `POST /analysis/run` ·
`GET /customers` · `GET /customers/:id`

`GET /customers` lists Bauhly signups (excludes admins) with Instagram handle and
whether a weekly plan has been presented. `GET /customers/:id` returns the
customer plus their latest `WeeklyRoute` (the plan shown in the product).

`POST /competitors` snapshots the profile only (no posts).  
`POST /collection/scrape-posts` with `{ ids }` scrapes the last
`COLLECTION_BACKFILL_DAYS` (default 30) of posts for selected accounts and
waits until finished; accounts scraped inside that window are skipped and
listed in the response.

`POST /collection/enrich-accounts` with `{ ids }` runs Claude enrichment on
selected accounts (country, account type, posting cadence, engagement,
performance, content type). Accounts enriched inside the same window are
skipped.

`POST /analysis/run` builds a filtered snapshot of competitor posts and asks
Claude for a structured Overview dashboard. Each run is saved against its
filter scope (location · follower range · period).  
`GET /analysis/latest?location=&followerRangeLabel=&period=` returns the newest
completed report for that scope so Overview can switch filters without re-running.

`POST /collection/run` with `{ accountId }` collects one account and waits;
without it, a full run starts in the background (progress via
`/collection/status`).

## Commands

```bash
npm install
cp .env.example .env      # set APIFY_TOKEN, JWT_SECRET, MONGO_URI
npm run dev               # against the configured MongoDB
npm run dev:memory        # ephemeral in-memory Mongo + seed data, no infra needed
npm test                  # vitest (26 tests)
npm run typecheck
```

`npm run dev:memory` prints dev sign-in details and discards all data on exit.

## Notes

- Apify is flaky: it intermittently returns an `error: not_found` row for
  accounts that plainly exist. That is treated as absence (recorded as a failed
  observation), never as a real profile with zeroed stats.
- A per-account failure never aborts a batch run — it is recorded and attributed
  in `collectionruns.results`.
