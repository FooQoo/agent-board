import { describe, expect, it } from 'vitest';
import {
  initSession,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from '../src/app/model/projectSession';
import type { AnswerFormKey } from '../src/features/tasks/answer/model/answer';
import { makeTask } from './fixtures';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);

function run(state: SessionState, ...actions: SessionAction[]): SessionState {
  return actions.reduce(sessionReducer, state);
}

const open = (operationId: number, projectId = A, kind: 'create' | 'move' = 'create') =>
  ({
    type: 'OPEN_OPERATION',
    operationId,
    kind,
    projectId,
    dialog: { kind: 'create' },
  }) as const;

describe('sessionReducer: switching without an operation', () => {
  it('applies the requested project and clears the selection and the dialog in one step', () => {
    const state = run(initSession(A, 8), { type: 'URL_REQUESTED', projectId: B });
    expect(state.activeProjectId).toBe(B);
    expect(state.selectedId).toBeNull();
    expect(state.dialog).toBeNull();
    expect(state.pendingTarget).toBeNull();
  });

  it('keeps the selection when the requested project is already active', () => {
    const state = run(initSession(A, 8), { type: 'URL_REQUESTED', projectId: A });
    expect(state.activeProjectId).toBe(A);
    expect(state.selectedId).toBe(8);
  });

  it('keeps a selection preset before any project was shown, and clears it when leaving a project', () => {
    expect(run(initSession(null, 11), { type: 'URL_REQUESTED', projectId: A }).selectedId).toBe(11);
    expect(run(initSession(A, 11), { type: 'URL_REQUESTED', projectId: null })).toMatchObject({
      activeProjectId: null,
      selectedId: null,
    });
  });

  it('does not carry a task number of one project into another with the same number', () => {
    const state = run(
      initSession(A),
      { type: 'SELECT_CARD', id: 8 },
      { type: 'URL_REQUESTED', projectId: B },
    );
    expect(state.selectedId).toBeNull();
  });
});

describe('sessionReducer: operations hold the switch', () => {
  it('records the project the operation started in and the dialog', () => {
    const state = run(initSession(A), open(1));
    expect(state.operation).toEqual({ id: 1, kind: 'create', projectId: A, saving: false });
    expect(state.dialog).toEqual({ kind: 'create' });
  });

  it('refuses to open a second operation while one is open', () => {
    const state = run(initSession(A), open(1), open(2, A, 'move'));
    expect(state.operation?.id).toBe(1);
  });

  it('keeps the board, selection and dialog and holds only the latest request', () => {
    const state = run(
      initSession(A, 8),
      open(1),
      { type: 'URL_REQUESTED', projectId: B },
      { type: 'URL_REQUESTED', projectId: C },
    );
    expect(state.activeProjectId).toBe(A);
    expect(state.selectedId).toBe(8);
    expect(state.dialog).toEqual({ kind: 'create' });
    expect(state.operation?.projectId).toBe(A);
    expect(state.pendingTarget).toEqual({ projectId: C });
  });

  it('drops the pending request when the URL comes back to the active project', () => {
    const state = run(
      initSession(A),
      open(1),
      { type: 'URL_REQUESTED', projectId: B },
      { type: 'URL_REQUESTED', projectId: A },
    );
    expect(state.pendingTarget).toBeNull();
  });

  it('tells a pending request for no project apart from no pending request', () => {
    const none = run(initSession(A), open(1));
    expect(none.pendingTarget).toBeNull();
    const nullRequest = run(none, { type: 'URL_REQUESTED', projectId: null });
    expect(nullRequest.pendingTarget).toEqual({ projectId: null });
    const finished = run(nullRequest, { type: 'OPERATION_FINISHED', operationId: 1 });
    expect(finished.activeProjectId).toBeNull();
  });

  it.each(['OPERATION_FINISHED', 'OPERATION_CANCELLED'] as const)(
    'applies the pending request on %s, clears the selection and adds nothing else',
    (type) => {
      const state = run(
        initSession(A, 8),
        open(1),
        { type: 'URL_REQUESTED', projectId: B },
        { type, operationId: 1 },
      );
      expect(state).toEqual({
        activeProjectId: B,
        selectedId: null,
        viewMode: 'board',
        archiveSelectedId: null,
        epicSelectedId: null,
        bulkArchive: null,
        dialog: null,
        operation: null,
        pendingTarget: null,
        answerLeases: [],
      });
    },
  );

  it('holds a URL switch until every answer draft lease and modal operation has ended', () => {
    const keyA = `${A}:12:req-a` as AnswerFormKey;
    const keyB = `${A}:13:req-b` as AnswerFormKey;
    const held = run(
      initSession(A, 12),
      { type: 'ANSWER_LEASE_STARTED', key: keyA, projectId: A },
      { type: 'ANSWER_LEASE_STARTED', key: keyB, projectId: A },
      { type: 'URL_REQUESTED', projectId: B },
      open(1, A, 'move'),
      { type: 'OPERATION_FINISHED', operationId: 1 },
    );
    expect(held.activeProjectId).toBe(A);
    expect(held.pendingTarget).toEqual({ projectId: B });
    const oneDraftLeft = run(held, { type: 'ANSWER_LEASE_ENDED', key: keyA, projectId: A });
    expect(oneDraftLeft.activeProjectId).toBe(A);
    const switched = run(oneDraftLeft, { type: 'ANSWER_LEASE_ENDED', key: keyB, projectId: A });
    expect(switched.activeProjectId).toBe(B);
    expect(switched.answerLeases).toEqual([]);
  });

  it('keeps the selection when an operation ends without a pending request', () => {
    const state = run(initSession(A, 8), open(1), { type: 'OPERATION_CANCELLED', operationId: 1 });
    expect(state.selectedId).toBe(8);
    expect(state.operation).toBeNull();
    expect(state.dialog).toBeNull();
  });

  it('ignores a late finish of an older operation', () => {
    const state = run(
      initSession(A),
      open(1),
      { type: 'OPERATION_FINISHED', operationId: 1 },
      open(2, A, 'move'),
      { type: 'URL_REQUESTED', projectId: B },
      { type: 'OPERATION_FINISHED', operationId: 1 },
      { type: 'OPERATION_CANCELLED', operationId: 1 },
    );
    expect(state.operation?.id).toBe(2);
    expect(state.activeProjectId).toBe(A);
    expect(state.pendingTarget).toEqual({ projectId: B });
  });
});

describe('sessionReducer: saving', () => {
  it('marks the operation as saving and keeps everything on failure', () => {
    const base = run(initSession(A, 8), open(1), { type: 'URL_REQUESTED', projectId: B });
    const saving = run(base, { type: 'SAVE_STARTED', operationId: 1 });
    expect(saving.operation?.saving).toBe(true);
    const failed = run(saving, { type: 'SAVE_FAILED', operationId: 1 });
    expect(failed.operation).toEqual({ id: 1, kind: 'create', projectId: A, saving: false });
    expect(failed.activeProjectId).toBe(A);
    expect(failed.dialog).toEqual({ kind: 'create' });
    expect(failed.pendingTarget).toEqual({ projectId: B });
    expect(failed.selectedId).toBe(8);
  });

  it('ignores save events of another operation', () => {
    const state = run(initSession(A), open(2), { type: 'SAVE_STARTED', operationId: 1 });
    expect(state.operation?.saving).toBe(false);
    const saving = run(
      state,
      { type: 'SAVE_STARTED', operationId: 2 },
      { type: 'SAVE_FAILED', operationId: 1 },
    );
    expect(saving.operation?.saving).toBe(true);
  });
});

describe('sessionReducer: removed tasks', () => {
  const task = makeTask({ id: 8 });

  it('clears the selection of the deleted task, finishes the operation and applies the pending request', () => {
    const state = run(
      initSession(A, 8),
      { type: 'OPEN_OPERATION', operationId: 1, kind: 'delete', projectId: A },
      { type: 'URL_REQUESTED', projectId: B },
      { type: 'CARD_REMOVED', operationId: 1, projectId: A, taskId: task.id },
    );
    expect(state.operation).toBeNull();
    expect(state.selectedId).toBeNull();
    expect(state.activeProjectId).toBe(B);
  });

  it('clears the selection without a pending request', () => {
    const state = run(
      initSession(A, 8),
      { type: 'OPEN_OPERATION', operationId: 1, kind: 'delete', projectId: A },
      { type: 'CARD_REMOVED', operationId: 1, projectId: A, taskId: 8 },
    );
    expect(state).toMatchObject({ activeProjectId: A, selectedId: null, operation: null });
  });

  it('does not clear the selection of the same task number in another project', () => {
    const state = run(initSession(B, 8), {
      type: 'CARD_REMOVED',
      operationId: 9,
      projectId: A,
      taskId: 8,
    });
    expect(state.selectedId).toBe(8);
  });
});

describe('sessionReducer: archive view state', () => {
  it('clears the archive view and its selection when another project is applied', () => {
    const state = run(
      initSession(A),
      { type: 'SET_VIEW_MODE', mode: 'archive' },
      { type: 'SELECT_ARCHIVE_CARD', id: 8 },
      { type: 'URL_REQUESTED', projectId: B },
    );
    expect(state).toMatchObject({
      activeProjectId: B,
      viewMode: 'board',
      archiveSelectedId: null,
      bulkArchive: null,
    });
  });

  it('keeps the bulk archive target snapshot attached to its project', () => {
    const targets = [makeTask({ id: 8 })];
    const state = run(
      initSession(A),
      { type: 'OPEN_OPERATION', operationId: 1, kind: 'archive-done', projectId: A },
      { type: 'OPEN_BULK_ARCHIVE', projectId: A, targets },
    );
    targets.push(makeTask({ id: 9 }));
    expect(state.bulkArchive?.projectId).toBe(A);
    expect(state.bulkArchive?.targets.map((task) => task.id)).toEqual([8]);
  });
});

describe('sessionReducer: epic view state', () => {
  it('opens the epic view with no epic selected and keeps the card selection out of it', () => {
    const state = run(initSession(A, 8), { type: 'SET_VIEW_MODE', mode: 'epics' });
    expect(state.viewMode).toBe('epics');
    expect(state.selectedId).toBeNull();
    expect(state.epicSelectedId).toBeNull();
  });

  it('selects one epic and clears it when the same epic is selected again', () => {
    let state = run(initSession(A), { type: 'SET_VIEW_MODE', mode: 'epics' });
    state = run(state, { type: 'SELECT_EPIC', id: 'BUG' });
    expect(state.epicSelectedId).toBe('BUG');
    state = run(state, { type: 'SELECT_EPIC', id: null });
    expect(state.epicSelectedId).toBeNull();
  });

  it('clears the epic selection when leaving the epic view or switching project', () => {
    let state = run(
      initSession(A),
      { type: 'SET_VIEW_MODE', mode: 'epics' },
      { type: 'SELECT_EPIC', id: 'BUG' },
    );
    state = run(state, { type: 'SET_VIEW_MODE', mode: 'board' });
    expect(state.epicSelectedId).toBeNull();

    state = run(
      state,
      { type: 'SET_VIEW_MODE', mode: 'epics' },
      { type: 'SELECT_EPIC', id: 'BUG' },
    );
    state = run(state, { type: 'URL_REQUESTED', projectId: B });
    expect(state.epicSelectedId).toBeNull();
    expect(state.viewMode).toBe('board');
  });

  it('keeps the archive selection and the epic selection apart', () => {
    let state = run(
      initSession(A),
      { type: 'SET_VIEW_MODE', mode: 'archive' },
      { type: 'SELECT_ARCHIVE_CARD', id: 2 },
    );
    state = run(
      state,
      { type: 'SET_VIEW_MODE', mode: 'epics' },
      { type: 'SELECT_EPIC', id: 'BUG' },
    );
    expect(state.archiveSelectedId).toBeNull();
    expect(state.epicSelectedId).toBe('BUG');
  });
});
