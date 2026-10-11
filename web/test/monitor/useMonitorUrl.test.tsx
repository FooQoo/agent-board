import { act, renderHook, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useMonitorUrl } from '../../src/monitor/hooks/useMonitorUrl';
import type { MonitorCard } from '../../src/monitor/contracts';
import { PROJECT_A, PROJECT_B, PROJECTS, makeCard } from '../fixtures';

function wrapperFor(search: string, onUrlUpdate: (event: UrlUpdateEvent) => void) {
  return ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
      {children}
    </NuqsTestingAdapter>
  );
}

const duplicateIdCards: MonitorCard[] = [
  { projectId: PROJECT_A.id, projectName: PROJECT_A.name, card: makeCard({ id: 1 }) },
  { projectId: PROJECT_B.id, projectName: PROJECT_B.name, card: makeCard({ id: 1 }) },
];

describe('useMonitorUrl', () => {
  it('keeps project scope separate from owner project when the same card ID exists twice', () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const { result } = renderHook(() => useMonitorUrl(PROJECTS, true, duplicateIdCards, []), {
      wrapper: wrapperFor(
        `project=${PROJECT_B.id}&cardProject=${PROJECT_B.id}&card=1&tab=history`,
        onUrlUpdate,
      ),
    });
    expect(result.current.scope).toBe(PROJECT_B.id);
    expect(result.current.selected?.projectId).toBe(PROJECT_B.id);
    expect(result.current.selected?.card.id).toBe(1);
    expect(result.current.tab).toBe('history');
  });

  it('omits All Projects from scope and closing a detail preserves the existing scope', async () => {
    const updates: string[] = [];
    const onUrlUpdate = (event: UrlUpdateEvent) => updates.push(event.searchParams.toString());
    const { result } = renderHook(() => useMonitorUrl(PROJECTS, true, duplicateIdCards, []), {
      wrapper: wrapperFor(`cardProject=${PROJECT_A.id}&card=1&tab=history`, onUrlUpdate),
    });
    expect(result.current.scope).toBe('all');
    await act(async () => result.current.onCloseCard());
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const closed = updates.at(-1) ?? '';
    expect(closed).not.toContain('cardProject');
    expect(closed).not.toContain('card=');
    expect(closed).not.toContain('tab=');
    expect(closed).not.toContain('project=');
  });

  it('clears a deleted card URL and exposes a notice after the catalog is ready', async () => {
    const updates: string[] = [];
    const onUrlUpdate = (event: UrlUpdateEvent) => updates.push(event.searchParams.toString());
    const { result } = renderHook(() => useMonitorUrl(PROJECTS, true, [], []), {
      wrapper: wrapperFor(
        `project=${PROJECT_A.id}&cardProject=${PROJECT_A.id}&card=99&tab=body`,
        onUrlUpdate,
      ),
    });
    await waitFor(() => expect(result.current.notice).toBe(true));
    await waitFor(() => expect(updates.at(-1)).not.toContain('cardProject'));
    expect(result.current.scope).toBe(PROJECT_A.id);
  });
});
