// The studio's UI language (Settings › Language), sent by the frontend on
// every request as `x-app-locale`. Unknown or missing → English.
const LANGUAGES = { en: 'English', es: 'Spanish' };

function appLocaleOf(req) {
  const raw = String(req?.get?.('x-app-locale') || req?.headers?.['x-app-locale'] || '').trim().toLowerCase().slice(0, 2);
  return LANGUAGES[raw] ? raw : 'en';
}

module.exports = { LANGUAGES, appLocaleOf };
