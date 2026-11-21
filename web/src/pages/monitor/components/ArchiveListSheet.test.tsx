import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/i18n';
import type { ArchiveResponse, ArchivedTask } from '../../../features/tasks/api/read';
import { ArchiveListSheet } from './ArchiveListSheet';
import { PhoneNavBar } from './PhoneNavBar';

afterEach(cleanup);

const task = (id: number, taskStatus: ArchivedTask['taskStatus']): ArchivedTask => ({
  id,
  title: `Archived ${id}`,
  assignee: 'ai',
  taskStatus,
  taskStatusChangedAt: '2026-10-01T09:00:00.000Z',
  position: 1,
  agentStatus: 'idle',
  pendingReason: null,
  pendingRequestId: null,
  pendingChoices: [],
  epic: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  agentStatusChangedAt: '2026-10-01T09:00:00.000Z',
  draft: null,
  acceptance: { done: 0, total: 0 },
  archivedAt: '2026-10-02T09:00:00.000Z',
});

const response = (tasks: ArchivedTask[]): ArchiveResponse => ({
  project: { id: 'p1' as never, name: 'p', createdAt: '2026-10-01T08:00:00.000Z' },
  version: 'v',
  tasks,
  epics: [],
  total: tasks.length,
});

const sheet = (props: Partial<Parameters<typeof ArchiveListSheet>[0]> = {}) =>
  render(
    <ArchiveListSheet
      data={response([task(5, 'done'), task(3, 'todo')])}
      status="ready"
      projectName="Demo"
      onRestore={async () => {}}
      onClose={() => {}}
      {...props}
    />,
  );

describe('ArchiveListSheet', () => {
  it('draws each archived task as a lane card, with the lane it returns to and the date under it', () => {
    sheet();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // The card is the one the lanes use.
    expect(rows[0]?.querySelector('article.monitor-card--done')).not.toBeNull();
    expect(rows[1]?.querySelector('article.monitor-card--todo')).not.toBeNull();
    expect(rows[0]?.querySelector('.swipe-card')).not.toBeNull();
    expect(within(rows[0] as HTMLElement).getByText('Returns to Done')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Archived 2026-10-02')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Returns to Todo')).toBeTruthy();
  });

  it('says so when nothing is archived', () => {
    sheet({ data: response([]) });
    expect(screen.getByText('No archived tasks')).toBeTruthy();
  });

  it('keeps Restore closed until a swipe, and a tap on a card chooses nothing', () => {
    const { container } = sheet();
    const row = container.ownerDocument.querySelector('[data-archive-row="3"]') as HTMLElement;
    fireEvent.click(within(row).getByText('Archived 3'));
    expect(row.querySelector('[data-revealed]')).toBeNull();
    expect(row.querySelector('[data-armed]')).toBeNull();
  });

  it('pressing Restore restores that task', async () => {
    const onRestore = vi.fn(async () => {});
    sheet({ initialRevealed: 3, onRestore });
    fireEvent.click(screen.getByRole('button', { name: 'Restore #3' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(3));
  });

  it('keeps the row and says so when the restore fails', async () => {
    const onRestore = vi.fn(async () => {
      throw new Error('no');
    });
    sheet({ initialRevealed: 3, onRestore });
    fireEvent.click(screen.getByRole('button', { name: 'Restore #3' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not restore');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('ArchiveListSheet paging', () => {
  it('asks for the next page when the last row is in the rendered range', () => {
    const loadMore = vi.fn();
    sheet({ hasMore: true, loadMore });
    expect(loadMore).toHaveBeenCalled();
  });

  it('shows the end of the list after the last page, and no request', () => {
    const loadMore = vi.fn();
    sheet({ hasMore: false, loadMore });
    expect(screen.getByTestId('archive-end')).toBeTruthy();
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('shows a retry after a failed page, and asks again only when pressed', () => {
    const loadMore = vi.fn();
    const retryMore = vi.fn();
    sheet({ hasMore: true, loadMoreFailed: true, loadMore, retryMore });
    expect(loadMore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryMore).toHaveBeenCalledOnce();
  });
});

describe('PhoneNavBar', () => {
  it('holds the five items only, with Archive opening the list', () => {
    const onArchive = vi.fn();
    render(
      <PhoneNavBar
        onBoard={vi.fn()}
        onMessages={vi.fn()}
        onAsk={vi.fn()}
        onArchive={onArchive}
        onSettings={vi.fn()}
        current="archive"
      />,
    );
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('button')).toHaveLength(5);
    const archive = within(nav).getByRole('button', { name: 'Archived tasks' });
    expect(archive.getAttribute('aria-current')).toBe('page');
    fireEvent.click(archive);
    expect(onArchive).toHaveBeenCalledOnce();
  });
});
