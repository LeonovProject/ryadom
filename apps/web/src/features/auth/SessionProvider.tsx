import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type components } from '../../shared/api/client';
import { advanceSession, sessionEpoch, subscribeSession, type SessionNotice } from '../../shared/api/session-boundary';
import { responseFailure } from './api';

type Me = components['schemas']['Me'];
type SessionState = { status: 'loading' | 'authenticated' | 'guest' | 'error'; me: Me | null; notice: SessionNotice };
type Session = SessionState & { refresh: () => Promise<void>; accept: (me: Me) => void; logout: () => Promise<void>; logoutPending: boolean };
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [state, setState] = useState<SessionState>({ status: 'loading', me: null, notice: null });
  const [logoutPending, setLogoutPending] = useState(false);
  const logoutLock = useRef(false);
  const currentRead = useRef<AbortController | null>(null);
  const actor = useRef<string | null>(null);
  const knownGuest = useRef(false);
  const lastNotice = useRef<SessionNotice>(null);

  const clear = useCallback((notice: SessionNotice) => {
    if (knownGuest.current && (!notice || notice === lastNotice.current)) return;
    advanceSession();
    currentRead.current?.abort();
    void client.cancelQueries();
    client.clear();
    actor.current = null;
    knownGuest.current = true;
    lastNotice.current = notice;
    setState({ status: 'guest', me: null, notice });
  }, [client]);

  const accept = useCallback((me: Me) => {
    advanceSession();
    currentRead.current?.abort();
    void client.cancelQueries();
    client.clear();
    actor.current = me.account.id;
    knownGuest.current = false;
    lastNotice.current = null;
    setState({ status: 'authenticated', me, notice: null });
  }, [client]);

  const refresh = useCallback(async () => {
    currentRead.current?.abort();
    const controller = new AbortController();
    currentRead.current = controller;
    const epoch = sessionEpoch();
    try {
      const result = await api.GET('/me', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), cache: 'no-store' });
      if (epoch !== sessionEpoch() || controller.signal.aborted) return;
      if (result.data && result.response.status === 200) {
        knownGuest.current = false;
        lastNotice.current = null;
        // getMe may observe a session changed in another tab. Clear old actor data first.
        if (actor.current !== result.data.account.id) {
          advanceSession();
          void client.cancelQueries();
          client.clear();
          actor.current = result.data.account.id;
        }
        setState({ status: 'authenticated', me: result.data, notice: null });
      } else if (result.response.status === 401) clear(result.error?.error.code === 'SESSION_EXPIRED' ? 'expired' : null);
      else if (result.response.status === 403 && result.error?.error.code === 'ACCOUNT_BLOCKED') clear('blocked');
      else {
        knownGuest.current = false;
        void client.cancelQueries();
        client.clear();
        setState({ status: 'error', me: null, notice: null });
      }
    } catch {
      if (epoch === sessionEpoch() && !controller.signal.aborted) {
        knownGuest.current = false;
        void client.cancelQueries();
        client.clear();
        setState({ status: 'error', me: null, notice: null });
      }
    }
  }, [client, clear]);

  const logout = useCallback(async () => {
    if (logoutLock.current) throw new Error('Logout is already in progress');
    logoutLock.current = true;
    setLogoutPending(true);
    const epoch = sessionEpoch();
    try {
      const result = await api.POST('/auth/logout', { signal: AbortSignal.timeout(15_000) });
      if (result.response.status !== 204) throw responseFailure(result.response, result.error);
      if (epoch === sessionEpoch()) clear(null);
    } finally { logoutLock.current = false; setLogoutPending(false); }
  }, [clear]);

  useEffect(() => subscribeSession(clear), [clear]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      currentRead.current?.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    if (!state.me) return;
    const remaining = new Date(state.me.sessionExpiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = window.setTimeout(() => { void refresh(); }, Math.min(2_147_483_647, Math.max(1_000, remaining)));
    return () => window.clearTimeout(timer);
  }, [state.me, refresh]);

  return <SessionContext.Provider value={{ ...state, refresh, accept, logout, logoutPending }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is required');
  return session;
}
