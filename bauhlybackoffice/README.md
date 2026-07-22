# Bauhly Backoffice

Internal tool for competitor analysis and segmentation. Separate from the
customer-facing app in `frontend/` — this is for the Bauhly team only.

UI ported from the reference implementation:
https://github.com/leonkibuka84/bauhly-backoffice

## Status

**Phase 1 — Competitors tab.** The Competitors section is live:

- **Overview** — segmentation filters (location, follower range, authority
  pillar, time period), group stats, "what stronger accounts are doing
  differently" (high performers vs comparison group), and pattern movement
  across formats / topics / hooks / captions / days / times.
- **Accounts** — the managed competitor register: search, filter by location /
  follower range / status, period comparison, and per-account detail with the
  Watchlist → Approved → In benchmarks workflow.

The remaining sections (Signals, Intelligence, Customers, Integrations) are
already ported under `src/features/` but are **not routed or shown in the nav**.
To take one live, add its entry to `primaryNav` in
`src/app/shell/AppShell.tsx` and its route in `src/app/router.tsx`.

## Data

All data is currently **mock** (`src/services/*/mockData.ts`). No backend is
wired up yet. Auth is a localStorage placeholder (`src/app/auth.tsx`) with no
verification — it is not real authentication and must be replaced before this
is exposed anywhere beyond local use.

## Commands

```bash
npm install
npm run dev      # http://localhost:5190
npm run build    # tsc -b && vite build
npm test         # vitest (73 tests)
npm run lint     # oxlint
```
