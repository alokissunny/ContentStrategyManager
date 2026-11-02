// Cross-instance invalidation for the in-process TTL caches. With more than one
// API instance, a `del` on one (e.g. the header account switch clearing the
// cached current handle) must reach the others, or they keep serving the old
// value until it expires. Uses Redis pub/sub when REDIS_URL is set; a no-op
// otherwise (single instance — the local delete is enough).

const CHANNEL = 'ttlcache:del';
const ORIGIN = require('crypto').randomUUID();
const handlers = new Map(); // cache name → (key) => void

let pub = null;
let started = false;
let lastError = 0;

function logError(err) {
  if (Date.now() - lastError < 60_000) return;
  lastError = Date.now();
  console.error('[cacheBus] redis error:', err.message);
}

function start() {
  if (started || !process.env.REDIS_URL) return;
  started = true;
  const IORedis = require('ioredis');
  const opts = { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000 };
  pub = new IORedis(process.env.REDIS_URL, opts);
  pub.on('error', logError);
  const sub = new IORedis(process.env.REDIS_URL, { ...opts, maxRetriesPerRequest: null, enableOfflineQueue: true });
  sub.on('error', logError);
  sub.subscribe(CHANNEL).catch(logError);
  sub.on('message', (_channel, raw) => {
    try {
      const { o, n, k } = JSON.parse(raw);
      if (o === ORIGIN) return;
      handlers.get(n)?.(k);
    } catch { /* not ours */ }
  });
}

function register(name, onDelete) {
  handlers.set(name, onDelete);
  start();
}

function broadcastDelete(name, key) {
  if (!pub || pub.status !== 'ready') return;
  pub.publish(CHANNEL, JSON.stringify({ o: ORIGIN, n: name, k: key })).catch(logError);
}

module.exports = { register, broadcastDelete };
