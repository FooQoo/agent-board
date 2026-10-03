import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBoard } from '../api';
import type { Board } from '../types';

export interface UseBoardResult {
  status: 'loading' | 'ready' | 'error';
  board: Board | null;
  /** False while the update stream is down or the last fetch failed. */
  connected: boolean;
  /** When this browser last fetched the board successfully. */
  lastSyncedAt: Date | null;
  reload: () => void;
}

/**
 * Loads the board and keeps it fresh: fetches on mount, opens `/api/events`, and fetches again on every
 * `ready` and `changed` event. An `error` event marks the connection as lost; the next successful fetch
 * after the stream returns restores it.
 */
export function useBoard(): UseBoardResult {
  const [status, setStatus] = useState<UseBoardResult['status']>('loading');
  const [board, setBoard] = useState<Board | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const latestRequest = useRef(0);
  const streamDown = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(() => {
    const request = ++latestRequest.current;
    fetchBoard().then(
      (next) => {
        if (!mounted.current || request !== latestRequest.current) return;
        setBoard(next);
        setStatus('ready');
        setLastSyncedAt(new Date());
        setConnected(!streamDown.current);
      },
      () => {
        if (!mounted.current || request !== latestRequest.current) return;
        setStatus((current) => (current === 'ready' ? 'ready' : 'error'));
        setConnected(false);
      },
    );
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();

    const source = new EventSource('/api/events');
    const refresh = () => {
      streamDown.current = false;
      load();
    };
    const lost = () => {
      streamDown.current = true;
      setConnected(false);
    };
    source.addEventListener('ready', refresh);
    source.addEventListener('changed', refresh);
    source.addEventListener('error', lost);

    return () => {
      mounted.current = false;
      source.close();
    };
  }, [load]);

  const reload = useCallback(() => {
    setStatus((current) => (current === 'error' ? 'loading' : current));
    load();
  }, [load]);

  return { status, board, connected, lastSyncedAt, reload };
}
