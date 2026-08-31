import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import client, {
  TOKEN_KEY,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from '../api/client';

const AuthContext = createContext(null);
const AUTH_CHANNEL = 'widesignals-auth';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(() => Boolean(getToken()));
  const appliedTokenRef = useRef(null);
  const inflightRef = useRef(null);
  const userRef = useRef(null);
  const channelRef = useRef(null);
  userRef.current = user;

  const hydrateFromToken = useCallback((token) => {
    if (!token) {
      appliedTokenRef.current = null;
      inflightRef.current = null;
      setUser(null);
      return Promise.resolve(null);
    }
    if (token === appliedTokenRef.current && userRef.current) {
      return Promise.resolve(userRef.current);
    }
    if (token === appliedTokenRef.current && inflightRef.current) {
      return inflightRef.current;
    }
    appliedTokenRef.current = token;
    const request = client.get('/auth/me')
      .then((res) => {
        setUser(res.data.user);
        return res.data.user;
      })
      .catch((err) => {
        const status = err?.response?.status;
        if ((status === 401 || status === 403) && appliedTokenRef.current === token) {
          const stored = getToken();
          if (!stored || stored === token) {
            appliedTokenRef.current = null;
            setToken(null);
            setUser(null);
          }
        }
        return null;
      })
      .finally(() => {
        if (inflightRef.current === request) inflightRef.current = null;
      });
    inflightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    hydrateFromToken(token).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [hydrateFromToken]);

  useEffect(() => {
    function onStorage(event) {
      // `key === null` is Storage.clear() in another tab.
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      const token = event.key === null ? getToken() : event.newValue;
      if (!token) {
        appliedTokenRef.current = null;
        setUser(null);
        return;
      }
      hydrateFromToken(token);
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      const token = getToken();
      if (!token) {
        if (userRef.current) {
          appliedTokenRef.current = null;
          setUser(null);
        }
        return;
      }
      if (token !== appliedTokenRef.current) hydrateFromToken(token);
    }

    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);

    let channel = null;
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL);
      channelRef.current = channel;
      channel.onmessage = (event) => {
        const type = event.data?.type;
        if (type === 'logout') {
          appliedTokenRef.current = null;
          setUser(null);
        } else if (type === 'login') {
          hydrateFromToken(getToken());
        }
      };
    } catch {
      channelRef.current = null;
    }

    setUnauthorizedHandler(() => {
      appliedTokenRef.current = null;
      setUser(null);
      try { channelRef.current?.postMessage({ type: 'logout' }); } catch { /* ignore */ }
    });

    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
      try { channel?.close(); } catch { /* ignore */ }
      channelRef.current = null;
      setUnauthorizedHandler(null);
    };
  }, [hydrateFromToken]);

  function broadcast(type) {
    try { channelRef.current?.postMessage({ type }); } catch { /* ignore */ }
  }

  async function establish(request) {
    const res = await request;
    setToken(res.data.token);
    appliedTokenRef.current = res.data.token;
    setUser(res.data.user);
    broadcast('login');
    return res.data;
  }

  async function login(email, password) {
    return establish(client.post('/auth/login', { email, password }));
  }

  async function register(name, email, password) {
    return establish(client.post('/auth/register', { name, email, password }));
  }

  async function demoLogin() {
    return establish(client.post('/auth/demo-login'));
  }

  async function googleLogin(credential) {
    return establish(client.post('/auth/google', { credential }));
  }

  function logout() {
    appliedTokenRef.current = null;
    setToken(null);
    setUser(null);
    broadcast('logout');
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, demoLogin, googleLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
