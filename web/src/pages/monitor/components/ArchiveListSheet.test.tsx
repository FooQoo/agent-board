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
  cursor: 'c',
  tasks,
  epics: [],
});

const sheet = (props: Partial<Parameters<typeof ArchiveListSheet>[0]> = {}) =>
  render(
    <ArchiveListSheet
      data={response([task(5, 'done'), task(3, 'todo')])}
      status="ready"
      onRestore={async () => {}}
      onClose={() => {}}
      {...props}
    />,
  );

describe('ArchiveListSheet', () => {
  it('lists the archived tasks with the lane each one returns to', () => {
    sheet();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText('Returns to Done')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Returns to Todo')).toBeTruthy();
  });

  it('says so when nothing is archived', () => {
    sheet({ data: response([]) });
    expect(screen.getByText('No archived tasks')).toBeTruthy();
  });

  it('a tap chooses a row, and a second tap on another row moves the choice', async () => {
    const { container } = sheet();
    const row = container.ownerDocument.querySelector('[data-archive-row="3"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { pressed: false }));
    await waitFor(() => expect(row.hasAttribute('data-armed')).toBe(true));
    expect(row.hasAttribute('data-revealed')).toBe(false);
    const other = container.ownerDocument.querySelector('[data-archive-row="5"]') as HTMLElement;
    fireEvent.click(within(other).getByRole('button', { pressed: false }));
    await waitFor(() => expect(other.hasAttribute('data-armed')).toBe(true));
    expect(row.hasAttribute('data-armed')).toBe(false);
  });

  it('pressing Restore restores that task and drops it from the list', async () => {
    const onRestore = vi.fn(async () => {});
    sheet({ initialArmed: 3, initialRevealed: true, onRestore });
    fireEvent.click(screen.getByRole('button', { name: 'Restore #3' }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(3));
  });

  it('keeps the row and says so when the restore fails', async () => {
    const onRestore = vi.fn(async () => {
      throw new Error('no');
    });
    sheet({ initialArmed: 3, initialRevealed: true, onRestore });
    fireEvent.click(screen.getByRole('button', { name: 'Restore #3' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not restore');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('PhoneNavBar archive entries', () => {
  const bar = (props: Partial<Parameters<typeof PhoneNavBar>[0]> = {}) => {
    const handlers = {
      onBoard: vi.fn(),
      onMessages: vi.fn(),
      onAsk: vi.fn(),
      onArchive: vi.fn(),
      onBulkArchive: vi.fn(),
      onSettings: vi.fn(),
    };
    render(<PhoneNavBar {...handlers} {...props} />);
    return handlers;
  };

  it('Archive opens the list and the button on its right opens the bulk archive', () => {
    const handlers = bar();
    const nav = screen.getByRole('navigation');
    const buttons = within(nav).getAllByRole('button');
    fireEvent.click(within(nav).getByRole('button', { name: 'Archived tasks' }));
    expect(handlers.onArchive).toHaveBeenCalledOnce();
    const bulk = within(nav).getByRole('button', { name: 'Archive all' });
    expect(buttons.at(-1)).toBe(bulk);
    fireEvent.click(bulk);
    expect(handlers.onBulkArchive).toHaveBeenCalledOnce();
    expect(handlers.onArchive).toHaveBeenCalledOnce();
  });

  it('dims the bulk button when nothing is done, and marks the open one', () => {
    bar({ bulkArchiveDisabled: true, current: 'archive' });
    expect(
      (screen.getByRole('button', { name: 'Archive all' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Archived tasks' }).getAttribute('aria-current'),
    ).toBe('page');
  });
});
