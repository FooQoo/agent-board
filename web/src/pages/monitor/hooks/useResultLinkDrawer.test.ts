import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResultLinkTarget } from '../../../features/tasks/results/resultLink';
import type { MonitorTask } from '../contracts';
import { useResultLinkDrawer } from './useResultLinkDrawer';

const PROJECT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const tasks = [
  { projectId: PROJECT, projectName: 'p', task: { id: 11 } },
] as unknown as MonitorTask[];
const link: ResultLinkTarget = { projectId: PROJECT, taskId: 11, version: 1, tab: 'results' };

describe('useResultLinkDrawer', () => {
  it('opens a link once while it stays active', () => {
    const show = vi.fn();
    const { rerender } = renderHook(({ l }) => useResultLinkDrawer(tasks, l, show), {
      initialProps: { l: link as ResultLinkTarget | null },
    });
    rerender({ l: { ...link } });
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('opens the same link again after the link ended', () => {
    const show = vi.fn();
    const { rerender } = renderHook(({ l }) => useResultLinkDrawer(tasks, l, show), {
      initialProps: { l: link as ResultLinkTarget | null },
    });
    rerender({ l: null });
    rerender({ l: { ...link } });
    expect(show).toHaveBeenCalledTimes(2);
  });
});
