/**
 * Browser origins allowed to call this API (CORS) and to be used as Meta
 * OAuth redirect bases. CLIENT_URL / CORS_ORIGINS may be comma-separated.
 */
function allowedOrigins() {
  const fromEnv = [process.env.CLIENT_URL, process.env.CORS_ORIGINS]
    .filter(Boolean)
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return new Set([
    'http://localhost:5173',
    'https://www.bauhly.com',
    'https://bauhly.com',
    'https://igsignal-web.onrender.com',
    ...fromEnv,
  ]);
}

module.exports = { allowedOrigins };
