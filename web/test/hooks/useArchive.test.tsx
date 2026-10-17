import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useArchive } from '../../src/hooks/useArchive';
import { useProjectResource } from '../../src/hooks/useProjectResource';
import type { ArchiveResponse } from '../../src/api';
import { deferred, stubBackend, type FakeBackend } from '../fakes';
import { PROJECT_A, PROJECT_B, PROJECTS, boardOf, fixtureBoard, makeTask } from '../fixtures';

afterEach(() => vi.unstubAllGlobals());

function fakeBackend(gate?: (url: string) => Promise<void> | undefined): FakeBackend {
  return {
    projects: PROJECTS,
    boards: {
      [PROJECT_A.id]: fixtureBoard,
      [PROJECT_B.id]: boardOf(PROJECT_B, []),
    },
    archives: {
      [PROJECT_A.id]: [makeTask({ id: 2, title: 'Archived A' })],
      [PROJECT_B.id]: [makeTask({ id: 8, title: 'Archived B' })],
    },
    gate,
  };
}

describe('useArchive', () => {
  it('loads the requested project and exposes its archived tasks', async () => {
    const fetchMock = stubBackend(fakeBackend());
    const { result } = renderHook(() => useArchive(PROJECT_A.id));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.data?.project.id).toBe(PROJECT_A.id);
    expect(result.current.data?.tasks.map((task) => task.title)).toEqual(['Archived A']);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_A.id}/archive`,
      expect.anything(),
    );
  });

  it('drops the old archive immediately and ignores a late response after switching projects', async () => {
    const lateA = deferred<void>();
    const fetchMock = stubBackend(
      fakeBackend((url) =>
        url.includes(PROJECT_A.id) && url.endsWith('/archive') ? lateA.promise : undefined,
      ),
    );
    const { result, rerender } = renderHook(({ id }) => useArchive(id), {
      initialProps: { id: PROJECT_A.id },
    });

    rerender({ id: PROJECT_B.id });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data?.project.id).toBe(PROJECT_B.id));
    await act(async () => {
      lateA.resolve();
      await Promise.resolve();
    });
    expect(result.current.data?.tasks[0]?.title).toBe('Archived B');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/archive'))).toHaveLength(
      2,
    );
  });

  it('keeps the previous data and marks a refresh failure', async () => {
    const backend = fakeBackend();
    stubBackend(backend);
    const { result } = renderHook(() => useArchive(PROJECT_A.id));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    backend.archives = { ...backend.archives, [PROJECT_A.id]: 500 };
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.fetchFailed).toBe(true));
    expect(result.current.status).toBe('ready');
    expect(result.current.data?.tasks[0]?.title).toBe('Archived A');
  });

  it('does not apply a resource whose payload names another project', async () => {
    const mismatched: ArchiveResponse = {
      project: PROJECT_B,
      version: 'v1',
      cursor: `f1:${PROJECT_B.id}:v1`,
      tasks: [makeTask({ id: 8, title: 'Wrong project' })],
    };
    let requests = 0;
    const { result } = renderHook(() =>
      useProjectResource(PROJECT_A.id, async () => {
        requests += 1;
        return mismatched;
      }),
    );
    await act(async () => Promise.resolve());
    expect(result.current.data).toBeNull();
    expect(requests).toBe(1);
  });
});
