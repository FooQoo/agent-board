import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardEvents } from '../../src/app/model/useBoardEvents';
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

  it('reports the build the latest ready named', () => {
    const { result } = renderHook(() => useBoardEvents(() => {}));
    expect(result.current.serverBuild).toBeNull();
    act(() => FakeEventSource.latest.emit('ready', '{"build":"0123456789abcdef"}'));
    expect(result.current.serverBuild).toBe('0123456789abcdef');
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

  it('applies a preferences event at once and does not refresh the board', () => {
    const onRefresh = vi.fn();
    renderHook(() => useBoardEvents(onRefresh));
    act(() =>
      FakeEventSource.latest.emit(
        'preferences',
        JSON.stringify({ locale: 'en', theme: { mode: 'dark', accent: 'red' }, revision: 2 }),
      ),
    );
    expect(document.documentElement.dataset.accent).toBe('red');
    expect(onRefresh).not.toHaveBeenCalled();
    document.documentElement.removeAttribute('data-mode');
    document.documentElement.removeAttribute('data-accent');
    window.localStorage.clear();
  });
});
