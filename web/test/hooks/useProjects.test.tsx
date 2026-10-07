import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjects } from '../../src/hooks/useProjects';
import { deferred, stubBackend, type FakeBackend } from '../fakes';
import { PROJECTS, PROJECT_A, PROJECT_B } from '../fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

function backend(overrides: Partial<FakeBackend> = {}): FakeBackend {
  return { projects: PROJECTS, boards: {}, ...overrides };
}

describe('useProjects', () => {
  it('loads the list', async () => {
    const fetchMock = stubBackend(backend());
    const { result } = renderHook(() => useProjects());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.projects.map((p) => p.name)).toEqual([
      'agent-board',
      'knowledge',
      'tech-blog',
    ]);
    expect(result.current.catalogRevision).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/projects', expect.anything());
  });

  it('is ready with an empty list when there are no projects', async () => {
    stubBackend(backend({ projects: [] }));
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.projects).toEqual([]);
  });

  it('reports an error until the first list arrives and recovers on reload', async () => {
    const fake = backend({ projects: new Error('down') });
    stubBackend(fake);
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.projects).toEqual([]);

    fake.projects = PROJECTS;
    act(() => result.current.reload());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.fetchFailed).toBe(false);
  });

  it('keeps the old list and flags the failure when a refresh fails', async () => {
    const fake = backend();
    stubBackend(fake);
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    fake.projects = 500;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.fetchFailed).toBe(true));
    expect(result.current.status).toBe('ready');
    expect(result.current.projects).toHaveLength(3);
  });

  it('shows a rename and a removal after a refresh', async () => {
    const fake = backend();
    stubBackend(fake);
    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    fake.projects = [{ ...PROJECT_A, name: 'renamed' }, PROJECT_B];
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.projects).toHaveLength(2));
    expect(result.current.projects[0]).toMatchObject({ id: PROJECT_A.id, name: 'renamed' });
  });

  it('applies only the latest answer when answers arrive in reverse order', async () => {
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const fake = backend({
      gate: () => {
        calls += 1;
        return calls === 1 ? first.promise : calls === 2 ? second.promise : undefined;
      },
    });
    fake.projects = [PROJECT_A];
    stubBackend(fake);
    const { result } = renderHook(() => useProjects());
    fake.projects = PROJECTS;
    act(() => result.current.reload());

    await act(async () => {
      second.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.projects).toHaveLength(3));
    fake.projects = [PROJECT_A];
    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });
    expect(result.current.projects).toHaveLength(3);
  });

  it('survives a StrictMode remount', async () => {
    stubBackend(backend());
    const { result } = renderHook(() => useProjects(), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.projects).toHaveLength(3);
  });
});
