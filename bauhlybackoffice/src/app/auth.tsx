import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { USE_MOCKS, api, setToken, setUnauthorizedHandler } from '../services/api'

/*
 * Auth against the backoffice API. The API verifies the password and rejects
 * non-admin accounts; the bearer token it returns is what authorises requests.
 *
 * The localStorage session is a render cache only — it is NOT a trust boundary.
 * Clearing or forging it gains nothing, because every endpoint re-checks the
 * token and the admin role server-side.
 *
 * With VITE_USE_MOCKS=true the provider keeps the old unverified stand-in so
 * the UI can be run offline against mock data.
 */

export interface Session {
  name: string
  email: string
  role: 'admin'
}

const STORAGE_KEY = 'bauhly-backoffice-session'

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

interface AuthContextValue {
  session: Session | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession)

  /*
   * Real sign-in: the API verifies the password and refuses anyone who isn't an
   * admin, then returns a bearer token. The stored session is only a cache for
   * rendering — the token is what actually authorises requests, and every
   * endpoint re-checks the admin role server-side.
   */
  const signIn = useCallback(async (email: string, password: string) => {
    if (USE_MOCKS) {
      const next: Session = { name: email.split('@')[0] ?? 'Internal', email, role: 'admin' }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setSession(next)
      return
    }
    const { token, user } = await api.post<{ token: string; user: Session }>('/auth/login', {
      email,
      password,
    })
    setToken(token)
    const next: Session = { name: user.name, email: user.email, role: 'admin' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSession(next)
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setToken(null)
    setSession(null)
  }, [])

  /*
   * A rejected token means the session is dead, whatever localStorage still
   * says. Drop it so RequireAuth sends us back to /login instead of rendering a
   * signed-in shell whose every request 401s.
   */
  useEffect(() => {
    setUnauthorizedHandler(signOut)
    return () => setUnauthorizedHandler(null)
  }, [signOut])

  return <AuthContext.Provider value={{ session, signIn, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const location = useLocation()
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
