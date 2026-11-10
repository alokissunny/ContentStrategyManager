// Per-user limits on the routes that call a model (LLM, image, vision, speech).
// Each call costs real money, so a stuck retry loop or a script hammering one
// button must not run up the bill. Two windows per bucket: a short burst
// window and a daily one.
//
// Counters live in Redis when REDIS_URL is set (shared across instances) and
// fall back to process memory otherwise. A Redis error never blocks a
// request — the limiter fails open and logs.
//
// Env overrides: AI_LIMIT_<BUCKET>_PER_MIN / AI_LIMIT_<BUCKET>_PER_DAY
// (e.g. AI_LIMIT_HEAVY_PER_DAY=300). AI_RATE_LIMIT=0 turns limiting off.
// Admins are never limited.

const DEFAULTS = {
  // whole-post / whole-plan agent runs, image generation, video work
  heavy: { perMin: 6, perDay: 150 },
  // small single calls: capture understanding, transcription, caption polish
  light: { perMin: 30, perDay: 800 },
  // the recorder's pause-time transcript clean-up — fires every pause
  live: { perMin: 60, perDay: 3000 },
};

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function limitsFor(bucket) {
  const d = DEFAULTS[bucket] || DEFAULTS.light;
  const up = bucket.toUpperCase();
  return [
    { name: 'min', windowMs: 60_000, max: envInt(`AI_LIMIT_${up}_PER_MIN`, d.perMin) },
    { name: 'day', windowMs: 86_400_000, max: envInt(`AI_LIMIT_${up}_PER_DAY`, d.perDay) },
  ];
}

function disabled() {
  return ['0', 'false', 'off', 'no'].includes(String(process.env.AI_RATE_LIMIT || '').toLowerCase());
}

// ── stores ────────────────────────────────────────────────────────────────
// incr(key, windowMs) → { count, resetMs } for a fixed window.

const memory = new Map();
let lastSweep = 0;
function memoryIncr(key, windowMs) {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  let hit = memory.get(key);
  if (!hit || hit.resetAt <= now) {
    hit = { count: 0, resetAt: now + windowMs };
    memory.set(key, hit);
  }
  hit.count += 1;
  return { count: hit.count, resetMs: hit.resetAt - now };
}

let redis = null;
let lastRedisError = 0;
function redisClient() {
  if (!process.env.REDIS_URL) return null;
  if (!redis) {
    const IORedis = require('ioredis');
    // Not the BullMQ connection: that one retries forever, and a limiter must
    // answer fast or step aside.
    redis = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
    });
    redis.on('error', (err) => {
      if (Date.now() - lastRedisError < 60_000) return;
      lastRedisError = Date.now();
      console.error('[aiRateLimit] redis error:', err.message);
    });
  }
  return redis;
}

async function incr(key, windowMs) {
  const r = redisClient();
  if (r && r.status === 'ready') {
    try {
      const [[, count], [, ttl]] = await r.multi()
        .incr(key)
        .pttl(key)
        .exec();
      if (ttl < 0) await r.pexpire(key, windowMs);
      return { count: Number(count), resetMs: ttl > 0 ? ttl : windowMs };
    } catch (err) {
      console.error('[aiRateLimit] redis incr failed, using memory:', err.message);
    }
  }
  return memoryIncr(key, windowMs);
}

// ── middleware ────────────────────────────────────────────────────────────

function aiLimit(bucket = 'light') {
  const windows = limitsFor(bucket);
  return async function aiRateLimit(req, res, next) {
    if (disabled() || !req.user || req.user.role === 'admin') return next();
    const uid = String(req.user._id);
    try {
      for (const w of windows) {
        const slot = Math.floor(Date.now() / w.windowMs);
        const { count, resetMs } = await incr(`ailimit:${bucket}:${w.name}:${uid}:${slot}`, w.windowMs);
        if (count > w.max) {
          const retryAfter = Math.max(1, Math.ceil(resetMs / 1000));
          res.set('Retry-After', String(retryAfter));
          console.warn(`[aiRateLimit] ${bucket}/${w.name} limit hit user=${uid} ${req.method} ${req.originalUrl}`);
          return res.status(429).json({
            message: w.name === 'day'
              ? 'You have reached today’s limit for AI actions. It resets tomorrow.'
              : 'Too many AI requests at once — please wait a moment and try again.',
            retryAfter,
          });
        }
      }
    } catch (err) {
      console.error('[aiRateLimit] limiter failed open:', err.message);
    }
    return next();
  };
}

module.exports = { aiLimit, incr, _memory: memory };
