import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoard } from '../src/hooks/useBoard';
import type { Board } from '../src/types';
import { FakeEventSource, stubBoardFetch } from './fakes';
import { fixtureBoard } from './fixtures';

let current: Board | Error;

beforeEach(() => {
  current = fixtureBoard;
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useBoard', () => {
  it('starts loading and becomes ready once the board is fetched', async () => {
    const fetchMock = stubBoardFetch(() => current);
    const { result } = renderHook(() => useBoard());

    expect(result.current.status).toBe('loading');
    expect(result.current.board).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    expect(fetchMock).toHaveBeenCalledWith('/api/board', expect.anything());
    expect(result.current.board?.cards).toHaveLength(8);
    expect(result.current.connected).toBe(true);
    expect(result.current.lastSyncedAt).toBeInstanceOf(Date);
    expect(FakeEventSource.latest.url).toBe('/api/events');
  });

  it('fetches the board again on every changed event', async () => {
    const fetchMock = stubBoardFetch(() => current);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = fetchMock.mock.calls.length;

    current = { ...fixtureBoard, cards: fixtureBoard.cards.slice(0, 3) };
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(result.current.board?.cards).toHaveLength(3));
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it('fetches the board again on the ready event', async () => {
    const fetchMock = stubBoardFetch(() => current);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = fetchMock.mock.calls.length;

    act(() => FakeEventSource.latest.emit('ready'));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1));
  });

  it('switches to the disconnected state on an error event and keeps the last board', async () => {
    stubBoardFetch(() => current);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const syncedAt = result.current.lastSyncedAt;

    act(() => FakeEventSource.latest.emit('error'));

    expect(result.current.connected).toBe(false);
    expect(result.current.status).toBe('ready');
    expect(result.current.board?.cards).toHaveLength(8);
    expect(result.current.lastSyncedAt).toBe(syncedAt);
  });

  it('returns to the connected state when the next fetch succeeds after reconnecting', async () => {
    stubBoardFetch(() => current);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    act(() => FakeEventSource.latest.emit('error'));
    expect(result.current.connected).toBe(false);

    act(() => FakeEventSource.latest.emit('ready'));

    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('reports an error when the first fetch fails and recovers on reload', async () => {
    const fetchMock = stubBoardFetch(() => current);
    current = new Error('network down');
    const { result } = renderHook(() => useBoard());

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.board).toBeNull();
    expect(result.current.connected).toBe(false);

    current = fixtureBoard;
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('treats a non-2xx response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'database_error', message: 'x', reason: 'y' } }),
            { status: 500 },
          ),
      ),
    );
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('keeps the board but marks it disconnected when a refresh fails', async () => {
    stubBoardFetch(() => current);
    const { result } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    current = new Error('network down');
    act(() => FakeEventSource.latest.emit('changed'));

    await waitFor(() => expect(result.current.connected).toBe(false));
    expect(result.current.status).toBe('ready');
    expect(result.current.board?.cards).toHaveLength(8);
  });

  it('closes the EventSource when unmounted', async () => {
    stubBoardFetch(() => current);
    const { result, unmount } = renderHook(() => useBoard());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const source = FakeEventSource.latest;

    unmount();

    expect(source.closed).toBe(true);
  });
});
