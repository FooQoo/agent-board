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
      /^\/api\/projects\//,
    );
    expect(unconnectedMonitorReadResolvers.epicAttachmentUrl('abc', 'epic-id', 'image-id')).toMatch(
      /^\/api\/projects\//,
    );
  });

  it('renders passed view state without write controls', () => {
    render(<MonitorView {...props} />);
    expect(screen.getByRole('heading', { name: 'Agent Board' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Loading monitor');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All Projects' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Delete|Edit|Answer/ })).toBeNull();
    // With nothing done there is nothing to archive: the Done lane's bulk archive is disabled.
    const archive = screen.getByRole('button', { name: /Archive/ }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
  });
});
