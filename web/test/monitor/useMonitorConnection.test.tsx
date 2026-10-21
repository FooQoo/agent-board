import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorClientError } from '../../src/pages/monitor/client';
import { useMonitorConnection } from '../../src/pages/monitor/hooks/useMonitorConnection';

const visibility = (value: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });

const redirect = () => new MonitorClientError('sign in', 0, 'auth_redirect');
const offline = () => new MonitorClientError('offline', 0, 'network_error');
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  visibility('visible');
});
afterEach(() => {
  vi.useRealTimers();
  visibility('visible');
});

describe('useMonitorConnection', () => {
  it('is ready at once for a page that has a token (no session)', () => {
    const openSession = vi.fn();
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => false, openSession }),
    );
    expect(result.current.state).toEqual({ status: 'ready' });
    expect(openSession).not.toHaveBeenCalled();
  });

  it('shows nothing until the session is confirmed, then is ready', async () => {
    const openSession = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    expect(result.current.state).toEqual({ status: 'checking' });
    await flush();
    expect(result.current.state).toEqual({ status: 'ready' });
  });

  it('asks for Google once, without a message, when the Edge sends the sign-in page', async () => {
    const openSession = vi.fn().mockRejectedValue(redirect());
    const navigate = vi.fn();
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession, navigate }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'needs_google', failure: null });
    act(() => vi.advanceTimersByTime(120_000));
    expect(openSession).toHaveBeenCalledTimes(1); // no automatic sign-in loop
    expect(navigate).not.toHaveBeenCalled();
    act(() => result.current.connect());
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(result.current.opening).toBe(true);
  });

  it('retries a network failure, then offers the action after three failures', async () => {
    const openSession = vi.fn().mockRejectedValue(offline());
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'reconnecting' });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.state).toEqual({ status: 'reconnecting' });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.state).toEqual({ status: 'needs_google', failure: 'unreachable' });
    openSession.mockResolvedValue({});
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.state).toEqual({ status: 'ready' });
  });

  it('shows a stopped or no longer allowed connection', async () => {
    const openSession = vi.fn().mockRejectedValue(new MonitorClientError('no', 403, 'unavailable'));
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'needs_google', failure: 'unavailable' });
  });

  it('pauses retries while hidden and checks again when visible', async () => {
    const openSession = vi.fn().mockRejectedValue(offline());
    renderHook(() => useMonitorConnection({ usesSession: () => true, openSession }));
    await flush();
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(openSession).toHaveBeenCalledTimes(1);
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(openSession).toHaveBeenCalledTimes(2);
  });
});
