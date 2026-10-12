import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AnswerFormState } from '../../src/lib/answer';

import { useMonitorInteractions } from '../../src/monitor/hooks/useMonitorInteractions';
import { PROJECT_A, makeCard } from '../fixtures';

const item = (
  card = makeCard({ id: 3, cardStatus: 'todo', agentStatus: 'pending', pendingRequestId: 'r1' }),
) => ({
  projectId: PROJECT_A.id,
  projectName: PROJECT_A.name,
  card,
});

describe('useMonitorInteractions', () => {
  it('keeps draft leases across form unmounts and holds the scope until the draft is cleared', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const key = `${PROJECT_A.id}:3:r1` as const;
    const operations = result.current.operationsFor(PROJECT_A.id, 3, 'r1');
    let operationId = 0;
    act(() => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text: 'Keep this answer' }));
      operationId = operations.begin('answer', PROJECT_A.id);
      operations.end(operationId); // Simulates the card form leaving the tree during refresh.
    });
    expect(result.current.locked).toBe(true);
    expect(result.current.stateStore.getSnapshot(key)?.text).toBe('Keep this answer');
    let reusedId = 0;
    act(() => {
      reusedId = result.current.operationsFor(PROJECT_A.id, 3, 'r1').begin('answer', PROJECT_A.id);
    });
    expect(reusedId).toBe(operationId);
    act(() => {
      result.current.stateStore.update(key, (state) => ({ ...state, text: '' }));
      operations.end(operationId);
    });
    expect(result.current.locked).toBe(false);
  });

  it('gives a changed request a blank form with a warning and keeps the old draft until cleared', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const oldKey = `${PROJECT_A.id}:3:r1` as const;
    const nextKey = `${PROJECT_A.id}:3:r2` as const;
    act(() => {
      result.current.stateStore.getSnapshot(oldKey);
      result.current.stateStore.update(oldKey, (state) => ({ ...state, text: 'Old answer' }));
    });
    let next: AnswerFormState | null = null;
    act(() => {
      next = result.current.stateStore.getSnapshot(nextKey);
    });
    expect(next).toMatchObject({ text: '', requestChanged: true, baseRequestId: 'r2' });
    expect(result.current.stateStore.getSnapshot(oldKey)?.text).toBe('Old answer');
    act(() =>
      result.current.stateStore.update(nextKey, (state) => ({ ...state, requestChanged: false })),
    );
    expect(result.current.stateStore.getSnapshot(oldKey)?.text).not.toBe('Old answer');
    expect(result.current.locked).toBe(false);
  });

  it('records successful answers so an old pending snapshot cannot offer a duplicate send, then adopts fresh data', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const old = item();
    const answered = makeCard({
      id: 3,
      cardStatus: 'todo',
      agentStatus: 'idle',
      pendingRequestId: null,
    });
    act(() => result.current.onAnswered(old, 'r1', { card: answered, changed: true }));
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    expect(result.current.cardsWithSavedAnswers([old], false)[0]?.card.pendingRequestId).toBeNull();
    act(() => result.current.cardsWithSavedAnswers([item(answered)], true));
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(false);
  });

  it.each(['todo', 'doing'] as const)(
    'uses the same response controller for a pending card in %s',
    async (status) => {
      const writeAnswer = vi.fn(async (_projectId, _cardId, _input) => ({
        card: makeCard({ id: 3, cardStatus: status, agentStatus: 'idle', pendingRequestId: null }),
        changed: true,
      }));
      const { result } = renderHook(() => useMonitorInteractions({ writeAnswer }));
      const original = item(
        makeCard({ id: 3, cardStatus: status, agentStatus: 'pending', pendingRequestId: 'r1' }),
      );
      await act(async () => {
        const data = await result.current.writeAnswer(original.projectId, original.card.id, {
          requestId: 'r1',
          text: 'Confirmed',
        });
        result.current.onAnswered(original, 'r1', data);
      });
      expect(writeAnswer).toHaveBeenCalledWith(PROJECT_A.id, 3, {
        requestId: 'r1',
        text: 'Confirmed',
      });
      expect(result.current.cardsWithSavedAnswers([original], false)[0]?.card.cardStatus).toBe(
        status,
      );
      expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    },
  );
});

describe('stale monitor answer drafts', () => {
  it('keeps an orphaned draft visible and locked until the user discards it', () => {
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
      { key, projectName: '—', cardId: 3, text: 'Retain me', choiceId: 'approve' },
    ]);
    expect(result.current.locked).toBe(true);
    act(() => result.current.clearOrphanDraft(key));
    expect(result.current.locked).toBe(false);
    expect(result.current.orphanDrafts([])).toEqual([]);
  });

  it('clears retained answer input when a card moves to Done', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const key = `${PROJECT_A.id}:3:r1` as const;
    act(() => {
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text: 'Discard on done' }));
    });
    act(() =>
      result.current.reconcileCards([
        item(makeCard({ id: 3, cardStatus: 'done', agentStatus: 'idle', pendingRequestId: null })),
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
  it('does not restore an answer or draft after the card is observed in Done', () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const pending = item(
      makeCard({ id: 3, cardStatus: 'doing', agentStatus: 'pending', pendingRequestId: 'r1' }),
    );
    const done = item(
      makeCard({ id: 3, cardStatus: 'done', agentStatus: 'idle', pendingRequestId: null }),
    );
    act(() => {
      const key = `${PROJECT_A.id}:3:r1` as const;
      result.current.stateStore.getSnapshot(key);
      result.current.stateStore.update(key, (state) => ({ ...state, text: 'Late response' }));
      result.current.reconcileCards([done]);
      result.current.onAnswered(pending, 'r1', {
        card: makeCard({ id: 3, cardStatus: 'todo', agentStatus: 'idle', pendingRequestId: null }),
        changed: true,
      });
    });
    expect(result.current.cardsWithSavedAnswers([pending], false)[0]?.card.cardStatus).toBe(
      'doing',
    );
    expect(result.current.wasAnswered(PROJECT_A.id, 3, 'r1')).toBe(true);
    expect(result.current.locked).toBe(false);
  });
});
