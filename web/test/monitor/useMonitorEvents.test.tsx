import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../fakes';

const visibility = (value: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  visibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  visibility('visible');
});

describe('useMonitorEvents', () => {
  it('waits for ready and heartbeat, refreshes ready and changed, and never polls on heartbeat', async () => {
    const { result } = await import('../../src/pages/monitor/hooks/useMonitorEvents').then(
      ({ useMonitorEvents }) => renderHook(() => useMonitorEvents({ onRefresh: vi.fn() })),
    );
    expect(FakeEventSource.latest.url).toBe('/monitor/api/events');
    expect(result.current.state).toBe('connecting');
    act(() => FakeEventSource.latest.emit('open'));
    expect(result.current.state).toBe('connecting');
    expect(result.current.build).toBeNull();
    act(() => FakeEventSource.latest.emit('ready', '{"build":"0123456789abcdef"}'));
    expect(result.current.state).toBe('connected');
    expect(result.current.build).toBe('0123456789abcdef');
    act(() => FakeEventSource.latest.emit('heartbeat'));
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.state).toBe('connected');
  });

  it('drops a silent stream at 45 seconds and retries using the bounded schedule', async () => {
    const refresh = vi.fn();
    const { result } = await import('../../src/pages/monitor/hooks/useMonitorEvents').then(
      ({ useMonitorEvents }) => renderHook(() => useMonitorEvents({ onRefresh: refresh })),
    );
    act(() => FakeEventSource.latest.emit('ready'));
    act(() => vi.advanceTimersByTime(44_999));
    expect(result.current.state).toBe('connected');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.state).toBe('disconnected');
    expect(FakeEventSource.latest.closed).toBe(true);
    act(() => vi.advanceTimersByTime(999));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('stops the stream and retry timers while hidden, then refreshes and reconnects when visible', async () => {
    const refresh = vi.fn();
    const onVisibility = vi.fn();
    const { result } = await import('../../src/pages/monitor/hooks/useMonitorEvents').then(
      ({ useMonitorEvents }) =>
        renderHook(() => useMonitorEvents({ onRefresh: refresh, onVisibility })),
    );
    act(() => FakeEventSource.latest.emit('error'));
    expect(result.current.state).toBe('disconnected');
    act(() => {
      visibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(onVisibility).toHaveBeenLastCalledWith(false);
    act(() => {
      visibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(refresh).toHaveBeenCalledWith('disconnected');
    expect(onVisibility).toHaveBeenLastCalledWith(true);
    act(() => FakeEventSource.latest.emit('ready'));
    expect(refresh.mock.calls.filter(([reason]) => reason === 'ready')).toHaveLength(0);
  });

  it('coalesces duplicate visible-ready refreshes and leaves a fresh stream alone until changed', async () => {
    const refresh = vi.fn();
    const { result } = await import('../../src/pages/monitor/hooks/useMonitorEvents').then(
      ({ useMonitorEvents }) => renderHook(() => useMonitorEvents({ onRefresh: refresh })),
    );
    act(() => FakeEventSource.latest.emit('ready'));
    expect(refresh).toHaveBeenCalledWith('ready');
    act(() => FakeEventSource.latest.emit('changed'));
    act(() => FakeEventSource.latest.emit('heartbeat'));
    expect(refresh.mock.calls.map(([reason]) => reason)).toEqual(['ready', 'changed']);
    expect(result.current.state).toBe('connected');
    act(() => FakeEventSource.latest.emit('error'));
    expect(refresh).toHaveBeenLastCalledWith('disconnected');
  });

  it('applies a preferences event without refreshing the monitor', async () => {
    const onRefresh = vi.fn();
    const { useMonitorEvents } = await import('../../src/pages/monitor/hooks/useMonitorEvents');
    renderHook(() => useMonitorEvents({ onRefresh }));
    act(() => FakeEventSource.latest.emit('ready', '{"build":"0123456789abcdef"}'));
    onRefresh.mockClear();
    act(() =>
      FakeEventSource.latest.emit(
        'preferences',
        JSON.stringify({ locale: 'en', theme: { mode: 'dark', accent: 'pink' }, revision: 2 }),
      ),
    );
    expect(document.documentElement.dataset.accent).toBe('pink');
    expect(onRefresh).not.toHaveBeenCalled();
    document.documentElement.removeAttribute('data-mode');
    document.documentElement.removeAttribute('data-accent');
    window.localStorage.clear();
  });
});
