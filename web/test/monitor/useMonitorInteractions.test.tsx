import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMonitorInteractions } from '../../src/pages/monitor/hooks/useMonitorInteractions';
import { PROJECT_A } from '../fixtures';

const question = { id: 'Q-1', title: 'Which one?', referencedBy: [1] };

describe('useMonitorInteractions', () => {
  it('keeps the answers for the life of the page and reports them as held', () => {
    const { result, rerender } = renderHook(() => useMonitorInteractions());
    const { book } = result.current;
    expect(result.current.held).toBe(false);
    act(() => {
      book.reconcile(PROJECT_A.id, [question]);
      book.setText(PROJECT_A.id, 'Q-1', 'Go with A');
    });
    rerender();
    expect(result.current.book).toBe(book);
    expect(result.current.held).toBe(true);
    expect(result.current.sending).toBe(false);
  });

  it('reports a send on its way until it ends', async () => {
    const { result } = renderHook(() => useMonitorInteractions());
    const { book } = result.current;
    act(() => {
      book.reconcile(PROJECT_A.id, [question]);
      book.setText(PROJECT_A.id, 'Q-1', 'Go with A');
    });
    let finish = () => {};
    let sent: Promise<boolean> = Promise.resolve(false);
    act(() => {
      sent = book.send(
        PROJECT_A.id,
        () => new Promise<void>((resolve) => (finish = resolve)),
        () => 'failed',
      );
    });
    expect(result.current.sending).toBe(true);
    await act(async () => {
      finish();
      await sent;
    });
    expect(result.current.sending).toBe(false);
    expect(result.current.held).toBe(false);
  });
});
