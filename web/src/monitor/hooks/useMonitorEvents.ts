import { useEffect, useRef, useState } from 'react';

export type MonitorRefreshReason = 'ready' | 'changed' | 'disconnected' | 'visible' | 'manual';
export type MonitorStreamState = 'connecting' | 'connected' | 'disconnected' | 'hidden';

const HEARTBEAT_DEADLINE_MS = 45_000;
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
const EVENTS_URL = '/monitor/api/events';

export interface UseMonitorEventsOptions {
  onRefresh(reason: MonitorRefreshReason): void;
  onVisibility?(visible: boolean): void;
}

export interface UseMonitorEventsResult {
  state: MonitorStreamState;
}

/** Owns only the read-only EventSource lifecycle. Snapshot reads remain in useMonitor. */
export function useMonitorEvents({
  onRefresh,
  onVisibility,
}: UseMonitorEventsOptions): UseMonitorEventsResult {
  const refreshRef = useRef(onRefresh);
  const visibilityRef = useRef(onVisibility);
  refreshRef.current = onRefresh;
  visibilityRef.current = onVisibility;
  const [state, setState] = useState<MonitorStreamState>(() =>
    document.visibilityState === 'hidden' ? 'hidden' : 'connecting',
  );

  useEffect(() => {
    let disposed = false;
    let hidden = document.visibilityState === 'hidden';
    let source: EventSource | null = null;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryIndex = 0;
    let skipNextReadyRefresh = false;
    let readySeen = false;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    };
    const clearRetry = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    };
    const closeSource = () => {
      clearHeartbeat();
      source?.close();
      source = null;
    };

    const scheduleRetry = () => {
      if (disposed || hidden || retryTimer !== null) return;
      const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)] ?? 30_000;
      retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS_MS.length - 1);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, delay);
    };

    const failed = (candidate: EventSource) => {
      if (source !== candidate || disposed || hidden) return;
      readySeen = false;
      closeSource();
      setState('disconnected');
      refreshRef.current('disconnected');
      scheduleRetry();
    };

    const armHeartbeatDeadline = (candidate: EventSource) => {
      clearHeartbeat();
      heartbeatTimer = setTimeout(() => failed(candidate), HEARTBEAT_DEADLINE_MS);
    };

    function connect() {
      if (disposed || hidden || source !== null || retryTimer !== null) return;
      setState('connecting');
      let candidate: EventSource;
      try {
        candidate = new EventSource(EVENTS_URL);
      } catch {
        setState('disconnected');
        refreshRef.current('disconnected');
        scheduleRetry();
        return;
      }
      source = candidate;
      candidate.addEventListener('ready', () => {
        if (source !== candidate || disposed) return;
        readySeen = true;
        setState('connected');
        armHeartbeatDeadline(candidate);
        if (skipNextReadyRefresh) skipNextReadyRefresh = false;
        else refreshRef.current('ready');
      });
      candidate.addEventListener('changed', () => {
        if (source === candidate && !disposed) refreshRef.current('changed');
      });
      candidate.addEventListener('heartbeat', () => {
        if (source !== candidate || disposed) return;
        if (!readySeen) return;
        retryIndex = 0;
        armHeartbeatDeadline(candidate);
      });
      candidate.addEventListener('error', () => failed(candidate));
    }

    const onVisibilityChange = () => {
      const nextHidden = document.visibilityState === 'hidden';
      if (nextHidden === hidden) return;
      hidden = nextHidden;
      clearRetry();
      closeSource();
      if (hidden) {
        skipNextReadyRefresh = false;
        setState('hidden');
        visibilityRef.current?.(false);
        return;
      }
      skipNextReadyRefresh = true;
      retryIndex = 0;
      setState('connecting');
      if (visibilityRef.current) visibilityRef.current(true);
      else refreshRef.current('visible');
      connect();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (hidden) {
      setState('hidden');
      visibilityRef.current?.(false);
    } else {
      connect();
    }

    return () => {
      disposed = true;
      clearHeartbeat();
      clearRetry();
      closeSource();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return { state };
}
