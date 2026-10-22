import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/shared/i18n';
import { useDocsTree } from './useDocsTree';
import { useDocument } from './useDocument';
import { useDocumentEditor } from './useDocumentEditor';
import type { DocsFile } from '../api/docsApi';

const FILE: DocsFile = {
  path: 'a/b.md',
  content: '---\ntitle: T\n---\n# Hello\n',
  revision: 'sha256:1',
  readOnly: false,
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
});

describe('useDocumentEditor', () => {
  const setup = (file: DocsFile = FILE, onSaved = vi.fn()) =>
    renderHook(() => useDocumentEditor({ projectId: 'p1', file, onSaved }));

  it('splits the front matter and is not dirty until the editor reports a change', () => {
    const { result } = setup();
    expect(result.current.frontmatter).toBe('---\ntitle: T\n---\n');
    expect(result.current.body).toBe('# Hello\n');
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
  });

  it('saves the front matter and the edited body against the opened revision', async () => {
    fetchMock.mockResolvedValue(json({ path: 'a/b.md', revision: 'sha256:2' }));
    const onSaved = vi.fn();
    const { result } = setup(FILE, onSaved);
    act(() => result.current.onChange('# Changed\n'));
    expect(result.current.dirty).toBe(true);
    expect(result.current.canSave).toBe(true);
    await act(() => result.current.save());
    const request = call(0);
    expect(request[0]).toBe('/api/projects/p1/docs/file');
    expect(request[1].method).toBe('PUT');
    expect(JSON.parse(request[1].body)).toEqual({
      path: 'a/b.md',
      content: '---\ntitle: T\n---\n# Changed\n',
      expectedRevision: 'sha256:1',
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.canSave).toBe(false);
    expect(result.current.error).toBeNull();
    expect(onSaved).toHaveBeenCalled();

    // The next save uses the new revision.
    fetchMock.mockResolvedValue(json({ path: 'a/b.md', revision: 'sha256:3' }));
    act(() => result.current.onChange('# Again\n'));
    await act(() => result.current.save());
    expect(JSON.parse(call(1)[1].body).expectedRevision).toBe('sha256:2');
  });

  it('is clean again when the text is changed back', () => {
    const { result } = setup();
    act(() => result.current.onChange('x'));
    act(() => result.current.onChange('# Hello\n'));
    expect(result.current.dirty).toBe(false);
  });

  it('keeps the input and says why when the save fails', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'x', reason: 'secret server text' } }, 500));
    const { result } = setup();
    act(() => result.current.onChange('# Changed\n'));
    await act(() => result.current.save());
    expect(result.current.dirty).toBe(true);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toContain('secret');
    expect(result.current.conflict).toBe(false);
  });

  it('has its own sentence for a read-only rejection', async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 'docs_read_only' } }, 403));
    const { result } = setup();
    act(() => result.current.onChange('# Changed\n'));
    await act(() => result.current.save());
    expect(result.current.error).toContain('read-only');
  });

  it('does not save a read-only file', async () => {
    const { result } = setup({ ...FILE, readOnly: true });
    act(() => result.current.onChange('# Changed\n'));
    expect(result.current.canSave).toBe(false);
    await act(() => result.current.save());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('flags a conflict, keeps the input, and overwrites with the current revision', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'docs_revision_conflict' }, currentRevision: 'sha256:9' }, 409),
    );
    const { result } = setup();
    act(() => result.current.onChange('# Mine\n'));
    await act(() => result.current.save());
    expect(result.current.conflict).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.error).toBeNull();

    fetchMock.mockResolvedValueOnce(json({ path: 'a/b.md', revision: 'sha256:10' }));
    await act(() => result.current.overwrite());
    const body = JSON.parse(call(1)[1].body);
    expect(body.expectedRevision).toBe('sha256:9');
    expect(body.content).toBe('---\ntitle: T\n---\n# Mine\n');
    expect(result.current.conflict).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it('reads the latest revision itself when the conflict does not carry one', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'docs_revision_conflict' } }, 409));
    const { result } = setup();
    act(() => result.current.onChange('# Mine\n'));
    await act(() => result.current.save());
    fetchMock.mockResolvedValueOnce(json({ ...FILE, revision: 'sha256:7' }));
    fetchMock.mockResolvedValueOnce(json({ path: 'a/b.md', revision: 'sha256:8' }));
    await act(() => result.current.overwrite());
    expect(JSON.parse(call(2)[1].body).expectedRevision).toBe('sha256:7');
  });
});
