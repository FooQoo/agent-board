import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveResponse } from '../../src/features/tasks/api/read';
import type { MonitorWrites } from '../../src/pages/monitor/contracts';
import { useArchiveSheet } from '../../src/pages/monitor/hooks/useArchiveSheet';

const fetchArchive = vi.hoisted(() => vi.fn());
vi.mock('../../src/features/tasks/api/read', () => ({ fetchArchive }));

const response = (ids: number[]): ArchiveResponse =>
  ({
    project: { id: 'p', name: 'p', createdAt: '2026-10-01T08:00:00.000Z' },
    version: 'v',
    cursor: 'c',
    tasks: ids.map((id) => ({ id })),
    epics: [],
  }) as unknown as ArchiveResponse;

const ids = (result: { current: ReturnType<typeof useArchiveSheet> }) =>
  result.current.archive?.data?.tasks.map((task) => task.id);

function setup(restore: MonitorWrites['restore']) {
  const onWritten = vi.fn();
  const onRestored = vi.fn();
  const writes = { restore } as MonitorWrites;
  const view = renderHook(({ open }) => useArchiveSheet(open, 'p', writes, onWritten, onRestored), {
    initialProps: { open: true },
  });
  return { ...view, onWritten, onRestored };
}

describe('restoring from the archive sheet', () => {
  beforeEach(() => {
    fetchArchive.mockReset();
    fetchArchive.mockResolvedValue(response([5, 3]));
  });

  it('drops the restored row at once without reading the archive again', async () => {
    const { result, onWritten, onRestored } = setup(vi.fn().mockResolvedValue(undefined));
    await waitFor(() => expect(ids(result)).toEqual([5, 3]));
    await act(async () => {
      await result.current.onRestore?.(3);
    });
    expect(ids(result)).toEqual([5]);
    expect(fetchArchive).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenCalledWith(3);
    expect(onWritten).toHaveBeenCalledOnce();
  });

  it('keeps the row and does not read again when the restore fails', async () => {
    const { result, onRestored } = setup(vi.fn().mockRejectedValue(new Error('no')));
    await waitFor(() => expect(ids(result)).toEqual([5, 3]));
    await act(async () => {
      await result.current.onRestore?.(3).catch(() => {});
    });
    expect(ids(result)).toEqual([5, 3]);
    expect(fetchArchive).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('reads fresh when the list is opened again', async () => {
    const { result, rerender } = setup(vi.fn().mockResolvedValue(undefined));
    await waitFor(() => expect(ids(result)).toEqual([5, 3]));
    await act(async () => {
      await result.current.onRestore?.(3);
    });
    rerender({ open: false });
    fetchArchive.mockResolvedValue(response([5, 3]));
    rerender({ open: true });
    await waitFor(() => expect(fetchArchive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ids(result)).toEqual([5, 3]));
  });
});
