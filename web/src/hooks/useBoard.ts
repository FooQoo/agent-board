import { useCallback, useEffect, useRef, useState } from 'react';
import { FetchError, fetchBoard } from '../api';
import type { Board, ProjectId } from '../types';

export interface UseBoardResult {
  status: 'loading' | 'ready' | 'error';
  board: Board | null;
  /** Why the board is not shown: the project does not exist, or the request failed. */
  error: 'not_found' | 'failed' | null;
  /** True when the last fetch failed. A ready board stays on screen. */
  fetchFailed: boolean;
  /** When this browser last fetched the board successfully. */
  lastSyncedAt: Date | null;
  reload: () => void;
}

interface Slot {
  projectId: ProjectId | null;
  status: UseBoardResult['status'];
  board: Board | null;
  error: UseBoardResult['error'];
  fetchFailed: boolean;
  lastSyncedAt: Date | null;
}

function loadingSlot(projectId: ProjectId | null): Slot {
  return {
    projectId,
    status: 'loading',
    board: null,
    error: null,
    fetchFailed: false,
    lastSyncedAt: null,
  };
}

/**
 * Loads the board of one project. The result belongs to `projectId` only: switching projects drops the
 * old board at once, and a response is applied only while it is the latest request for the project that
 * is still shown. The generation counter also covers StrictMode remounts and A to B to A switches,
 * where a late answer for the same ID must not replace the newer request.
 */
export function useBoard(projectId: ProjectId | null): UseBoardResult {
  const [slot, setSlot] = useState<Slot>(() => loadingSlot(projectId));
  const generation = useRef(0);
  const current = useRef(projectId);

  const load = useCallback((target: ProjectId) => {
    const mine = ++generation.current;
    fetchBoard(target).then(
      (board) => {
        if (mine !== generation.current || board.project.id !== target) return;
        setSlot({
          projectId: target,
          status: 'ready',
          board,
          error: null,
          fetchFailed: false,
          lastSyncedAt: new Date(),
        });
      },
      (cause: unknown) => {
        if (mine !== generation.current) return;
        const notFound = cause instanceof FetchError && cause.projectNotFound;
        setSlot((previous) =>
          previous.projectId === target && previous.status === 'ready' && !notFound
            ? { ...previous, fetchFailed: true }
            : {
                projectId: target,
                status: 'error',
                board: null,
                error: notFound ? 'not_found' : 'failed',
                fetchFailed: true,
                lastSyncedAt: null,
              },
        );
      },
    );
  }, []);

  useEffect(() => {
    current.current = projectId;
    if (projectId === null) return;
    setSlot(loadingSlot(projectId));
    load(projectId);
    return () => {
      generation.current++;
    };
  }, [projectId, load]);

  const view = slot.projectId === projectId ? slot : loadingSlot(projectId);

  const reload = useCallback(() => {
    const target = current.current;
    if (target === null) return;
    setSlot((previous) =>
      previous.projectId === target && previous.status === 'error' ? loadingSlot(target) : previous,
    );
    load(target);
  }, [load]);

  return {
    status: view.status,
    board: view.board,
    error: view.error,
    fetchFailed: view.fetchFailed,
    lastSyncedAt: view.lastSyncedAt,
    reload,
  };
}
