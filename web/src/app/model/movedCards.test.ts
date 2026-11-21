import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeTask } from '../../../.storybook/support/fixtures';
import type { TaskSummary } from '../../shared/api/contracts';
import { type MovedCards, markSettled, settleMoved, showMoved } from './movedCards';
import { useMovedCards } from './useMovedCards';

const card = (taskStatus: TaskSummary['taskStatus']): TaskSummary[] => [
  makeTask({ id: 1, taskStatus }) as TaskSummary,
];

describe('moved cards', () => {
  it('keeps the card in the target lane against a read that predates the save', () => {
    const before = card('todo');
    let moved: MovedCards = new Map([[1, { to: 'doing' as const, settledAt: null }]]);
    // In flight: any read, even one that shows another lane, leaves the entry.
    expect(settleMoved(moved, card('done'))).toBe(moved);
    expect(showMoved(before, moved)[0]?.taskStatus).toBe('doing');
    // Accepted: the read seen then is still the old one.
    moved = markSettled(moved, 1, before);
    expect(settleMoved(moved, before)).toBe(moved);
  });

  it('lets a newer read win whatever lane it shows once the save was accepted', () => {
    const before = card('todo');
    const moved = markSettled(new Map([[1, { to: 'doing' as const, settledAt: null }]]), 1, before);
    expect(settleMoved(moved, card('done')).size).toBe(0);
    expect(settleMoved(moved, card('doing')).size).toBe(0);
  });

  it('ends at once when the card reads in the target lane, or is gone', () => {
    const moved = new Map([[1, { to: 'doing' as const, settledAt: null }]]);
    expect(settleMoved(moved, card('doing')).size).toBe(0);
    expect(settleMoved(moved, []).size).toBe(0);
  });

  it('works through the hook: save, older read, newer read in another lane, and a refusal', () => {
    const old = card('todo');
    const { result, rerender } = renderHook(({ read }) => useMovedCards(read), {
      initialProps: { read: old },
    });
    act(() => result.current.moveCard(1, 'doing'));
    expect(result.current.tasks[0]?.taskStatus).toBe('doing');
    act(() => result.current.settleCard(1));
    rerender({ read: old });
    expect(result.current.tasks[0]?.taskStatus).toBe('doing');
    rerender({ read: card('done') });
    expect(result.current.tasks[0]?.taskStatus).toBe('done');
    act(() => result.current.moveCard(1, 'todo'));
    expect(result.current.tasks[0]?.taskStatus).toBe('todo');
    act(() => result.current.unmoveCard(1));
    expect(result.current.tasks[0]?.taskStatus).toBe('done');
  });
});
