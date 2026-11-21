import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/shared/i18n';
import type { ArchivedTask } from '../../src/features/tasks/api/read';
import { ArchiveList, type ArchiveListProps } from '../../src/pages/archive/ui/ArchiveList';
import { makeProject, makeTask } from '../../.storybook/support/fixtures';

afterEach(cleanup);

const rows = (count: number): ArchivedTask[] =>
  Array.from({ length: count }, (_, i) => ({
    ...makeTask({ id: count - i, title: `Archived ${count - i}` }),
    archivedAt: '2026-10-01T10:00:00Z',
  })) as ArchivedTask[];

function pages(count: number, extra: Partial<Omit<ArchiveListProps['pages'], 'data'>> = {}) {
  return {
    status: 'ready' as const,
    data: { project: makeProject(), version: 'v', tasks: rows(count), epics: [], total: count },
    fetchFailed: false,
    hasMore: false,
    loadingMore: false,
    loadMoreFailed: false,
    loadMore: vi.fn(),
    retryMore: vi.fn(),
    reload: vi.fn(),
    ...extra,
  };
}

const list = (p: ReturnType<typeof pages>) =>
  render(<ArchiveList pages={p} selectedId={null} onSelect={() => {}} />);

describe('ArchiveList paging', () => {
  it('asks for the next page when the last row is in the rendered range', () => {
    const p = pages(4, { hasMore: true });
    list(p);
    expect(p.loadMore).toHaveBeenCalled();
  });

  it('does not ask while the last row is far below the viewport', () => {
    // jsdom measures nothing, so give each row the height it has in a browser.
    const measure = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('archive-row') ? 84 : 0;
      });
    const p = pages(200, { hasMore: true });
    list(p);
    expect(screen.getAllByRole('listitem').length).toBeLessThan(200);
    expect(p.loadMore).not.toHaveBeenCalled();
    measure.mockRestore();
  });

  it('does not ask after the last page, and says it is the end', () => {
    const p = pages(4);
    list(p);
    expect(p.loadMore).not.toHaveBeenCalled();
    expect(screen.getByTestId('archive-end')).toBeTruthy();
  });

  it('does not ask again by itself while loading or after a failure', () => {
    const loading = pages(4, { hasMore: true, loadingMore: true });
    list(loading);
    expect(loading.loadMore).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toBeTruthy();
    cleanup();
    const failed = pages(4, { hasMore: true, loadMoreFailed: true });
    list(failed);
    expect(failed.loadMore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(failed.retryMore).toHaveBeenCalledOnce();
  });

  it('shows the project total, not the rows read so far', () => {
    const p = pages(4, { hasMore: true });
    list({ ...p, data: { ...p.data, total: 321 } });
    expect(screen.getByText('321 archived tasks')).toBeTruthy();
  });
});
