import type { Card, DialogAction, ProjectId } from '../types';
import type { AnswerFormKey } from './answer';

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
export type ViewMode = 'board' | 'archive';

/** A form or confirmation that must finish or be cancelled before the project can change. */
export interface Operation {
  id: number;
  kind: OperationKind;
  /** The project the operation started in. Writes always go here. */
  projectId: ProjectId;
  saving: boolean;
}

/** The latest project requested through the URL while an operation was open. `null` means no project. */
export interface PendingTarget {
  projectId: ProjectId | null;
}

export interface AnswerLease {
  key: AnswerFormKey;
  projectId: ProjectId;
}

export interface SessionState {
  /** The project whose board is shown. The URL holds the requested one. */
  activeProjectId: ProjectId | null;
  selectedId: number | null;
  viewMode: ViewMode;
  archiveSelectedId: number | null;
  bulkArchive: { projectId: ProjectId; targets: Card[] } | null;
  dialog: DialogAction | null;
  operation: Operation | null;
  pendingTarget: PendingTarget | null;
  answerLeases: AnswerLease[];
}

export type SessionAction =
  | { type: 'URL_REQUESTED'; projectId: ProjectId | null }
  | { type: 'SELECT_CARD'; id: number | null }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  | { type: 'SELECT_ARCHIVE_CARD'; id: number | null }
  | { type: 'OPEN_BULK_ARCHIVE'; projectId: ProjectId; targets: Card[] }
  | { type: 'CLOSE_BULK_ARCHIVE' }
  | {
      type: 'OPEN_OPERATION';
      operationId: number;
      kind: OperationKind;
      projectId: ProjectId;
      dialog?: DialogAction;
    }
  | { type: 'SAVE_STARTED'; operationId: number }
  | { type: 'SAVE_FAILED'; operationId: number }
  | { type: 'OPERATION_FINISHED'; operationId: number }
  | { type: 'OPERATION_CANCELLED'; operationId: number }
  | { type: 'CARD_REMOVED'; operationId: number; projectId: ProjectId; cardId: number }
  | { type: 'ANSWER_LEASE_STARTED'; key: AnswerFormKey; projectId: ProjectId }
  | { type: 'ANSWER_LEASE_ENDED'; key: AnswerFormKey; projectId: ProjectId };

export function initSession(
  activeProjectId: ProjectId | null,
  selectedId: number | null = null,
): SessionState {
  return {
    activeProjectId,
    selectedId,
    viewMode: 'board',
    archiveSelectedId: null,
    bulkArchive: null,
    dialog: null,
    operation: null,
    pendingTarget: null,
    answerLeases: [],
  };
}

/** Applies a project change: the selection and the dialog belong to the project that was shown. */
function applyProject(state: SessionState, projectId: ProjectId | null): SessionState {
  if (projectId === state.activeProjectId) {
    return state.pendingTarget === null ? state : { ...state, pendingTarget: null };
  }
  return {
    ...state,
    activeProjectId: projectId,
    // Nothing was shown before the first project, so a preset selection stays.
    selectedId: state.activeProjectId === null ? state.selectedId : null,
    viewMode: 'board',
    archiveSelectedId: null,
    bulkArchive: null,
    dialog: null,
    pendingTarget: null,
  };
}

/** Ends the operation and applies the latest request that arrived while it was open. */
function finishOperation(state: SessionState): SessionState {
  const ended: SessionState = { ...state, operation: null, dialog: null };
  return state.pendingTarget && state.answerLeases.length === 0
    ? applyProject(ended, state.pendingTarget.projectId)
    : ended;
}

function finishAnswerLease(
  state: SessionState,
  key: AnswerFormKey,
  projectId: ProjectId,
): SessionState {
  const answerLeases = state.answerLeases.filter(
    (lease) => lease.key !== key || lease.projectId !== projectId,
  );
  const ended = { ...state, answerLeases };
  return answerLeases.length === 0 && ended.operation === null && ended.pendingTarget
    ? applyProject(ended, ended.pendingTarget.projectId)
    : ended;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'URL_REQUESTED':
      if (state.operation === null && state.answerLeases.length === 0)
        return applyProject(state, action.projectId);
      return {
        ...state,
        pendingTarget:
          action.projectId === state.activeProjectId ? null : { projectId: action.projectId },
      };
    case 'SELECT_CARD':
      return { ...state, selectedId: action.id };
    case 'SET_VIEW_MODE':
      if (state.operation !== null && state.viewMode !== action.mode) return state;
      return {
        ...state,
        viewMode: action.mode,
        selectedId: action.mode === 'archive' ? null : state.selectedId,
        archiveSelectedId: action.mode === 'board' ? null : state.archiveSelectedId,
        bulkArchive: action.mode === 'board' ? null : state.bulkArchive,
      };
    case 'SELECT_ARCHIVE_CARD':
      if (state.operation !== null) return state;
      return { ...state, archiveSelectedId: action.id };
    case 'OPEN_BULK_ARCHIVE':
      if (
        state.operation?.kind !== 'archive-done' ||
        state.operation.projectId !== action.projectId
      )
        return state;
      return {
        ...state,
        bulkArchive: { projectId: action.projectId, targets: action.targets.slice() },
      };
    case 'CLOSE_BULK_ARCHIVE':
      return { ...state, bulkArchive: null };
    case 'OPEN_OPERATION':
      if (state.operation !== null) return state;
      return {
        ...state,
        operation: {
          id: action.operationId,
          kind: action.kind,
          projectId: action.projectId,
          saving: false,
        },
        dialog: action.dialog ?? null,
      };
    case 'SAVE_STARTED':
    case 'SAVE_FAILED':
      if (state.operation?.id !== action.operationId) return state;
      return {
        ...state,
        operation: { ...state.operation, saving: action.type === 'SAVE_STARTED' },
      };
    case 'OPERATION_FINISHED':
    case 'OPERATION_CANCELLED':
      if (state.operation?.id !== action.operationId) return state;
      return finishOperation(state);
    case 'CARD_REMOVED': {
      const cleared: SessionState =
        state.activeProjectId === action.projectId && state.selectedId === action.cardId
          ? { ...state, selectedId: null }
          : state;
      const archiveCleared =
        cleared.activeProjectId === action.projectId && cleared.archiveSelectedId === action.cardId
          ? { ...cleared, archiveSelectedId: null }
          : cleared;
      return archiveCleared.operation?.id === action.operationId
        ? finishOperation(archiveCleared)
        : archiveCleared;
    }
    case 'ANSWER_LEASE_STARTED':
      if (
        state.answerLeases.some(
          (lease) => lease.key === action.key && lease.projectId === action.projectId,
        )
      )
        return state;
      return {
        ...state,
        answerLeases: [...state.answerLeases, { key: action.key, projectId: action.projectId }],
      };
    case 'ANSWER_LEASE_ENDED':
      return finishAnswerLease(state, action.key, action.projectId);
  }
}

/** What a form or confirmation reports to the app, so the project cannot change under it. */
export interface OperationControls {
  /** Registers an operation that started in `projectId`; returns its ID. */
  begin: (kind: OperationKind, projectId: ProjectId, dialog?: DialogAction) => number;
  saveStarted: (operationId: number) => void;
  saveFailed: (operationId: number) => void;
  /** The operation finished or was cancelled. */
  end: (operationId: number) => void;
  cardRemoved: (operationId: number, projectId: ProjectId, cardId: number) => void;
  isCurrent?: (operationId: number, projectId: ProjectId) => boolean;
}

/** For a part used on its own, where no project switch needs protecting. */
export const noOperations: OperationControls = {
  begin: () => 0,
  saveStarted: () => {},
  saveFailed: () => {},
  end: () => {},
  cardRemoved: () => {},
};

/** A project ID is 32 lowercase hexadecimal digits; anything else is an invalid URL value. */
export function isProjectId(value: string | null): value is ProjectId {
  return value !== null && /^[0-9a-f]{32}$/.test(value);
}
