import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCardAnswers } from '../../src/hooks/useCardAnswers';
import type { AnswerResult } from '../../src/lib/answer';
import { makeCard, PROJECT_A } from '../fixtures';

const requestId = 'request-123';
const pending = makeCard({
  id: 123,
  cardStatus: 'todo',
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
    const { result } = renderHook(() => useCardAnswers(vi.fn()));
    const syncBeforeAnswer = new Date('2026-10-12T01:00:00Z');
    const syncAfterAnswer = new Date('2026-10-12T01:01:00Z');
    const response: AnswerResult = { card: answered, changed: true };

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

  it('holds a dirty draft lease and clears its draft and stale request when the card reaches Done', () => {
    const onLeaseChange = vi.fn();
    const { result } = renderHook(() => useCardAnswers(onLeaseChange));
    const key = `${PROJECT_A.id}:${pending.id}:${requestId}` as const;

    act(() => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, choiceId: 'yes' }));
    });
    expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, true);

    act(() => result.current.reconcileCards(PROJECT_A.id, [{ ...pending, cardStatus: 'done' }]));

    expect(onLeaseChange).toHaveBeenLastCalledWith(key, PROJECT_A.id, false);
    expect(result.current.wasAnswered(PROJECT_A.id, pending.id, requestId)).toBe(true);
    expect(result.current.stateStore.getSnapshot(key)?.choiceId).toBeNull();
  });

  it('keeps old text for a changed request and transfers the lease only after the user edits it', () => {
    const onLeaseChange = vi.fn();
    const { result } = renderHook(() => useCardAnswers(onLeaseChange));
    const oldKey = `${PROJECT_A.id}:${pending.id}:${requestId}` as const;
    const newKey = `${PROJECT_A.id}:${pending.id}:request-456` as const;

    act(() => {
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
});
