import { act, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PcDataProvider, usePcConnection } from '../../src/app/data/PcData';
import { createPcAdapter, type PcStreamNote } from '../../src/app/data/pcAdapter';
import { resetPreferenceOrdering } from '../../src/shared/preferences';
import { FakeEventSource } from '../fakes';

const PROJECT = '0123456789abcdef0123456789abcdef';

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  // `ready` makes the screen read the preferences; nothing here needs them.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <PcDataProvider>{children}</PcDataProvider>
);

describe('the PC stream', () => {
  it('opens one stream at /api/events', () => {
    renderHook(() => usePcConnection(), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest.url).toBe('/api/events');
  });

  it('reports the build the latest ready named', () => {
    const { result } = renderHook(() => usePcConnection(), { wrapper });
    expect(result.current.serverBuild).toBeNull();
    act(() => FakeEventSource.latest.emit('ready', '{"build":"0123456789abcdef"}'));
    expect(result.current.serverBuild).toBe('0123456789abcdef');
  });

  it('reports the stream as down on error and up again once it is reopened', async () => {
    const { result } = renderHook(() => usePcConnection(), { wrapper });
    act(() => FakeEventSource.latest.emit('ready'));
    expect(result.current.streamDown).toBe(false);
    act(() => FakeEventSource.latest.emit('error'));
    expect(result.current.streamDown).toBe(true);
    // The data core reopens the stream after a pause.
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2), { timeout: 3000 });
    act(() => FakeEventSource.latest.emit('ready'));
    expect(result.current.streamDown).toBe(false);
  });

  it('closes the stream when unmounted, and every StrictMode stream but the last', () => {
    const { unmount } = renderHook(() => usePcConnection(), {
      wrapper: ({ children }) => (
        <StrictMode>
          <PcDataProvider>{children}</PcDataProvider>
        </StrictMode>
      ),
    });
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    unmount();
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
  });

  it('applies a preferences event at once and tells the lists nothing', () => {
    const notes: PcStreamNote[] = [];
    const { result } = renderHook(() => usePcConnection(), { wrapper });
    result.current.adapter.subscribe((note) => notes.push(note));
    act(() =>
      FakeEventSource.latest.emit(
        'preferences',
        JSON.stringify({ locale: 'en', theme: { mode: 'dark', accent: 'red' }, revision: 2 }),
      ),
    );
    expect(document.documentElement.dataset.accent).toBe('red');
    expect(notes).toEqual([]);
    document.documentElement.removeAttribute('data-mode');
    document.documentElement.removeAttribute('data-accent');
    window.localStorage.clear();
  });

  it('reads the saved preferences again on a ready event', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ locale: 'ja', theme: { mode: 'dark', accent: 'teal' }, revision: 4 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    renderHook(() => usePcConnection(), { wrapper });
    act(() => FakeEventSource.latest.emit('ready'));
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('teal'));
    expect(fetcher).toHaveBeenCalledWith('/api/preferences', expect.anything());
    document.documentElement.removeAttribute('data-mode');
    document.documentElement.removeAttribute('data-accent');
    document.documentElement.removeAttribute('lang');
    window.localStorage.clear();
    resetPreferenceOrdering();
  });
});

describe('the PC adapter', () => {
  function open() {
    const adapter = createPcAdapter();
    const notes: PcStreamNote[] = [];
    adapter.subscribe((note) => notes.push(note));
    const handlers = {
      onChanged: vi.fn(),
      onReset: vi.fn(),
      onOpen: vi.fn(),
      onClose: vi.fn(),
      onReady: vi.fn(),
    };
    const close = adapter.openEvents(handlers);
    return { adapter, notes, handlers, close };
  }

  it('hands a changed event on with its instance, number and changes', () => {
    const { notes, handlers } = open();
    const payload = {
      instanceId: 'i1',
      seq: 3,
      projectId: PROJECT,
      changes: [{ resource: 'task', id: 7, facets: ['summary', 'history'] }],
    };
    FakeEventSource.latest.emit('changed', JSON.stringify(payload));
    expect(handlers.onChanged).toHaveBeenCalledWith(payload);
    expect(notes).toEqual([{ type: 'changed', event: payload }]);
  });

  it('treats a changed event it cannot read as a reason to read everything again', () => {
    const { notes, handlers } = open();
    FakeEventSource.latest.emit('changed', '{"projectId":1}');
    expect(handlers.onChanged).not.toHaveBeenCalled();
    expect(handlers.onReset).toHaveBeenCalledWith('unknown-event');
    expect(notes).toEqual([{ type: 'sync' }]);
  });

  it('treats resync as a gap in the numbers', () => {
    const { notes, handlers } = open();
    FakeEventSource.latest.emit('resync', '{"instanceId":"i1","seq":9}');
    expect(handlers.onReset).toHaveBeenCalledWith('seq-gap');
    expect(notes).toEqual([{ type: 'sync' }]);
  });

  it('opens on ready, and asks the lists to sync only when it opens again', () => {
    const { notes, handlers } = open();
    FakeEventSource.latest.emit('ready', '{"build":"0123456789abcdef"}');
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
    expect(handlers.onReady).toHaveBeenCalledWith('0123456789abcdef');
    expect(notes).toEqual([]);
    FakeEventSource.latest.emit('ready', '{}');
    expect(handlers.onReady).toHaveBeenLastCalledWith('');
    expect(notes).toEqual([{ type: 'sync' }]);
  });

  it('reports a broken stream as closed and closes the source with the returned function', () => {
    const { handlers, close } = open();
    FakeEventSource.latest.emit('error');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    close();
    expect(FakeEventSource.latest.closed).toBe(true);
  });

  it('reads the Summary of a project from its own address and checks its shape', async () => {
    const fetcher = vi.fn(async () => new Response('{"project":1}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(
      createPcAdapter().fetchSummary(PROJECT, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledWith(
      `/api/projects/${PROJECT}/summary`,
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('asks for the named sections of a task Detail, and an epic Detail by its encoded ID', async () => {
    const fetcher = vi.fn(async (_url: string) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const adapter = createPcAdapter();
    const signal = new AbortController().signal;
    for await (const _ of adapter.streamDetail(
      {
        resource: { kind: 'task', projectId: PROJECT, id: 12 },
        sections: ['document', 'history'],
      },
      signal,
    )) {
      // The body is empty.
    }
    for await (const _ of adapter.streamDetail(
      { resource: { kind: 'epic', projectId: PROJECT, id: 'A B' }, sections: ['document'] },
      signal,
    )) {
      // The body is empty.
    }
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `/api/projects/${PROJECT}/tasks/12/detail?sections=document,history`,
      `/api/projects/${PROJECT}/epics/A%20B/detail?sections=document`,
    ]);
  });
});
