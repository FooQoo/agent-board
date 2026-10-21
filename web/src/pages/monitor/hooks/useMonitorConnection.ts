import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MonitorClientError,
  monitorClient,
  onMonitorAuthLoss,
  usesMonitorSession,
  type MonitorAuthLoss,
} from '../client';

/** Why the phone is shown the connection screen instead of the monitor. */
export type MonitorConnectionFailure = 'expired' | 'unavailable' | 'unreachable';

export type MonitorConnectionState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'reconnecting' }
  | { status: 'needs_google'; failure: MonitorConnectionFailure | null };

export interface UseMonitorConnectionOptions {
  /** Ask for the app session. Defaults to the monitor client. */
  openSession?: () => Promise<unknown>;
  /** Whether this page uses the app session at all. */
  usesSession?: () => boolean;
  /** Leave for the Google sign-in. Defaults to the top-level move to /monitor/. */
  navigate?: () => void;
}

export interface UseMonitorConnectionResult {
  state: MonitorConnectionState;
  /** The page is moving to the Google sign-in. */
  opening: boolean;
  /** Leave the page for the Google sign-in. A person starts it; it never runs by itself. */
  connect(): void;
}

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** Failed attempts before a network failure is shown with its own action. */
const UNREACHABLE_AFTER = 3;
/** A session that is lost again this many times in a minute is not silently renewed. */
const LOSS_LIMIT = 3;
const LOSS_WINDOW_MS = 60_000;

function classify(cause: unknown): 'sign_in' | 'unavailable' | 'network' {
  if (cause instanceof MonitorClientError) {
    if (cause.code === 'auth_redirect' || cause.code === 'session_required') return 'sign_in';
    if (cause.code === 'unavailable') return 'unavailable';
  }
  return 'network';
}

/** Where the Edge starts or resumes the Google sign-in: the top level of the monitor. */
export function goToGoogle(): void {
  window.location.assign('/monitor/');
}

/**
 * Owns the phone's access to the monitor. It confirms the app session before any list or event
 * stream starts, renews a lost session once the Edge still accepts the phone, and otherwise shows
 * the connection screen. It never signs in on its own: only `connect` moves the page to Google.
 */
export function useMonitorConnection({
  openSession = () => monitorClient.openSession(),
  usesSession = usesMonitorSession,
  navigate = goToGoogle,
}: UseMonitorConnectionOptions = {}): UseMonitorConnectionResult {
  const session = usesSession();
  const [state, setState] = useState<MonitorConnectionState>(
    session ? { status: 'checking' } : { status: 'ready' },
  );
  const [opening, setOpening] = useState(false);
  const openRef = useRef(openSession);
  openRef.current = openSession;
  const readyRef = useRef(!session);
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (!session) return;
    let disposed = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight: Promise<void> | null = null;
    const losses: number[] = [];

    const clearTimer = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const show = (next: MonitorConnectionState) => {
      readyRef.current = next.status === 'ready';
      setState(next);
    };

    const attempt = (silent: boolean): Promise<void> => {
      if (inFlight) return inFlight;
      clearTimer();
      inFlight = (async () => {
        try {
          await openRef.current();
          if (disposed) return;
          failures = 0;
          if (!readyRef.current) show({ status: 'ready' });
        } catch (cause) {
          if (disposed) return;
          const kind = classify(cause);
          if (kind === 'sign_in') {
            show({
              status: 'needs_google',
              failure: silent ? 'expired' : null,
            });
          } else if (kind === 'unavailable') {
            show({ status: 'needs_google', failure: 'unavailable' });
          } else {
            failures += 1;
            show(
              failures >= UNREACHABLE_AFTER
                ? { status: 'needs_google', failure: 'unreachable' }
                : { status: 'reconnecting' },
            );
            const delay =
              RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
            if (document.visibilityState !== 'hidden')
              timer = setTimeout(() => void attempt(true), delay);
          }
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };

    const onLoss = (_loss: MonitorAuthLoss) => {
      if (!readyRef.current) return;
      const now = Date.now();
      losses.push(now);
      while (losses.length > 0 && now - (losses[0] ?? now) > LOSS_WINDOW_MS) losses.shift();
      if (losses.length >= LOSS_LIMIT) {
        show({ status: 'needs_google', failure: 'expired' });
        return;
      }
      void attempt(true);
    };
    const unsubscribe = onMonitorAuthLoss(onLoss);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
      } else if (!readyRef.current) {
        failures = 0;
        void attempt(true);
      }
    };
    const onOnline = () => {
      if (!readyRef.current) void attempt(true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    void attempt(false);

    return () => {
      disposed = true;
      clearTimer();
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [session]);

  const connect = useCallback(() => {
    setOpening(true);
    navigateRef.current();
  }, []);

  return { state, opening, connect };
}
