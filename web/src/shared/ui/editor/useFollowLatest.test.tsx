import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChangeSubscription, useFollowLatest } from './useFollowLatest';

function bus() {
  const listeners = new Set<() => void>();
  const subscribe: ChangeSubscription = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return { subscribe, emit, listeners };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('useFollowLatest', () => {
  it('reads the latest at a notice while active, applies it and records the time', async () => {
    const { subscribe, emit } = bus();
    const load = vi.fn(async () => 'new');
    const apply = vi.fn();
    const { result } = renderHook(() => useFollowLatest({ subscribe, active: true, load, apply }));
    expect(result.current.updatedAt).toBeNull();
    vi.setSystemTime(new Date('2026-01-01T00:05:00Z'));
    await act(async () => emit());
    expect(apply).toHaveBeenCalledWith('new');
    expect(result.current.updatedAt).toEqual(new Date('2026-01-01T00:05:00Z'));
  });

  it('does not read while inactive, and reads again once active', async () => {
    const { subscribe, emit } = bus();
    const load = vi.fn(async () => 1);
    const apply = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => useFollowLatest({ subscribe, active, load, apply }),
      { initialProps: { active: false } },
    );
    await act(async () => emit());
    expect(load).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    rerender({ active: true });
    await act(async () => emit());
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('drops a read that finishes after the first difference', async () => {
    const { subscribe, emit } = bus();
    let resolve: (value: string | null) => void = () => {};
    const load = vi.fn(() => new Promise<string | null>((r) => (resolve = r)));
    const apply = vi.fn();
    const { result, rerender } = renderHook(
      ({ active }) => useFollowLatest({ subscribe, active, load, apply }),
      { initialProps: { active: true } },
    );
    act(() => emit());
    rerender({ active: false });
    await act(async () => resolve('late'));
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.updatedAt).toBeNull();
  });

  it('applies only the newest of overlapping reads', async () => {
    const { subscribe, emit } = bus();
    const resolvers: Array<(value: string | null) => void> = [];
    const load = vi.fn(() => new Promise<string | null>((r) => resolvers.push(r)));
    const apply = vi.fn();
    renderHook(() => useFollowLatest({ subscribe, active: true, load, apply }));
    act(() => emit());
    act(() => emit());
    await act(async () => resolvers[1]?.('second'));
    await act(async () => resolvers[0]?.('first'));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('second');
  });

  it('keeps the screen and the time when the read fails or finds nothing', async () => {
    const { subscribe, emit } = bus();
    const load = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('x'));
    const apply = vi.fn();
    const { result } = renderHook(() => useFollowLatest({ subscribe, active: true, load, apply }));
    await act(async () => emit());
    await act(async () => emit());
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.updatedAt).toBeNull();
  });

  it('uses the latest load and apply, and subscribes once', async () => {
    const { subscribe, emit, listeners } = bus();
    const apply = vi.fn();
    const { rerender } = renderHook(
      ({ tag }) => useFollowLatest({ subscribe, active: true, load: async () => tag, apply }),
      { initialProps: { tag: 'one' } },
    );
    rerender({ tag: 'two' });
    expect(listeners.size).toBe(1);
    await act(async () => emit());
    expect(apply).toHaveBeenCalledWith('two');
  });

  it('unsubscribes on unmount and works without a subscription', () => {
    const { subscribe, listeners } = bus();
    const props = { active: true, load: async () => 1, apply: vi.fn() };
    const { unmount } = renderHook(() => useFollowLatest({ subscribe, ...props }));
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
    expect(() => renderHook(() => useFollowLatest(props))).not.toThrow();
  });
});
