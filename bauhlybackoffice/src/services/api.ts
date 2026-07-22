/*
 * HTTP client for the backoffice API.
 *
 * The repository layer calls this and then validates every response against the
 * Zod schemas in src/types. That keeps the backend and UI honest about the
 * contract without a shared package: any drift throws at the seam instead of
 * rendering wrong numbers.
 *
 * Set VITE_USE_MOCKS=true to run the UI against the in-memory mock data with no
 * backend (useful offline and in tests).
 */

function resolveBackofficeBaseUrl(): string {
  const configured = import.meta.env.VITE_BACKOFFICE_API_URL?.trim()
  if (!configured) return 'http://localhost:5290/api/backoffice'
  const normalized = configured.replace(/\/$/, '')
  // Render Blueprint passes the service origin; append the API prefix when missing.
  return normalized.endsWith('/api/backoffice') ? normalized : `${normalized}/api/backoffice`
}

const BASE_URL = resolveBackofficeBaseUrl()

export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'

const TOKEN_KEY = 'bauhly-backoffice-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

/*
 * Called when the API rejects our token. AuthProvider registers a handler that
 * drops the cached session too — without it, clearing the token alone leaves the
 * UI believing it is signed in and firing unauthenticated requests forever.
 */
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })

  if (!res.ok) {
    // Surface the server's message — the add/lookup flows rely on them
    // ("already in the list", "could not be read").
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { message?: string; error?: string }
      if (body?.message) message = body.message
      else if (body?.error) message = body.error
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401) {
      setToken(null)
      onUnauthorized?.()
    }
    throw new ApiError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, params?: Record<string, string | number | undefined>) => {
    const query = params
      ? `?${new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)]),
        )}`
      : ''
    return request<T>(`${path}${query}`)
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }),
}
