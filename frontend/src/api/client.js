import axios from 'axios';
import { isAiDebugEnabled } from '../lib/aiDebug';

function resolveBaseURL() {
  const configured = import.meta.env.VITE_API_URL?.trim();
  if (!configured) return '/api';
  const normalized = configured.replace(/\/$/, '');
  return normalized.endsWith('/api') ? normalized : `${normalized}/api`;
}

export const TOKEN_KEY = 'widesignals_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — in-memory auth still works for this tab */
  }
}

let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

const client = axios.create({
  baseURL: resolveBaseURL(),
});

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (isAiDebugEnabled()) config.headers['x-debug-prompts'] = '1';
  return config;
});

// Wrong password on /auth/login is a 401 too — that is not a dead session.
const AUTH_ATTEMPT = /\/auth\/(login|register|google|demo-login)(?:\?|$)/;

function bearerFromConfig(config) {
  const raw = config?.headers?.Authorization ?? config?.headers?.authorization;
  const value = typeof raw === 'string' ? raw : raw?.toString?.();
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const url = String(err.config?.url || '');
    const stored = getToken();
    const sent = bearerFromConfig(err.config);
    // A 401 from an older tab's request must not wipe a login that just landed.
    if (status === 401 && !AUTH_ATTEMPT.test(url) && stored && (!sent || sent === stored)) {
      setToken(null);
      onUnauthorized?.();
    }
    return Promise.reject(err);
  },
);

export default client;
