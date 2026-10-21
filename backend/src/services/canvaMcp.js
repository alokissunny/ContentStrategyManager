// Canva's remote MCP server, used as a client from the backend (experimental
// "Design in Canva"). Each studio connects its own Canva account: OAuth 2.1
// with dynamic client registration + PKCE against mcp.canva.com, tokens kept
// encrypted on CanvaConnection, refreshed when they run out. `withCanva` opens
// one MCP session for a run and hands back `call(tool, args)`.
const crypto = require('node:crypto');
const CanvaConnection = require('../models/CanvaConnection');

const MCP_URL = process.env.CANVA_MCP_URL || 'https://mcp.canva.com/mcp';
const ISSUER = new URL(MCP_URL).origin;
// what Design in Canva uses: make + read designs, import the post's photos, brand kits
const SCOPES = (process.env.CANVA_MCP_SCOPES || 'profile:read design:meta:read design:content:read design:content:write asset:read asset:write brandkit:read')
  .split(/\s+/).filter(Boolean);
const TOOL_TIMEOUT_MS = Math.max(30000, Number(process.env.CANVA_MCP_TIMEOUT_MS) || 180000);

function error(status, message, code = 'CANVA_ERROR') {
  return Object.assign(new Error(message), { status, code });
}

// ── tokens at rest ───────────────────────────────────────────────────────────
function key() {
  const hex = process.env.CANVA_TOKEN_ENCRYPTION_KEY || '';
  if (/^[a-f0-9]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  if (!process.env.JWT_SECRET) throw error(503, 'Canva is not set up on this server.');
  return crypto.createHash('sha256').update(`canva-mcp:${process.env.JWT_SECRET}`).digest();
}
function encrypt(value, userId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(String(userId)));
  const out = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), out].map((p) => p.toString('base64')).join('.');
}
function decrypt(value, userId) {
  try {
    const [iv, tag, data] = String(value || '').split('.').map((p) => Buffer.from(p, 'base64'));
    const cipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(String(userId)));
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
  } catch {
    throw error(409, 'Reconnect Canva in Settings › Experimental features.', 'CANVA_RECONNECT');
  }
}
const hash = (v) => crypto.createHash('sha256').update(v).digest('hex');
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ── OAuth ────────────────────────────────────────────────────────────────────
let metadataCache = null;
async function authServer() {
  if (metadataCache) return metadataCache;
  const res = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw error(502, 'Canva sign-in is not reachable right now.');
  metadataCache = await res.json();
  return metadataCache;
}

// a client registered for this redirect (CANVA_MCP_CLIENT_ID skips registration)
async function clientFor(row, redirectUri) {
  if (process.env.CANVA_MCP_CLIENT_ID) {
    return { client_id: process.env.CANVA_MCP_CLIENT_ID, ...(process.env.CANVA_MCP_CLIENT_SECRET ? { client_secret: process.env.CANVA_MCP_CLIENT_SECRET } : {}) };
  }
  if (row?.clientInformation?.client_id && row.redirectUri === redirectUri) return row.clientInformation;
  const meta = await authServer();
  if (!meta.registration_endpoint) throw error(503, 'Canva did not offer client registration — set CANVA_MCP_CLIENT_ID.');
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: process.env.CANVA_MCP_CLIENT_NAME || 'Bauhly',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPES.join(' '),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) {
    console.warn(`[canva] client registration refused (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
    throw error(502, 'Canva refused to register this app for sign-in. Set CANVA_MCP_CLIENT_ID to a registered client.');
  }
  return { client_id: body.client_id, ...(body.client_secret ? { client_secret: body.client_secret } : {}) };
}

// → the Canva consent URL; the browser comes back to `redirectUri` with code + state
async function startConnect(userId, redirectUri) {
  const row = await CanvaConnection.findOne({ user: userId }).lean();
  const client = await clientFor(row, redirectUri);
  const meta = await authServer();
  const state = crypto.randomBytes(32).toString('hex');
  const verifier = b64url(crypto.randomBytes(48));
  await CanvaConnection.findOneAndUpdate({ user: userId }, {
    $set: {
      clientInformation: client,
      redirectUri,
      stateHash: hash(state),
      codeVerifier: verifier,
      stateExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  }, { upsert: true });
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    resource: ISSUER,
  }).toString();
  return { url: url.toString(), state };
}

async function tokenRequest(client, params) {
  const meta = await authServer();
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...params,
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      resource: ISSUER,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== 'string') {
    console.warn(`[canva] token request (${params.grant_type}) failed ${res.status}: ${String(body.error || '').slice(0, 120)}`);
    return null;
  }
  return body;
}

function tokenFields(token, userId, previousRefresh = '') {
  const refresh = token.refresh_token || previousRefresh;
  return {
    encryptedAccessToken: encrypt(token.access_token, userId),
    ...(refresh ? { encryptedRefreshToken: encrypt(refresh, userId) } : {}),
    tokenExpiresAt: new Date(Date.now() + (Number(token.expires_in) > 0 ? Number(token.expires_in) : 3600) * 1000),
    ...(token.scope ? { scopes: String(token.scope).split(/[ ,]+/).filter(Boolean) } : {}),
  };
}

async function finishConnect(userId, code, state) {
  if (typeof code !== 'string' || !code || typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) {
    throw error(400, 'Invalid Canva callback. Please connect again.');
  }
  const pending = await CanvaConnection.findOneAndUpdate(
    { user: userId, stateHash: hash(state), stateExpiresAt: { $gt: new Date() } },
    { $unset: { stateHash: 1, stateExpiresAt: 1, codeVerifier: 1 } },
  ).select('+codeVerifier');
  if (!pending?.codeVerifier) throw error(400, 'The Canva connection expired or was already used. Please connect again.');
  const token = await tokenRequest(pending.clientInformation, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.codeVerifier,
  });
  if (!token) throw error(502, 'Could not authorize Canva. Please connect again.');
  const row = await CanvaConnection.findOneAndUpdate(
    { _id: pending._id },
    { $set: { ...tokenFields(token, userId), connectedAt: new Date() } },
    { new: true },
  );
  return connectionStatus(row);
}

function connectionStatus(row) {
  return {
    connected: Boolean(row?.connectedAt),
    connectedAt: row?.connectedAt || null,
    scopes: row?.scopes || [],
  };
}

async function status(userId) {
  return connectionStatus(await CanvaConnection.findOne({ user: userId }).lean());
}

async function disconnect(userId) {
  await CanvaConnection.deleteOne({ user: userId });
  return connectionStatus(null);
}

// a live access token, refreshed a minute before it runs out
async function accessToken(userId) {
  const row = await CanvaConnection.findOne({ user: userId }).select('+encryptedAccessToken +encryptedRefreshToken');
  if (!row?.connectedAt || !row.encryptedAccessToken) {
    throw error(409, 'Connect Canva first (Settings › Experimental features).', 'CANVA_NOT_CONNECTED');
  }
  if (row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() - 60000 > Date.now()) {
    return decrypt(row.encryptedAccessToken, userId);
  }
  const refresh = row.encryptedRefreshToken ? decrypt(row.encryptedRefreshToken, userId) : '';
  const token = refresh ? await tokenRequest(row.clientInformation || {}, { grant_type: 'refresh_token', refresh_token: refresh }) : null;
  if (!token) throw error(409, 'Your Canva sign-in expired — reconnect Canva in Settings › Experimental features.', 'CANVA_RECONNECT');
  await CanvaConnection.updateOne({ _id: row._id }, { $set: tokenFields(token, userId, refresh) });
  return token.access_token;
}

// ── MCP session ──────────────────────────────────────────────────────────────
// A tool's answer: its structured content, else its text parsed as JSON (Canva
// answers JSON text), else the text itself.
function toolResult(name, result) {
  const text = (Array.isArray(result?.content) ? result.content : [])
    .filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim();
  if (result?.isError) throw error(502, `Canva ${name}: ${text.slice(0, 300) || 'failed'}`);
  // page previews Canva sends with an answer (read-design / edit-design), kept
  // off the JSON as `_images: [{ data (base64), mediaType }]`
  const images = (Array.isArray(result?.content) ? result.content : [])
    .filter((c) => c?.type === 'image' && c.data)
    .map((c) => ({ data: c.data, mediaType: c.mimeType || 'image/png' }));
  let out;
  if (result?.structuredContent && typeof result.structuredContent === 'object') out = result.structuredContent;
  else { try { out = JSON.parse(text); } catch { out = { text }; } }
  if (images.length && out && typeof out === 'object') Object.defineProperty(out, '_images', { value: images, enumerable: false });
  return out;
}

/**
 * Run `fn({ call, tools })` inside one MCP session for this studio's Canva.
 * `call(name, args)` → the tool's parsed answer; `tools` = the server's tool names.
 */
async function withCanva(userId, fn) {
  const token = await accessToken(userId);
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'bauhly-backend', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
  } catch (err) {
    if (/401|unauthori[sz]ed|invalid_token/i.test(String(err?.message)) || err?.code === 401) {
      throw error(409, 'Canva rejected the sign-in — reconnect Canva in Settings › Experimental features.', 'CANVA_RECONNECT');
    }
    throw error(502, `Could not reach Canva's MCP server: ${err.message}`);
  }
  try {
    const listed = await client.listTools().catch(() => ({ tools: [] }));
    const tools = new Set((listed.tools || []).map((t) => t.name));
    // every call's wall time, for the debug trace (where a slow run spends it)
    const timings = [];
    const call = async (name, args) => {
      const t0 = Date.now();
      try {
        return toolResult(name, await client.callTool(
          { name, arguments: args },
          undefined,
          { timeout: TOOL_TIMEOUT_MS, resetTimeoutOnProgress: true },
        ));
      } finally {
        timings.push({ tool: name, ms: Date.now() - t0 });
      }
    };
    return await fn({ call, tools, timings });
  } finally {
    await client.close().catch(() => {});
  }
}

module.exports = { startConnect, finishConnect, status, disconnect, withCanva, error, SCOPES, MCP_URL };
