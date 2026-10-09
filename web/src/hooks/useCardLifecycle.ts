import { useCallback, useRef } from 'react';
import { archiveCard, archiveDone, deleteCard, restoreCard } from '../api';
import type { OperationControls, OperationKind } from '../lib/projectSession';
import type { ProjectId } from '../types';

export type CardLifecycleAction = 'archive' | 'restore' | 'delete' | 'archive-done';
export type CardLifecycleTarget = { cardId: number } | { cardIds: readonly number[] };
export type CardLifecycleResult = { ok: true } | { ok: false; error: unknown };

function operationKind(action: CardLifecycleAction): OperationKind {
  if (action === 'archive-done') return 'archive-done';
  return action;
}

/** Executes existing card APIs inside the project session's operation and duplicate-submit guard. */
export function useCardLifecycle(operations: OperationControls) {
  const inFlight = useRef(false);

  const run = useCallback(
    async (
      action: CardLifecycleAction,
      projectId: ProjectId,
      target: CardLifecycleTarget,
      options: { keepOperationOnError?: boolean } = {},
    ): Promise<CardLifecycleResult> => {
      if (inFlight.current)
        return { ok: false, error: new Error('An operation is already running.') };
      inFlight.current = true;
      const operationId = operations.begin(operationKind(action), projectId);
      if (operations.isCurrent && !operations.isCurrent(operationId, projectId)) {
        inFlight.current = false;
        return { ok: false, error: new Error('The project operation is no longer current.') };
      }
      operations.saveStarted(operationId);
      try {
        if (action === 'archive') {
          if (!('cardId' in target)) throw new Error('A card ID is required to archive a card.');
          await archiveCard(projectId, target.cardId);
        } else if (action === 'restore') {
          if (!('cardId' in target)) throw new Error('A card ID is required to restore a card.');
          await restoreCard(projectId, target.cardId);
        } else if (action === 'delete') {
          if (!('cardId' in target)) throw new Error('A card ID is required to delete a card.');
          const result = await deleteCard(projectId, target.cardId);
          if (result === 'failed') throw new Error('The card could not be deleted.');
        } else {
          if (!('cardIds' in target)) throw new Error('Card IDs are required for bulk archive.');
          await archiveDone(projectId, target.cardIds);
        }
        if (!operations.isCurrent || operations.isCurrent(operationId, projectId)) {
          if (action !== 'archive-done' && 'cardId' in target && operations.cardRemoved) {
            operations.cardRemoved(operationId, projectId, target.cardId);
          } else {
            operations.end(operationId);
          }
        }
        return { ok: true };
      } catch (error) {
        if (!operations.isCurrent || operations.isCurrent(operationId, projectId)) {
          operations.saveFailed(operationId);
          if (!options.keepOperationOnError) operations.end(operationId);
        }
        return { ok: false, error };
      } finally {
        inFlight.current = false;
      }
    },
    [operations],
  );

  return { run };
}
