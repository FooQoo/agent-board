import { act, renderHook, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useMonitorUrl } from '../../src/monitor/hooks/useMonitorUrl';
import { PROJECT_A, PROJECT_B, PROJECTS } from '../fixtures';

function wrapperFor(search: string, onUrlUpdate: (event: UrlUpdateEvent) => void) {
  return ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
      {children}
    </NuqsTestingAdapter>
  );
}

describe('useMonitorUrl', () => {
  it('removes legacy detail queries while preserving project scope and unrelated parameters', async () => {
    const updates: UrlUpdateEvent[] = [];
    const { result } = renderHook(() => useMonitorUrl(PROJECTS, true), {
      wrapper: wrapperFor(
        `project=${PROJECT_B.id}&taskProject=${PROJECT_B.id}&task=1&tab=history&x=1`,
        (event) => updates.push(event),
      ),
    });
    expect(result.current.scope).toBe(PROJECT_B.id);
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]?.searchParams.get('project')).toBe(PROJECT_B.id);
    expect(updates[0]?.searchParams.get('x')).toBe('1');
    expect(updates[0]?.searchParams.has('cardProject')).toBe(false);
    expect(updates[0]?.searchParams.has('task')).toBe(false);
    expect(updates[0]?.searchParams.has('tab')).toBe(false);
    expect(result.current.notice).toBe(false);
  });

  it('omits All Projects from the URL when changing scope', async () => {
    const updates: UrlUpdateEvent[] = [];
    const { result } = renderHook(() => useMonitorUrl(PROJECTS, true), {
      wrapper: wrapperFor(`project=${PROJECT_A.id}`, (event) => updates.push(event)),
    });
    await act(async () => result.current.onScopeChange('all'));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]?.searchParams.has('project')).toBe(false);
    expect(result.current.scope).toBe('all');
  });

  it('waits for the catalog before clearing a deleted project scope', async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result, rerender } = renderHook(({ ready }) => useMonitorUrl([], ready), {
      initialProps: { ready: false },
      wrapper: wrapperFor(`project=${PROJECT_A.id}`, onUrlUpdate),
    });
    expect(onUrlUpdate).not.toHaveBeenCalled();
    rerender({ ready: true });
    await waitFor(() => expect(result.current.notice).toBe(true));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(result.current.scope).toBe('all');
  });
});
