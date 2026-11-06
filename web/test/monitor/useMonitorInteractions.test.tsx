import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnswerFormState } from '../../src/features/tasks/answer/model/answer';

import { useMonitorInteractions } from '../../src/pages/monitor/hooks/useMonitorInteractions';
import { PROJECT_A, makeTask } from '../fixtures';

const item = (
  task = makeTask({ id: 3, taskStatus: 'todo', agentStatus: 'pending', pendingRequestId: 'r1' }),
) => ({
  projectId: PROJECT_A.id,
  projectName: PROJECT_A.name,
  task,
});

describe('useMonitorInteractions', () => {
  it('locks the scope only while an answer with input is open or sending, and keeps the draft after closing', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const key = `${PROJECT_A.id}:3:r1` as const;
    act(() => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text: 'Keep this answer' }));
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.hasDraft(PROJECT_A.id, 3)).toBe(true);
    expect(result.current.hasAnyDraft()).toBe(true);

    act(() => result.current.setAnswerOpen(PROJECT_A.id, 3, true));
    expect(result.current.locked).toBe(true);

    act(() => result.current.setAnswerOpen(PROJECT_A.id, 3, false));
    expect(result.current.locked).toBe(false);
    expect(result.current.stateStore.getSnapshot(key)?.text).toBe('Keep this answer');
    expect(result.current.hasDraft(PROJECT_A.id, 3)).toBe(true);
    expect(result.current.hasDraft(PROJECT_A.id, 4)).toBe(false);
    expect(result.current.hasAnyDraft()).toBe(true);

    act(() => result.current.stateStore.update(key, (state) => ({ ...state, text: '' })));
    expect(result.current.hasAnyDraft()).toBe(false);
  });

  it('does not lock an open answer without input', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    act(() => result.current.setAnswerOpen(PROJECT_A.id, 3, true));
    expect(result.current.locked).toBe(false);
  });

  it('holds the scope for the send operation and releases it when the send ends', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const operations = result.current.operationsFor(PROJECT_A.id, 3, 'r1');
    let operationId = 0;
    act(() => {
      operationId = operations.begin('answer', PROJECT_A.id);
    });
    expect(result.current.locked).toBe(true);
    let reusedId = 0;
    act(() => {
      reusedId = result.current.operationsFor(PROJECT_A.id, 3, 'r1').begin('answer', PROJECT_A.id);
    });
    expect(reusedId).toBe(operationId);
    act(() => operations.end(operationId));
    expect(result.current.locked).toBe(false);
  });

  it('gives a changed request the old note with a warning and keeps the old draft until cleared', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const oldKey = `${PROJECT_A.id}:3:r1` as const;
    const nextKey = `${PROJECT_A.id}:3:r2` as const;
    act(() => {
      result.current.stateStore.getSnapshot(oldKey);
      result.current.stateStore.update(oldKey, (state) => ({
        ...state,
        choiceId: 'a',
        text: 'Old answer',
      }));
    });
    let next: AnswerFormState | null = null;
    act(() => {
      next = result.current.stateStore.getSnapshot(nextKey);
    });
    // The option is dropped; the note stays.
    expect(next).toMatchObject({
      text: 'Old answer',
      choiceId: null,
      requestChanged: true,
      baseRequestId: 'r2',
    });
    expect(result.current.orphanDrafts([]).map((draft) => draft.key)).toEqual([oldKey, nextKey]);
    act(() =>
      result.current.stateStore.update(nextKey, (state) => ({ ...state, requestChanged: false })),
    );
    expect(result.current.orphanDrafts([]).map((draft) => draft.key)).toEqual([nextKey]);
    expect(result.current.locked).toBe(false);
  });

  it('records successful answers so an old pending snapshot cannot offer a duplicate send, then adopts fresh data', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const old = item();
    const answered = makeTask({
      id: 3,
      taskStatus: 'todo',
      agentStatus: 'idle',
      pendingRequestId: null,
    });
    act(() => result.current.onAnswered(old, 'r1', { task: answered, changed: true }));
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    expect(result.current.tasksWithSavedAnswers([old], false)[0]?.task.pendingRequestId).toBeNull();
    act(() => result.current.tasksWithSavedAnswers([item(answered)], true));
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(false);
  });

  it.each(['todo', 'doing'] as const)(
    'uses the same response controller for a pending task in %s',
    async (status) => {
      const writeAnswer = vi.fn(async (_projectId, _taskId, _input) => ({
        task: makeTask({ id: 3, taskStatus: status, agentStatus: 'idle', pendingRequestId: null }),
        changed: true,
      }));
      const { result } = renderHook(() => useMonitorInteractions({ writeAnswer }));
      const original = item(
        makeTask({ id: 3, taskStatus: status, agentStatus: 'pending', pendingRequestId: 'r1' }),
      );
      await act(async () => {
        const data = await result.current.writeAnswer(original.projectId, original.task.id, {
          requestId: 'r1',
          text: 'Confirmed',
        });
        result.current.onAnswered(original, 'r1', data);
      });
      expect(writeAnswer).toHaveBeenCalledWith(PROJECT_A.id, 3, {
        requestId: 'r1',
        text: 'Confirmed',
      });
      expect(result.current.tasksWithSavedAnswers([original], false)[0]?.task.taskStatus).toBe(
        status,
      );
      expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    },
  );
});

describe('stale monitor answer drafts', () => {
  it('keeps an orphaned draft visible and counted as a draft until the user discards it', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const key = `${PROJECT_A.id}:3:r1` as const;
    act(() => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({
        ...state,
        choiceId: 'approve',
        text: 'Retain me',
      }));
    });
    const drafts = result.current.orphanDrafts([]);
    expect(drafts).toEqual([
      { key, projectName: '—', taskId: 3, text: 'Retain me', choiceId: 'approve' },
    ]);
    expect(result.current.hasAnyDraft()).toBe(true);
    act(() => result.current.clearOrphanDraft(key));
    expect(result.current.hasAnyDraft()).toBe(false);
    expect(result.current.orphanDrafts([])).toEqual([]);
  });

  it('clears retained answer input when a task moves to Done', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const key = `${PROJECT_A.id}:3:r1` as const;
    act(() => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text: 'Discard on done' }));
    });
    act(() =>
      result.current.reconcileTasks([
        item(makeTask({ id: 3, taskStatus: 'done', agentStatus: 'idle', pendingRequestId: null })),
      ]),
    );
    expect(result.current.locked).toBe(false);
    expect(result.current.stateStore.getSnapshot(key)?.text).toBe('');
  });

  it('keeps a request_changed ID blocked after the stale form is cleared', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    act(() => result.current.markRequestStale(PROJECT_A.id, 3, 'r1'));
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r2')).toBe(false);
  });
});

describe('late mobile answer responses', () => {
  it('does not restore an answer or draft after the task is observed in Done', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const pending = item(
      makeTask({ id: 3, taskStatus: 'doing', agentStatus: 'pending', pendingRequestId: 'r1' }),
    );
    const done = item(
      makeTask({ id: 3, taskStatus: 'done', agentStatus: 'idle', pendingRequestId: null }),
    );
    act(() => {
      const key = `${PROJECT_A.id}:3:r1` as const;
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text: 'Late response' }));
      result.current.reconcileTasks([done]);
      result.current.onAnswered(pending, 'r1', {
        task: makeTask({ id: 3, taskStatus: 'todo', agentStatus: 'idle', pendingRequestId: null }),
        changed: true,
      });
    });
    expect(result.current.tasksWithSavedAnswers([pending], false)[0]?.task.taskStatus).toBe(
      'doing',
    );
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    expect(result.current.locked).toBe(false);
  });
});
