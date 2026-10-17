import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EpicDetailPanel } from '../../src/components/epics/EpicDetailPanel';
import { EpicList, type EpicListProps } from '../../src/components/epics/EpicList';
import { selectLocale } from '../../src/i18n';
import type { Epic, EpicTaskCounts } from '../../src/types';
import { PROJECT_A } from '../fixtures';

beforeEach(() => selectLocale('en'));

function epic(id: string, overrides: Partial<Epic> = {}): Epic {
  return {
    id,
    name: `${id} name`,
    color: '#3366CC',
    isDraft: false,
    plan: '',
    body: '',
    priority: [],
    priorityError: false,
    attachments: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

const counts = (todo: number, doing: number, done: number, archived: number): EpicTaskCounts => ({
  todo,
  doing,
  done,
  archived,
  total: todo + doing + done + archived,
});

function renderList(props: Partial<EpicListProps> = {}) {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  render(
    <EpicList
      epics={[epic('BUG'), epic('ENHANCEMENT')]}
      counts={{ BUG: counts(2, 1, 0, 3), ENHANCEMENT: counts(0, 0, 0, 0) }}
      status="ready"
      fetchFailed={false}
      selectedId={null}
      onSelect={onSelect}
      onRetry={onRetry}
      {...props}
    />,
  );
  return { onSelect, onRetry };
}

describe('EpicList', () => {
  it('shows each epic with its four counts in lane order and its total', () => {
    renderList();
    const bug = screen.getByRole('button', { name: /BUG/ });
    const group = within(bug).getByRole('group', { name: 'Tasks by state' });
    expect(within(group).getByText('Todo').nextElementSibling?.textContent).toBe('2');
    expect(within(group).getByText('Doing').nextElementSibling?.textContent).toBe('1');
    expect(within(group).getByText('Done').nextElementSibling?.textContent).toBe('0');
    expect(within(group).getByText('Archived').nextElementSibling?.textContent).toBe('3');
    expect(within(bug).getByText('Total 6 tasks')).toBeTruthy();
    expect(
      within(screen.getByRole('button', { name: /ENHANCEMENT/ })).getByText('Total 0 tasks'),
    ).toBeTruthy();
  });

  it('selects an epic and deselects it when the same row is pressed again', async () => {
    const { onSelect } = renderList({ selectedId: 'BUG' });
    expect(screen.getByRole('button', { name: /BUG/ }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: /BUG/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: /ENHANCEMENT/ }));
    expect(onSelect).toHaveBeenLastCalledWith('ENHANCEMENT');
  });

  it('moves focus back to the row when its details close', () => {
    const props: EpicListProps = {
      epics: [epic('BUG'), epic('ENHANCEMENT')],
      counts: { BUG: counts(2, 1, 0, 3), ENHANCEMENT: counts(0, 0, 0, 0) },
      status: 'ready',
      fetchFailed: false,
      selectedId: 'BUG',
      onSelect: vi.fn(),
      onRetry: vi.fn(),
    };
    const { rerender } = render(<EpicList {...props} />);
    rerender(<EpicList {...props} selectedId={null} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /BUG/ }));
  });

  it('keeps a missing count as a dash rather than zero', () => {
    renderList({ counts: { BUG: counts(1, 0, 0, 0) } });
    const enhancement = screen.getByRole('button', { name: /ENHANCEMENT/ });
    expect(within(enhancement).getAllByText('—')).toHaveLength(2);
    expect(enhancement.textContent).not.toContain('0');
  });

  it('shows the loading state, a load failure with retry, and a refresh failure beside the rows', async () => {
    renderList({ status: 'loading', epics: undefined });
    expect(screen.getByRole('status').textContent).toBe('Loading…');

    const { onRetry } = renderList({ status: 'error', epics: undefined });
    expect(screen.getByRole('alert').textContent).toContain('Could not load the epics.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();

    renderList({ fetchFailed: true });
    expect(screen.getByText('Could not refresh the epics.')).toBeTruthy();
  });

  it('marks a draft epic with the Draft label and leaves the others unmarked', () => {
    renderList({ epics: [epic('BUG'), epic('DRAFTY', { isDraft: true })] });
    expect(within(screen.getByRole('button', { name: /DRAFTY/ })).getByText('Draft')).toBeTruthy();
    expect(within(screen.getByRole('button', { name: /BUG/ })).queryByText('Draft')).toBeNull();
  });

  it('shows the empty state when there are no epics', () => {
    renderList({ epics: [], counts: {} });
    expect(screen.getByText('No epics yet')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Epics in this project' })).toBeNull();
  });
});

describe('EpicDetailPanel', () => {
  it('shows the label, name, and plan, and offers edit and close', async () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(
      <EpicDetailPanel
        projectId={PROJECT_A.id}
        epic={epic('BUG', { name: 'Bugs', body: '## Goal\n\nFix it.' })}
        onEdit={onEdit}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Bugs' })).toBeTruthy();
    expect(screen.getByText('Fix it.')).toBeTruthy();
    expect(screen.queryByText('No plan yet')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit epic' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // Edit and close sit in one toolbar, as the design has them, so they share one gap.
    const toolbar = screen.getByRole('toolbar', { name: 'Epic actions' });
    expect(within(toolbar).getByRole('button', { name: 'Close details' })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: 'Edit epic' })).toBeTruthy();
  });

  it('marks a draft epic in its details', () => {
    render(
      <EpicDetailPanel
        projectId={PROJECT_A.id}
        epic={epic('DRAFTY', { isDraft: true, body: 'Plan.' })}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('says there is no plan yet when the body is empty', () => {
    render(
      <EpicDetailPanel
        projectId={PROJECT_A.id}
        epic={epic('BUG', { body: '   ' })}
        onEdit={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('No plan yet')).toBeTruthy();
    // The plan is the only placeholder: the Markdown view's own "No description." is not shown too.
    expect(screen.queryByText('No description.')).toBeNull();
  });
});
