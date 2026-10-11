import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorViewProps } from '../../src/monitor/contracts';
import { unconnectedMonitorReadResolvers } from '../../src/monitor/contracts';
import { MonitorView } from '../../src/monitor/View';

const props: MonitorViewProps = {
  projects: [{ id: 'a'.repeat(32), name: 'Alpha', createdAt: '2026-01-01T00:00:00Z' }],
  scope: 'all',
  summary: null,
  pending: [],
  running: [],
  done: [],
  selectedCard: null,
  body: null,
  history: null,
  freshness: { state: 'loading', lastFetchedAt: null, failedProjectIds: [], snapshotProblems: [] },
  readResolvers: unconnectedMonitorReadResolvers,
  onScopeChange: vi.fn(),
  onCardSelect: vi.fn(),
  onCloseCard: vi.fn(),
  onTabChange: vi.fn(),
  onRefresh: vi.fn(),
};

describe('monitor contracts and placeholder view', () => {
  it('builds only read URLs beneath the dedicated API prefix and marks epic loading as unconnected', async () => {
    expect(unconnectedMonitorReadResolvers.attachmentUrl('abc', 7, 'image-id')).toMatch(
      /^\/monitor\/api\//,
    );
    expect(unconnectedMonitorReadResolvers.evidenceUrl('abc', 7, 'proof-id')).toMatch(
      /^\/monitor\/api\//,
    );
    expect(unconnectedMonitorReadResolvers.epicAttachmentUrl('abc', 'epic-id', 'image-id')).toMatch(
      /^\/monitor\/api\//,
    );
    await expect(unconnectedMonitorReadResolvers.getEpic('abc', 'epic-id')).rejects.toThrow(
      'not connected',
    );
  });

  it('renders passed view state without write controls', () => {
    render(<MonitorView {...props} />);
    expect(screen.getByRole('heading', { name: 'Agent Board Monitor' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('loading');
    expect(screen.getByRole('combobox', { name: 'Project' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
