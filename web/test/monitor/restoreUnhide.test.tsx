import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeTask, PROJECT_A } from '../fixtures';
import type { MonitorTask, MonitorWrites } from '../../src/pages/monitor/contracts';
import type { Lanes } from '../../src/pages/monitor/model/overlay';
import { useLaneOverlay } from '../../src/pages/monitor/hooks/useLaneOverlay';
import { useArchiveSheet } from '../../src/pages/monitor/hooks/useArchiveSheet';

vi.mock('../../src/features/projects/model/useProjectResource', () => ({
  useProjectResource: () => ({
    data: undefined,
    status: 'ready',
    fetchFailed: false,
    reload: vi.fn(),
  }),
}));

const item = (id: number): MonitorTask => ({
  projectId: PROJECT_A.id,
  projectName: PROJECT_A.name,
  task: { ...makeTask({ id }), taskStatus: 'done', position: id },
});
// The same read stays applied: it was requested before the archive committed, so it still holds the task.
const lanes: Lanes = { backlog: [], todo: [], doing: [], done: [item(7), item(8)] };
const doneIds = (shown: Lanes) => shown.done.map((entry) => entry.task.id);

/** The overlay and the archive sheet wired as the phone's view wires them. */
function setup(restore: MonitorWrites['restore']) {
  const writes = { restore } as MonitorWrites;
  return renderHook(() => {
    const overlay = useLaneOverlay(lanes);
    const sheet = useArchiveSheet(true, 'p', writes, undefined, overlay.unhide);
    return { overlay, sheet };
  });
}

describe('restoring an archived task', () => {
  it('shows the task again at once, before any read omits it', async () => {
    const { result } = setup(vi.fn().mockResolvedValue(undefined));
    act(() => result.current.overlay.hide([7]));
    expect(doneIds(result.current.overlay.lanes)).toEqual([8]);
    await act(async () => {
      await result.current.sheet.onRestore?.(7);
    });
    expect(doneIds(result.current.overlay.lanes)).toEqual([7, 8]);
  });

  it('keeps the task hidden when the restore fails', async () => {
    const { result } = setup(vi.fn().mockRejectedValue(new Error('no')));
    act(() => result.current.overlay.hide([7]));
    await act(async () => {
      await result.current.sheet.onRestore?.(7).catch(() => {});
    });
    expect(doneIds(result.current.overlay.lanes)).toEqual([8]);
  });
});
