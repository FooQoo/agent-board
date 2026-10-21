import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MonitorClientError,
  monitorClient,
  onMonitorAuthLoss,
  usesMonitorSession,
  type MonitorAuthLoss,
} from '../client';

/** Why the phone is asked for the passcode again instead of being shown the monitor. */
export type MonitorConnectionFailure = 'expired' | 'unavailable' | 'unreachable';

export type MonitorConnectionState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'reconnecting' }
  | { status: 'needs_passcode'; failure: MonitorConnectionFailure | null };

/**
 * Why the last passcode was not taken. `wrong` and `locked` come from the monitor; the monitor
 * never says how many tries are left. `unavailable` and `unreachable` mean it was not asked at all.
 */
export type UnlockFailure = 'wrong' | 'locked' | 'unavailable' | 'unreachable';

export interface UseMonitorConnectionOptions {
  /** Ask whether the app session is live. Defaults to the monitor client. */
  openSession?: () => Promise<unknown>;
  /** Trade a passcode for the app session. Defaults to the monitor client. */
  unlock?: (code: string) => Promise<unknown>;
  /** Whether this page uses the app session at all. */
  usesSession?: () => boolean;
}

export interface UseMonitorConnectionResult {
  state: MonitorConnectionState;
  /** A passcode is being checked. */
  unlocking: boolean;
  /** Why the last passcode was not taken; cleared when the next one is sent. */
  unlockFailure: UnlockFailure | null;
  /** Send the passcode. A person starts it; it never runs by itself. True when it was taken. */
  unlock(code: string): Promise<boolean>;
}

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
/** Failed attempts before a network failure is shown on the passcode screen. */
const UNREACHABLE_AFTER = 3;
/** A session that is lost again this many times in a minute is not checked again by itself. */
const LOSS_LIMIT = 3;
const LOSS_WINDOW_MS = 60_000;

function classify(cause: unknown): 'passcode' | 'unavailable' | 'network' {
  if (cause instanceof MonitorClientError) {
    if (cause.code === 'session_required') return 'passcode';
    if (cause.code === 'unavailable') return 'unavailable';
  }
  return 'network';
}

function unlockFailureOf(cause: unknown): UnlockFailure {
  if (cause instanceof MonitorClientError) {
    if (cause.code === 'unlock_failed') return 'wrong';
    if (cause.code === 'unlock_locked') return 'locked';
    if (cause.code === 'unavailable') return 'unavailable';
  }
  return 'unreachable';
}

/**
 * Owns the phone's access to the monitor. It confirms the app session before any list or event
 * stream starts. Without a live session it asks for the passcode and shows the monitor only after
 * the monitor has taken it. Nothing is read, streamed or answered before that, and a lost session
 * (expired, replaced by a restart) brings the passcode screen back. It never sends a passcode
 * on its own: only `unlock` does, when a person submits one.
 */
export function useMonitorConnection({
  openSession = () => monitorClient.openSession(),
  unlock: unlockWith = (code) => monitorClient.unlock(code),
  usesSession = usesMonitorSession,
}: UseMonitorConnectionOptions = {}): UseMonitorConnectionResult {
  const session = usesSession();
  const [state, setState] = useState<MonitorConnectionState>(
    session ? { status: 'checking' } : { status: 'ready' },
  );
  const [unlocking, setUnlocking] = useState(false);
  const [unlockFailure, setUnlockFailure] = useState<UnlockFailure | null>(null);
  const openRef = useRef(openSession);
  openRef.current = openSession;
  const unlockRef = useRef(unlockWith);
  unlockRef.current = unlockWith;
  const stateRef = useRef<MonitorConnectionState>(state);
  const unlockingRef = useRef(false);

  const show = useCallback((next: MonitorConnectionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

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
    const ready = () => stateRef.current.status === 'ready';

    const attempt = (silent: boolean): Promise<void> => {
      if (inFlight) return inFlight;
      clearTimer();
      inFlight = (async () => {
        try {
          await openRef.current();
          if (disposed) return;
          failures = 0;
          if (!ready()) show({ status: 'ready' });
        } catch (cause) {
          if (disposed) return;
          const kind = classify(cause);
          if (kind === 'passcode') {
            // Keep the message of a passcode that was just refused; replace a network one.
            const shown = stateRef.current;
            if (
              shown.status !== 'needs_passcode' ||
              shown.failure === 'unreachable' ||
              shown.failure === 'unavailable'
            )
              show({ status: 'needs_passcode', failure: silent ? 'expired' : null });
          } else if (kind === 'unavailable') {
            show({ status: 'needs_passcode', failure: 'unavailable' });
          } else {
            failures += 1;
            show(
              failures >= UNREACHABLE_AFTER
                ? { status: 'needs_passcode', failure: 'unreachable' }
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
      if (!ready()) return;
      const now = Date.now();
      losses.push(now);
      while (losses.length > 0 && now - (losses[0] ?? now) > LOSS_WINDOW_MS) losses.shift();
      if (losses.length >= LOSS_LIMIT) {
        show({ status: 'needs_passcode', failure: 'expired' });
        return;
      }
      void attempt(true);
    };
    const unsubscribe = onMonitorAuthLoss(onLoss);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
      } else if (!ready()) {
        failures = 0;
        void attempt(true);
      }
    };
    const onOnline = () => {
      if (!ready()) void attempt(true);
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
  }, [session, show]);

  const unlock = useCallback(
    async (code: string): Promise<boolean> => {
      if (unlockingRef.current) return false;
      unlockingRef.current = true;
      setUnlocking(true);
      setUnlockFailure(null);
      try {
        await unlockRef.current(code);
        show({ status: 'ready' });
        return true;
      } catch (cause) {
        setUnlockFailure(unlockFailureOf(cause));
        return false;
      } finally {
        unlockingRef.current = false;
        setUnlocking(false);
      }
    },
    [show],
  );

  return { state, unlocking, unlockFailure, unlock };
}
