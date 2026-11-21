import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLaneMove } from './useLaneMove';

function setup(write: (id: number, to: string, from: string) => Promise<unknown>) {
  const calls: string[] = [];
  const hook = renderHook(() =>
    useLaneMove({
      write: (id, to, from) => {
        calls.push(`write ${id} ${from}>${to}`);
        return write(id, to, from);
      },
      apply: (id, to) => calls.push(`apply ${id} ${to}`),
      revert: (id) => calls.push(`revert ${id}`),
      onDone: () => calls.push('done'),
      notify: (message) => calls.push(`notify ${message}`),
      refusal: (cause) => `refused: ${(cause as Error).message}`,
    }),
  );
  return { move: hook.result.current, calls };
}

describe('useLaneMove', () => {
  it('shows the card in the target lane before the server answers, then reads again', async () => {
    let answer: () => void = () => {};
    const { move, calls } = setup(() => new Promise<void>((resolve) => (answer = resolve)));
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = move(7, 'todo', 'doing');
    });
    expect(calls).toEqual(['apply 7 doing', 'write 7 todo>doing']);
    await act(async () => {
      answer();
      await done;
    });
    expect(calls).toEqual(['apply 7 doing', 'write 7 todo>doing', 'done']);
  });

  it('puts the card back and says why when the server refuses', async () => {
    const { move, calls } = setup(() => Promise.reject(new Error('no')));
    await act(() => move(7, 'doing', 'done'));
    expect(calls).toEqual([
      'apply 7 done',
      'write 7 doing>done',
      'revert 7',
      'notify refused: no',
      'done',
    ]);
  });

  it('ignores a move to the same lane and a second move of a card still on its way', async () => {
    const write = vi.fn(() => new Promise<void>(() => {}));
    const { move, calls } = setup(write);
    await act(() => move(7, 'todo', 'todo'));
    expect(calls).toEqual([]);
    act(() => {
      void move(7, 'todo', 'doing');
      void move(7, 'doing', 'done');
    });
    expect(write).toHaveBeenCalledTimes(1);
  });
});
