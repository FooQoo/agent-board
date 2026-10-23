import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import { useDocsTree } from './useDocsTree';
import { type FileRefresh, useDocument } from './useDocument';
import { useDocsFollow } from './useDocsFollow';
import type { DocsFile } from '../api/docsApi';

const FILE: DocsFile = {
  path: 'a/b.md',
  content: '---\ntitle: T\n---\n# Hello\n',
  revision: 'sha256:1',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;
const call = (n: number) => fetchMock.mock.calls[n] as [string, { method: string; body: string }];
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useDocsTree', () => {
  it('fetches the tree once per project and again only on reload', async () => {
    fetchMock.mockImplementation(async () =>
      json({ nodes: [{ name: 'a', path: 'a', kind: 'dir', children: [] }], truncated: false }),
    );
    const { result, rerender } = renderHook(({ id }) => useDocsTree(id), {
      initialProps: { id: 'p1' },
    });
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    rerender({ id: 'p1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(call(0)[0]).toBe('/api/projects/p1/docs/tree');
    act(() => result.current.reload());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('reports a failed fetch', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'x' } }, 500));
    const { result } = renderHook(() => useDocsTree('p1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});

describe('useDocument', () => {
  it('fetches nothing without a path and the file when one is chosen', async () => {
    fetchMock.mockImplementation(async () => json(FILE));
    const { result, rerender } = renderHook(({ path }) => useDocument('p1', path), {
      initialProps: { path: null as string | null },
    });
    expect(result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ path: 'a/b.md' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(call(0)[0]).toBe('/api/projects/p1/docs/file?path=a%2Fb.md');
    expect(result.current.file?.revision).toBe('sha256:1');
  });

  it('reports a failed fetch and loads again on reload', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'docs_not_found' } }, 404));
    const { result } = renderHook(() => useDocument('p1', 'a/b.md'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    fetchMock.mockResolvedValueOnce(json(FILE));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('reads the open file again quietly: a new revision replaces it, and a 404 keeps it', async () => {
    fetchMock.mockResolvedValueOnce(json(FILE));
    const { result } = renderHook(() => useDocument('p1', 'a/b.md'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    fetchMock.mockResolvedValueOnce(json(FILE));
    let outcome: FileRefresh | undefined;
    await act(async () => {
      outcome = await result.current.refresh();
    });
    expect(outcome).toBe('unchanged');

    fetchMock.mockResolvedValueOnce(
      json({ ...FILE, content: '# Changed\n', revision: 'sha256:2' }),
    );
    await act(async () => {
      outcome = await result.current.refresh();
    });
    expect(outcome).toBe('updated');
    expect(result.current.status).toBe('ready');
    expect(result.current.file?.content).toBe('# Changed\n');

    fetchMock.mockResolvedValueOnce(json({ error: { code: 'docs_not_found' } }, 404));
    await act(async () => {
      outcome = await result.current.refresh();
    });
    expect(outcome).toBe('deleted');
    expect(result.current.file?.content).toBe('# Changed\n');
  });
});

describe('useDocsFollow', () => {
  const TREE = {
    nodes: [{ name: 'b.md', path: 'a/b.md', kind: 'file' as const }],
    truncated: false,
  };
  const NESTED = {
    nodes: [{ name: 'a', path: 'a', kind: 'dir' as const, children: TREE.nodes }],
    truncated: false,
  };

  function setup(refreshFile: () => Promise<FileRefresh>, tree: typeof NESTED | null = NESTED) {
    let listener: ((projectId: string | null) => void) | null = null;
    const subscribe = vi.fn((next: (projectId: string | null) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    });
    const refreshTree = vi.fn(async () => tree);
    const hook = renderHook(
      ({ path }) => useDocsFollow({ projectId: 'p1', subscribe, path, refreshTree, refreshFile }),
      { initialProps: { path: 'a/b.md' as string | null } },
    );
    const notify = async (projectId: string | null) => {
      await act(async () => {
        listener?.(projectId);
        await Promise.resolve();
      });
    };
    return { ...hook, notify, refreshTree, subscribe };
  }

  it('reads the list again for its project and for any project, but not for another one', async () => {
    const { notify, refreshTree, result } = setup(async () => 'unchanged');
    await notify('p2');
    expect(refreshTree).not.toHaveBeenCalled();
    await notify('p1');
    await notify(null);
    await waitFor(() => expect(refreshTree).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
  });

  it('says the open file was updated when its revision changed', async () => {
    const { notify, result } = setup(async () => 'updated');
    await notify('p1');
    await waitFor(() => expect(result.current?.kind).toBe('updated'));
    expect(result.current?.path).toBe('a/b.md');
  });

  it('says the open file was deleted when the list no longer holds it, without reading it', async () => {
    const refreshFile = vi.fn(async (): Promise<FileRefresh> => 'unchanged');
    const { notify, result } = setup(refreshFile, { nodes: [], truncated: false });
    await notify('p1');
    await waitFor(() => expect(result.current?.kind).toBe('deleted'));
    expect(refreshFile).not.toHaveBeenCalled();
  });

  it('shows no notice once another file is chosen', async () => {
    const { notify, result, rerender } = setup(async () => 'updated');
    await notify('p1');
    await waitFor(() => expect(result.current?.kind).toBe('updated'));
    rerender({ path: 'other.md' });
    expect(result.current).toBeNull();
  });
});
