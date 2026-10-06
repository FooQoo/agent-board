import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardEvents } from '../../src/hooks/useBoardEvents';
import { FakeEventSource } from '../fakes';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBoardEvents', () => {
  it('opens one stream at /api/events', () => {
    renderHook(() => useBoardEvents(() => {}));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest.url).toBe('/api/events');
  });

  it('refreshes on every ready and changed event', () => {
    const onRefresh = vi.fn();
    renderHook(() => useBoardEvents(onRefresh));
    act(() => FakeEventSource.latest.emit('ready'));
    act(() => FakeEventSource.latest.emit('changed'));
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('calls the latest callback without reopening the stream', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useBoardEvents(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });
    act(() => FakeEventSource.latest.emit('changed'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('reports the stream as down on error and up again on the next ready', () => {
    const { result } = renderHook(() => useBoardEvents(() => {}));
    expect(result.current.streamDown).toBe(false);
    act(() => FakeEventSource.latest.emit('error'));
    expect(result.current.streamDown).toBe(true);
    act(() => FakeEventSource.latest.emit('ready'));
    expect(result.current.streamDown).toBe(false);
  });

  it('closes the stream when unmounted, and every StrictMode stream but the last', () => {
    const { unmount } = renderHook(() => useBoardEvents(() => {}), { wrapper: StrictMode });
    const open = FakeEventSource.instances.filter((source) => !source.closed);
    expect(open).toHaveLength(1);
    unmount();
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
  });
});
