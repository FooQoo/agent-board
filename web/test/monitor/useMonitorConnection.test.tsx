import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonitorClientError } from '../../src/pages/monitor/client';
import { useMonitorConnection } from '../../src/pages/monitor/hooks/useMonitorConnection';

const visibility = (value: DocumentVisibilityState) =>
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });

const passcodeNeeded = () => new MonitorClientError('passcode', 401, 'session_required');
const notTheMonitor = () => new MonitorClientError('other', 0, 'unexpected_response');
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

  it('asks for the passcode once, without a message, when there is no session', async () => {
    const openSession = vi.fn().mockRejectedValue(passcodeNeeded());
    const unlock = vi.fn();
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession, unlock }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: null });
    act(() => vi.advanceTimersByTime(120_000));
    expect(openSession).toHaveBeenCalledTimes(1); // no polling for a passcode
    expect(unlock).not.toHaveBeenCalled(); // and no passcode is ever sent on its own
  });

  it('opens the monitor when the monitor takes the passcode', async () => {
    const openSession = vi.fn().mockRejectedValue(passcodeNeeded());
    const unlock = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession, unlock }),
    );
    await flush();
    let taken = false;
    await act(async () => {
      taken = await result.current.unlock('0482');
    });
    expect(taken).toBe(true);
    expect(unlock).toHaveBeenCalledWith('0482');
    expect(result.current.state).toEqual({ status: 'ready' });
    expect(result.current.unlockFailure).toBeNull();
  });

  it('keeps asking after a wrong passcode and says nothing about how many tries are left', async () => {
    const openSession = vi.fn().mockRejectedValue(passcodeNeeded());
    const unlock = vi.fn().mockRejectedValue(new MonitorClientError('no', 403, 'unlock_failed'));
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession, unlock }),
    );
    await flush();
    let taken = true;
    await act(async () => {
      taken = await result.current.unlock('1111');
    });
    expect(taken).toBe(false);
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: null });
    expect(result.current.unlockFailure).toBe('wrong');
    // A new attempt clears the message while it is checked.
    let release: (value: unknown) => void = () => {};
    unlock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.unlock('2222');
    });
    expect(result.current.unlocking).toBe(true);
    expect(result.current.unlockFailure).toBeNull();
    // A second submit while one is in flight is ignored.
    await act(async () => {
      expect(await result.current.unlock('3333')).toBe(false);
    });
    expect(unlock).toHaveBeenCalledTimes(2);
    await act(async () => {
      release({});
      await pending;
    });
    expect(result.current.unlocking).toBe(false);
    expect(result.current.state).toEqual({ status: 'ready' });
  });

  it('tells a locked monitor, a stopped one and an unreachable one apart', async () => {
    const openSession = vi.fn().mockRejectedValue(passcodeNeeded());
    const unlock = vi.fn();
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession, unlock }),
    );
    await flush();
    const kinds: (string | null)[] = [];
    for (const cause of [
      new MonitorClientError('locked', 429, 'unlock_locked'),
      new MonitorClientError('stopped', 403, 'unavailable'),
      offline(),
      notTheMonitor(),
    ]) {
      unlock.mockRejectedValueOnce(cause);
      await act(async () => {
        await result.current.unlock('1234');
      });
      kinds.push(result.current.unlockFailure);
      expect(result.current.state.status).toBe('needs_passcode');
    }
    expect(kinds).toEqual(['locked', 'unavailable', 'unreachable', 'unreachable']);
  });

  it('asks for the passcode again when the session is lost, and says the connection ended', async () => {
    const openSession = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'ready' });
    // A read finds the session gone: the session is looked at again, and it is gone.
    openSession.mockRejectedValue(passcodeNeeded());
    const { reportAuthLoss } = await import('../../src/pages/monitor/session');
    act(() => reportAuthLoss('session_required'));
    await flush();
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: 'expired' });
  });

  it('keeps the phone on the monitor when a lost session turns out to be live', async () => {
    const openSession = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    const { reportAuthLoss } = await import('../../src/pages/monitor/session');
    act(() => reportAuthLoss('session_required'));
    await flush();
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: 'ready' });
  });

  it('does not keep checking a session that is lost again and again', async () => {
    const openSession = vi.fn().mockResolvedValue({});
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    const { reportAuthLoss } = await import('../../src/pages/monitor/session');
    for (let loss = 0; loss < 3; loss += 1) {
      act(() => reportAuthLoss('session_required'));
      await flush();
    }
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: 'expired' });
  });

  it('retries a network failure, then shows the passcode screen with the reason after three failures', async () => {
    const openSession = vi.fn().mockRejectedValue(offline());
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'reconnecting' });
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(result.current.state).toEqual({ status: 'reconnecting' });
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: 'unreachable' });
    openSession.mockResolvedValue({});
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.state).toEqual({ status: 'ready' });
  });

  it('treats an answer that is not the monitor as unreachable, never as a place to type a passcode', async () => {
    const openSession = vi.fn().mockRejectedValue(notTheMonitor());
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'reconnecting' });
  });

  it('replaces an unreachable message with the passcode prompt once the monitor answers again', async () => {
    const openSession = vi.fn().mockRejectedValue(offline());
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: 'unreachable' });
    openSession.mockRejectedValue(passcodeNeeded());
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: 'expired' });
  });

  it('shows a stopped connection', async () => {
    const openSession = vi.fn().mockRejectedValue(new MonitorClientError('no', 403, 'unavailable'));
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: 'unavailable' });
  });

  it('does not change the shown reason when the page comes back to the front', async () => {
    const openSession = vi.fn().mockRejectedValue(passcodeNeeded());
    const { result } = renderHook(() =>
      useMonitorConnection({ usesSession: () => true, openSession }),
    );
    await flush();
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: null });
    visibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(openSession).toHaveBeenCalledTimes(2);
    expect(result.current.state).toEqual({ status: 'needs_passcode', failure: null });
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
