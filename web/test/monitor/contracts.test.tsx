import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorViewProps } from '../../src/pages/monitor/contracts';
import { unconnectedMonitorReadResolvers } from '../../src/pages/monitor/contracts';
import { MonitorView } from '../../src/pages/monitor/View';

const props: MonitorViewProps = {
  summary: null,
  todo: [],
  doing: [],
  done: [],
  freshness: { state: 'loading', lastFetchedAt: null, snapshotProblems: [] },
  onRefresh: vi.fn(),
};

describe('monitor contracts and view', () => {
  it('builds only read URLs beneath the dedicated API prefix', () => {
    expect(unconnectedMonitorReadResolvers.attachmentUrl('abc', 7, 'image-id')).toMatch(
      /^\/monitor\/api\//,
    );
    expect(unconnectedMonitorReadResolvers.epicAttachmentUrl('abc', 'epic-id', 'image-id')).toMatch(
      /^\/monitor\/api\//,
    );
  });

  it('renders passed view state without write controls', () => {
    render(<MonitorView {...props} />);
    expect(screen.getByRole('heading', { name: 'Agent Board' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Loading monitor');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'All Projects' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Archive|Delete|Edit|Answer/ })).toBeNull();
  });
});
