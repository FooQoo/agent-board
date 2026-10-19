import { fetchBoard } from '../../../features/tasks/api/read';
import { useProjectResource } from '../../../features/projects/model/useProjectResource';
import type { Board, ProjectId } from '../../../shared/api/contracts';

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

/**
 * Loads the board of one project. The result belongs to `projectId` only: switching projects drops the
 * old board at once, and a response is applied only while it is the latest request for the project that
 * is still shown. The generation counter also covers StrictMode remounts and A to B to A switches,
 * where a late answer for the same ID must not replace the newer request.
 */
export function useBoard(projectId: ProjectId | null): UseBoardResult {
  const resource = useProjectResource(projectId, fetchBoard);

  return {
    status: resource.status,
    board: resource.data,
    error: resource.error,
    fetchFailed: resource.fetchFailed,
    lastSyncedAt: resource.lastSyncedAt,
    reload: resource.reload,
  };
}
