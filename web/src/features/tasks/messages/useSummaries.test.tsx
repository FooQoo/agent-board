import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangedEvent } from '@/shared/data/api/contracts';
import type { DataCore } from '@/shared/data/core';
import { DataProvider } from '@/shared/data/react';
import type { PeriodicSummary, SummariesApi } from './model/messages';
import { useSummaries } from './useSummaries';

const PROJECT = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const summary = (id: string): PeriodicSummary => ({
  id,
  from: '2026-11-20T09:00:00Z',
  to: '2026-11-20T10:00:00Z',
  results: [{ taskId: 1, version: 1, title: 'x' }],
});

afterEach(cleanup);

function setup(api: SummariesApi) {
  const listeners = new Set<(event: ChangedEvent | null) => void>();
  const core = {
    subscribeChanges: (listener: (event: ChangedEvent | null) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as DataCore;
  let controller!: ReturnType<typeof useSummaries>;
  function Probe() {
    controller = useSummaries(api, PROJECT);
    return <p data-testid="ids">{controller.summaries.map((s) => s.id).join(',')}</p>;
  }
  render(
    <DataProvider adapter={{} as never} core={core}>
      <Probe />
    </DataProvider>,
  );
  const emit = (event: ChangedEvent | null) =>
    act(async () => {
      for (const l of listeners) l(event);
    });
  return { emit, controller: () => controller };
}

const event = (facets: ChangedEvent['changes'][number]['facets']): ChangedEvent => ({
  instanceId: 'i',
  seq: 1,
  projectId: PROJECT,
  changes: [{ resource: 'messages', id: PROJECT, facets }],
});

describe('useSummaries', () => {
  it('reads the list on mount and again on a messages change with the summary facet', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([summary('a')])
      .mockResolvedValue([summary('a'), summary('b')]);
    const { emit } = setup({ list, dismiss: vi.fn() });
    await act(async () => {});
    expect(screen.getByTestId('ids').textContent).toBe('a');
    await emit(event(['summary']));
    expect(screen.getByTestId('ids').textContent).toBe('a,b');
    await emit(null);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('ignores the changes of another project', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const { emit } = setup({ list, dismiss: vi.fn() });
    await act(async () => {});
    await emit({ ...event(['summary']), projectId: 'other' });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('hides a dismissed summary at once and brings it back when the server refuses', async () => {
    const dismiss = vi.fn().mockRejectedValue(new Error('no'));
    const { controller } = setup({ list: async () => [summary('a'), summary('b')], dismiss });
    await act(async () => {});
    await act(async () => controller().dismiss('a'));
    expect(dismiss).toHaveBeenCalledWith(PROJECT, 'a');
    expect(screen.getByTestId('ids').textContent).toBe('a,b');
    expect(controller().dismissFailed).toBe(true);
  });

  it('keeps a dismissed summary hidden when the server accepts', async () => {
    const dismiss = vi.fn().mockResolvedValue({});
    const { controller } = setup({ list: async () => [summary('a'), summary('b')], dismiss });
    await act(async () => {});
    await act(async () => controller().dismiss('a'));
    expect(screen.getByTestId('ids').textContent).toBe('b');
    expect(controller().dismissFailed).toBe(false);
  });
});
