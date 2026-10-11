import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { ReadOnlyDetail } from '../../src/monitor/views/ReadOnlyDetail';
import { unconnectedMonitorReadResolvers } from '../../src/monitor/contracts';
import type { MonitorViewProps } from '../../src/monitor/contracts';
import { makeCard, PROJECT_A, PROJECTS } from '../fixtures';

function props(): MonitorViewProps {
  return {
    projects: PROJECTS,
    scope: 'all',
    summary: { pending: 0, running: 1, done: 0 },
    pending: [],
    running: [],
    done: [],
    selectedCard: {
      projectId: PROJECT_A.id,
      projectName: PROJECT_A.name,
      card: makeCard({
        id: 32,
        cardStatus: 'doing',
        agentStatus: 'running',
        description: 'Text from snapshot',
      }),
    },
    body: 'Latest body',
    history: null,
    tab: 'body',
    freshness: {
      state: 'fresh',
      lastFetchedAt: '2026-10-11T01:00:00Z',
      failedProjectIds: [],
      snapshotProblems: [],
    },
    readResolvers: unconnectedMonitorReadResolvers,
    onScopeChange: vi.fn(),
    onCardSelect: vi.fn(),
    onCloseCard: vi.fn(),
    onTabChange: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe('ReadOnlyDetail', () => {
  beforeEach(() => selectLocale('en'));
  it('uses CardDetailView content and controlled tabs in the full-screen dialog', async () => {
    const model = props();
    render(<ReadOnlyDetail {...model} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(`${PROJECT_A.name} ·`)).toBeTruthy();
    expect(screen.getByText('Latest body')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^History/ }));
    expect(model.onTabChange).toHaveBeenCalledWith('history');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(model.onCloseCard).toHaveBeenCalled();
  });
});
