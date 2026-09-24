const crypto = require('node:crypto');

const SCOPES = ['rw_organization_admin', 'w_organization_social'];
const PAGE_ROLES = new Set(['ADMINISTRATOR', 'CONTENT_ADMINISTRATOR', 'CONTENT_ADMIN']);
const organizationPattern = /^urn:li:organization:[0-9]+$/;

function error(status, message, code = 'LINKEDIN_ERROR') {
  return Object.assign(new Error(message), { status, code });
}
function configured() {
  return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET
    && process.env.LINKEDIN_REDIRECT_URI && /^[a-f0-9]{64}$/i.test(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY || ''));
}
function key() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY || '')) {
    throw error(503, 'LinkedIn publishing is awaiting secure app setup.');
  }
  return Buffer.from(process.env.LINKEDIN_TOKEN_ENCRYPTION_KEY, 'hex');
}
function encryptToken(token, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}
function decryptToken(value, userId) {
  try {
    const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(String(userId)));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
  } catch {
    throw error(409, 'Reconnect LinkedIn to restore company-page access.', 'LINKEDIN_RECONNECT');
  }
}
function connectionStatus(row) {
  const authorized = Boolean(row?.companyAuthorizedAt);
  const expired = authorized && (!row.tokenExpiresAt || new Date(row.tokenExpiresAt).getTime() <= Date.now());
  return {
    configured: configured(), connected: Boolean(authorized || row?.memberId),
    name: authorized ? 'Company pages' : row?.name || '', connectedAt: row?.connectedAt || null,
    canPublish: configured() && authorized && !expired,
    needsReconnect: Boolean((row?.memberId && !authorized) || expired),
    tokenExpiresAt: row?.tokenExpiresAt || null,
    selectedOrganization: row?.selectedOrganization || '',
  };
}
function accessToken(row, userId) {
  if (!configured()) throw error(503, 'LinkedIn publishing is awaiting secure app setup.');
  if (!row?.companyAuthorizedAt || !row.encryptedAccessToken || !row.tokenExpiresAt || new Date(row.tokenExpiresAt).getTime() <= Date.now()) {
    throw error(409, 'Reconnect LinkedIn to grant company-page publishing access.', 'LINKEDIN_RECONNECT');
  }
  return decryptToken(row.encryptedAccessToken, userId);
}
function headers(token) {
  return { Authorization: `Bearer ${token}`, 'LinkedIn-Version': process.env.LINKEDIN_API_VERSION || '202603',
    'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
}
function providerError(status) {
  if (status === 401) return error(409, 'Your LinkedIn authorization expired. Reconnect from Settings.', 'LINKEDIN_RECONNECT');
  if (status === 403) return error(403, 'LinkedIn denied page access. Check your Page admin role and app permissions, then reconnect.', 'LINKEDIN_PERMISSION');
  if (status === 429) return error(429, 'LinkedIn rate limit reached. Please wait before trying again.');
  return error(502, 'LinkedIn could not complete this request. Please try again later.');
}
async function get(token, path) {
  let response;
  try { response = await fetch(`https://api.linkedin.com/rest/${path}`, { headers: headers(token), signal: AbortSignal.timeout(15000) }); }
  catch { throw error(502, 'LinkedIn is taking too long to respond. Please try again.'); }
  if (!response.ok) throw providerError(response.status);
  return response.json();
}
async function pageRoles(token) {
  const pages = new Map();
  // Rebuild URLs locally: never follow arbitrary pagination links with a bearer token.
  let start = 0;
  for (let batch = 0; batch < 100; batch++) {
    const data = await get(token, `organizationAcls?q=roleAssignee&state=APPROVED&count=100&start=${start}`);
    if (!Array.isArray(data.elements)) throw error(502, 'LinkedIn returned an invalid page list.');
    for (const item of data.elements) {
      const urn = item.organizationTarget || item.organization;
      if (item.state === 'APPROVED' && PAGE_ROLES.has(item.role) && organizationPattern.test(urn)) {
        pages.set(urn, { urn, role: item.role });
      }
    }
    const next = data.paging?.links?.find((link) => link.rel === 'next');
    if (!next && data.elements.length < 100) return [...pages.values()];
    let nextStart;
    try { nextStart = next?.href ? Number(new URL(next.href, 'https://api.linkedin.com').searchParams.get('start')) : NaN; }
    catch { nextStart = NaN; }
    const count = Number(data.paging?.count) || 100;
    start = Number.isInteger(nextStart) && nextStart > start ? nextStart : start + count;
  }
  throw error(502, 'Too many LinkedIn pages to load. Please contact support.');
}
async function listPages(token) {
  const pages = await pageRoles(token);
  const named = [];
  for (const page of pages) {
    const id = page.urn.split(':').pop();
    let name = `Company page ${id}`;
    try {
      const info = await get(token, `organizations/${id}`);
      name = info.localizedName || Object.values(info.name?.localized || {})[0] || name;
    } catch (err) {
      // Content admins may publish while organization details are admin-only.
      if (err.status !== 403) throw err;
    }
    named.push({ ...page, name, url: `https://www.linkedin.com/company/${id}/` });
  }
  return named;
}
// Escape LinkedIn's little-text syntax so ordinary punctuation is posted literally.
function plainCommentary(text) {
  return text.replace(/[\\|{}@\[\]()<>#*_~]/g, '\\$&');
}
module.exports = { SCOPES, organizationPattern, error, configured, encryptToken, decryptToken,
  connectionStatus, accessToken, headers, providerError, pageRoles, listPages, plainCommentary };
