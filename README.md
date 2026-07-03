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
cp .env.example .env   # set MONGO_URI / JWT_SECRET
npm install
npm run dev             # nodemon, http://localhost:5000
```

Endpoints:
- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET/POST /api/signals`, `PUT/DELETE /api/signals/:id`
- `GET /api/routes/current`, `GET/POST /api/routes`, `PUT /api/routes/:id`

## Frontend

```
cd frontend
cp .env.example .env    # set VITE_API_URL
npm install
npm run dev              # http://localhost:5173
```

Routes: `/` landing page, `/auth` login & sign up, `/dashboard` (protected, reads
signals + current route from the API).

Requires a running MongoDB instance (local or Atlas) for the backend to connect.
