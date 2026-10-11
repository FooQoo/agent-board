import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { MonitorView } from '../../src/monitor/View';
import { unconnectedMonitorReadResolvers } from '../../src/monitor/contracts';
import type { MonitorViewProps } from '../../src/monitor/contracts';
import { makeCard, PROJECT_A, PROJECTS } from '../fixtures';

function props(): MonitorViewProps {
  return {
    projects: PROJECTS,
    scope: 'all',
    summary: { pending: 1, running: 1, done: 1 },
    pending: [
      {
        projectId: PROJECT_A.id,
        projectName: PROJECT_A.name,
        card: makeCard({ id: 1, agentStatus: 'pending', pendingReason: 'Waiting for decision' }),
      },
    ],
    running: [
      {
        projectId: PROJECT_A.id,
        projectName: PROJECT_A.name,
        card: makeCard({ id: 2, cardStatus: 'doing', agentStatus: 'running' }),
      },
    ],
    done: [
      {
        projectId: PROJECT_A.id,
        projectName: PROJECT_A.name,
        card: makeCard({ id: 3, cardStatus: 'done' }),
      },
    ],
    selectedCard: null,
    body: null,
    history: null,
    tab: 'body',
    freshness: {
      state: 'fresh',
      lastFetchedAt: '2026-10-11T00:00:00Z',
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

describe('MonitorView', () => {
  beforeEach(() => selectLocale('en'));
  it('renders the designed sections, counts and card selection without write actions', () => {
    const model = props();
    render(<MonitorView {...model} />);
    expect(screen.getByRole('heading', { name: 'Pending 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Running 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Done 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Waiting for decision/ }));
    expect(model.onCardSelect).toHaveBeenCalledWith(PROJECT_A.id, 1);
    expect(screen.queryByRole('button', { name: /Archive|Delete|Edit|Answer/ })).toBeNull();
  });

  it('shows all-project scope and monitor states in English in Japanese locale', () => {
    selectLocale('ja');
    render(<MonitorView {...props()} />);
    expect(screen.getByRole('button', { name: 'All Projects' })).toBeTruthy();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Done').length).toBeGreaterThan(0);
    selectLocale('en');
  });
});
