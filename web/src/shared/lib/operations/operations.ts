import type { DialogAction, ProjectId } from '../../api/contracts';

export type OperationKind =
  | 'create'
  | 'move'
  | 'answer'
  | 'edit'
  | 'epic'
  | 'delete'
  | 'archive'
  | 'restore'
  | 'archive-done';

/** What a form or confirmation reports to the app, so the project cannot change under it. */
export interface OperationControls {
  /** Registers an operation that started in `projectId`; returns its ID. */
  begin: (kind: OperationKind, projectId: ProjectId, dialog?: DialogAction) => number;
  saveStarted: (operationId: number) => void;
  saveFailed: (operationId: number) => void;
  /** The operation finished or was cancelled. */
  end: (operationId: number) => void;
  taskRemoved: (operationId: number, projectId: ProjectId, taskId: number) => void;
  isCurrent?: (operationId: number, projectId: ProjectId) => boolean;
}

/** For a part used on its own, where no project switch needs protecting. */
export const noOperations: OperationControls = {
  begin: () => 0,
  saveStarted: () => {},
  saveFailed: () => {},
  end: () => {},
  taskRemoved: () => {},
};
