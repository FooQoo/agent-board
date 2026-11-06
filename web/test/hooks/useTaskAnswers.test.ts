import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTaskAnswers } from '../../src/features/tasks/answer/model/useTaskAnswers';
import type { AnswerResult } from '../../src/features/tasks/answer/model/answer';
import { makeTask, PROJECT_A } from '../fixtures';

const requestId = 'request-123';
const pending = makeTask({
  id: 123,
  taskStatus: 'todo',
  agentStatus: 'pending',
  pendingRequestId: requestId,
  pendingReason: 'Choose a direction',
});
const answered = {
  ...pending,
  agentStatus: 'idle' as const,
  pendingRequestId: null,
  pendingReason: null,
};

describe('useCardAnswers', () => {
  it('keeps an answer receipt visible until a newer board snapshot contains it', () => {
    const { result } = renderHook(() => useTaskAnswers(vi.fn()));
    const syncBeforeAnswer = new Date('2026-10-12T01:00:00Z');
    const syncAfterAnswer = new Date('2026-10-12T01:01:00Z');
    const response: AnswerResult = { task: answered, changed: true };

    act(() =>
      result.current.onAnswered(PROJECT_A.id, pending.id, requestId, response, syncBeforeAnswer),
    );

    expect(result.current.withSavedAnswers(PROJECT_A.id, [pending], syncBeforeAnswer)[0]).toEqual(
      answered,
    );
    expect(result.current.withSavedAnswers(PROJECT_A.id, [answered], syncAfterAnswer)[0]).toEqual(
      answered,
    );
  });

  it('holds a lease for an open draft and clears its draft and stale request when the task reaches Done', () => {
    const onLeaseChange = vi.fn();
    const { result } = renderHook(() => useTaskAnswers(onLeaseChange));
    const key = `${PROJECT_A.id}:${pending.id}:${requestId}` as const;

    act(() => {
      result.current.setAnswerOpen(PROJECT_A.id, pending.id, true);
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, choiceId: 'yes' }));
    });
    expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, true);

    act(() => result.current.reconcileTasks(PROJECT_A.id, [{ ...pending, taskStatus: 'done' }]));

    expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, false);
    expect(result.current.wasAnswered(PROJECT_A.id, pending.id, requestId)).toBe(true);
    expect(result.current.stateStore.getSnapshot(key)?.choiceId).toBeNull();
  });

  it('keeps old text for a changed request and transfers the lease only after the user edits it', () => {
    const onLeaseChange = vi.fn();
    const { result } = renderHook(() => useTaskAnswers(onLeaseChange));
    const oldKey = `${PROJECT_A.id}:${pending.id}:${requestId}` as const;
    const newKey = `${PROJECT_A.id}:${pending.id}:request-456` as const;

    act(() => {
      result.current.setAnswerOpen(PROJECT_A.id, pending.id, true);
      result.current.stateStore.getSnapshot(oldKey);
      result.current.stateStore.update(oldKey, (state) => ({ ...state, text: 'Keep this answer' }));
      result.current.stateStore.getSnapshot(newKey);
    });
    expect(result.current.stateStore.getSnapshot(newKey)).toMatchObject({
      text: 'Keep this answer',
      requestChanged: true,
    });

    act(() => {
      result.current.stateStore.update(newKey, (state) => ({
        ...state,
        text: 'Keep this answer for the new request',
        requestChanged: false,
      }));
    });
    expect(onLeaseChange).toHaveBeenLastCalledWith(newKey, PROJECT_A.id, true);
    expect(onLeaseChange).toHaveBeenCalledWith(oldKey, PROJECT_A.id, false);
  });

  describe('answer open state and retained drafts', () => {
    const key = `${PROJECT_A.id}:${pending.id}:${requestId}` as const;
    const type = (result: { current: ReturnType<typeof useTaskAnswers> }, text = 'draft') => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text }));
    };

    it('holds no lease while the answer is closed, even with input', () => {
      const onLeaseChange = vi.fn();
      const { result } = renderHook(() => useTaskAnswers(onLeaseChange));
      act(() => type(result));
      expect(onLeaseChange).not.toHaveBeenCalled();
      expect(result.current.hasDraft(PROJECT_A.id, pending.id)).toBe(true);
      expect(result.current.hasAnyDraft()).toBe(true);
    });

    it('takes the lease on open with input and releases it on close while keeping the draft', () => {
      const onLeaseChange = vi.fn();
      const { result } = renderHook(() => useTaskAnswers(onLeaseChange));
      act(() => type(result));
      act(() => result.current.setAnswerOpen(PROJECT_A.id, pending.id, true));
      expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, true);
      act(() => result.current.setAnswerOpen(PROJECT_A.id, pending.id, false));
      expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, false);
      expect(result.current.stateStore.getSnapshot(key)?.text).toBe('draft');
      expect(result.current.hasDraft(PROJECT_A.id, pending.id)).toBe(true);
      expect(onLeaseChange).toHaveBeenCalledTimes(2);
    });

    it('does not lease an open answer without input and leases once input appears', () => {
      const onLeaseChange = vi.fn();
      const { result } = renderHook(() => useTaskAnswers(onLeaseChange));
      act(() => result.current.setAnswerOpen(PROJECT_A.id, pending.id, true));
      expect(onLeaseChange).not.toHaveBeenCalled();
      act(() => type(result));
      expect(onLeaseChange).toHaveBeenCalledTimes(1);
      expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, true);
      act(() => type(result, ''));
      expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, false);
    });

    it('keeps the lease while sending even after the answer is closed', () => {
      const onLeaseChange = vi.fn();
      const { result } = renderHook(() => useTaskAnswers(onLeaseChange));
      act(() => {
        result.current.setAnswerOpen(PROJECT_A.id, pending.id, true);
        result.current.stateStore.getSnapshot(key);
        result.current.stateStore.update(key, (state) => ({ ...state, phase: 'sending' }));
      });
      expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, true);
      act(() => result.current.setAnswerOpen(PROJECT_A.id, pending.id, false));
      expect(onLeaseChange).toHaveBeenCalledTimes(1);
      act(() =>
        result.current.stateStore.update(key, (state) => ({
          ...state,
          phase: 'editing',
          text: '',
        })),
      );
      expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, false);
    });

    it('counts a draft left for an older request and reports no draft for other tasks', () => {
      const { result } = renderHook(() => useTaskAnswers(vi.fn()));
      act(() => type(result));
      expect(result.current.hasDraft(PROJECT_A.id, pending.id)).toBe(true);
      expect(result.current.hasDraft(PROJECT_A.id, pending.id + 1)).toBe(false);
      act(() => result.current.reconcileTasks(PROJECT_A.id, [{ ...pending, taskStatus: 'done' }]));
      expect(result.current.hasDraft(PROJECT_A.id, pending.id)).toBe(false);
      expect(result.current.hasAnyDraft()).toBe(false);
    });
  });
});
