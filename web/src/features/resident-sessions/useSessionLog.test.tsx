import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionLog } from './useSessionLog';

const log = (text: string) => ({ tool: 'codex', exists: true, text, truncated: false, size: 1 });
const reply = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useSessionLog', () => {
  it('reads the log every interval and stops when the dialog unmounts', async () => {
    const fetchMock = vi.fn(async (_url: string) => reply(log('one')));
    vi.stubGlobal('fetch', fetchMock);
    const { result, unmount } = renderHook(() => useSessionLog('p1', 'codex', 2000));
    await act(async () => {});
    expect(result.current.data?.text).toBe('one');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sessions/log?tool=codex');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not start a read while the previous one is in flight', async () => {
    let release: (value: unknown) => void = () => undefined;
    const fetchMock = vi.fn(() => new Promise((resolve) => (release = resolve)));
    vi.stubGlobal('fetch', fetchMock);
    renderHook(() => useSessionLog('p1', 'codex', 2000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(reply(log('late')));
  });

  it('keeps the last tail and sets failed when a read fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(log('kept')))
      .mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useSessionLog('p1', 'codex', 2000));
    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.failed).toBe(true);
    expect(result.current.data?.text).toBe('kept');
  });

  it('reads nothing while the tab is hidden', async () => {
    const fetchMock = vi.fn(async () => reply(log('x')));
    vi.stubGlobal('fetch', fetchMock);
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    renderHook(() => useSessionLog('p1', 'codex', 2000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    hidden.mockReturnValue('visible');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
