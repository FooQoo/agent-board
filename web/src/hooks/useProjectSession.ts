import { useEffect, useMemo, useReducer, useRef } from 'react';
import {
  initSession,
  sessionReducer,
  type OperationControls,
  type OperationKind,
} from '../lib/projectSession';
import type { DialogAction, ProjectId } from '../types';

/** Owns project-bound view state and operation controls shared by the board and archive views. */
export function useProjectSession(
  requestedProjectId: string | null,
  initialSelectedId: number | null = null,
) {
  const [session, dispatch] = useReducer(sessionReducer, undefined, () =>
    initSession(requestedProjectId, initialSelectedId),
  );
  const sessionRef = useRef(session);
  const nextOperationId = useRef(0);
  const liveOperation = useRef<{ id: number; projectId: ProjectId } | null>(null);
  sessionRef.current = session;

  useEffect(() => {
    dispatch({ type: 'URL_REQUESTED', projectId: requestedProjectId });
  }, [requestedProjectId]);

  const operations: OperationControls = useMemo(
    () => ({
      begin: (kind: OperationKind, projectId: ProjectId, dialog?: DialogAction) => {
        const live = liveOperation.current;
        if (live !== null) return live.id;
        const current = sessionRef.current.operation;
        if (current !== null) return current.id;
        const operationId = ++nextOperationId.current;
        liveOperation.current = { id: operationId, projectId };
        dispatch({ type: 'OPEN_OPERATION', operationId, kind, projectId, dialog });
        return operationId;
      },
      saveStarted: (operationId) => dispatch({ type: 'SAVE_STARTED', operationId }),
      saveFailed: (operationId) => dispatch({ type: 'SAVE_FAILED', operationId }),
      end: (operationId) => {
        if (liveOperation.current?.id === operationId) liveOperation.current = null;
        dispatch({ type: 'OPERATION_CANCELLED', operationId });
      },
      cardDeleted: (operationId, projectId, cardId) => {
        if (liveOperation.current?.id === operationId) liveOperation.current = null;
        dispatch({ type: 'CARD_DELETED', operationId, projectId, cardId });
      },
      cardRemoved: (operationId, projectId, cardId) => {
        if (liveOperation.current?.id === operationId) liveOperation.current = null;
        dispatch({ type: 'CARD_REMOVED', operationId, projectId, cardId });
      },
      isCurrent: (operationId, projectId) =>
        liveOperation.current?.id === operationId && liveOperation.current.projectId === projectId,
    }),
    [],
  );

  return { session, dispatch, operations };
}
