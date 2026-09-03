import client from './client';

// AnalyzeScreen's useEffect runs twice in React Strict Mode (dev). Scraping is
// expensive (1–2 min), so concurrent calls for the same handle share one request.
const inflightFetches = new Map();

export function fetchInstagram(username) {
  const key = String(username || '').trim().toLowerCase();
  if (inflightFetches.has(key)) return inflightFetches.get(key);

  const promise = client
    .post('/instagram/fetch', { username })
    .then((res) => res.data)
    .finally(() => {
      inflightFetches.delete(key);
    });

  inflightFetches.set(key, promise);
  return promise;
}

const PROFILES_CACHE_KEY = 'bauhly.igProfiles';
const HANDLE_KEY = 'bauhly.currentHandle';
let profilesInflight = null;

export function readCachedProfiles() {
  try {
    const raw = sessionStorage.getItem(PROFILES_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.profiles) && parsed.profiles.length) return parsed.profiles;
    }
  } catch { /* private mode */ }
  try {
    const handle = String(localStorage.getItem(HANDLE_KEY) || '').trim().toLowerCase();
    if (handle) return [{ username: handle }];
  } catch { /* private mode */ }
  return [];
}

function writeCachedProfiles(profiles) {
  try {
    sessionStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify({ profiles, at: Date.now() }));
  } catch { /* quota / private mode */ }
}

export function listInstagramProfiles() {
  if (profilesInflight) return profilesInflight;
  profilesInflight = client.get('/instagram').then((res) => {
    writeCachedProfiles(res.data.profiles || []);
    return res.data;
  }).finally(() => {
    profilesInflight = null;
  });
  return profilesInflight;
}

// Make an already-connected handle the current one across the app. Returns
// { profile, profiles } with the now-current handle first.
export function activateInstagramProfile(username) {
  return client.post('/instagram/activate', { username }).then((res) => {
    writeCachedProfiles(res.data.profiles || []);
    return res.data;
  });
}

export function getAuthorityFunnel(username) {
  return client
    .get('/instagram/authority', { params: username ? { username } : undefined })
    .then((res) => res.data);
}

// Full analysis modal: verdict, account summary, strengths, opportunities,
// similar accounts (when cohort assigned), strategic focus, shapes-week.
export function getAnalysisOverview(username) {
  return client
    .get('/instagram/analysis-overview', { params: username ? { username } : undefined })
    .then((res) => res.data);
}

export function getReportDownloadUrl(reportId) {
  return client.get(`/analysis/reports/${reportId}/download`).then((res) => res.data.downloadUrl);
}

export function confirmReport(reportId, summary) {
  return client.patch(`/analysis/reports/${reportId}`, summary).then((res) => res.data);
}
