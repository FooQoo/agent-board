import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailPanel } from '../../src/features/tasks/detail/DetailPanel';
import { selectLocale } from '../../src/shared/i18n';
import type { Task } from '../../src/shared/api/contracts';
import { PROJECT_A, fixtureTask, makeTask } from '../fixtures';

const noop = () => {};
const noRemove = async () => true;

function renderPanel(task: Task, props: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
  return render(
    <DetailPanel
      projectId={PROJECT_A.id}
      task={task}
      onClose={noop}
      onRemove={noRemove}
      {...props}
    />,
  );
}

const SECTIONED = '## Goal\n- one\n- two\n\n## Steps\n1. first\n2. second\n3. third';

beforeEach(() => selectLocale('en'));

describe('tabs', () => {
  it('has a Description tab and a History tab with the number of history entries', () => {
    renderPanel(fixtureTask(8));
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Description',
      'Conditions',
      'History 3',
      'Epic',
    ]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /history/i })).toBeNull();
  });

  it('shows the history in the History tab and the description again in the Description tab', async () => {
    const { container } = renderPanel(
      makeTask({ ...fixtureTask(8), description: 'Body text', body: 'Body text' }),
    );
    expect(screen.getByRole('tabpanel').textContent).toBe('Body text');
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    expect(screen.getByRole('tabpanel').querySelectorAll('.history__step')).toHaveLength(3);
    expect(container.querySelectorAll('.history__step')).toHaveLength(3);
    expect(screen.getByRole('tabpanel').textContent).not.toContain('Body text');
    await userEvent.click(screen.getByRole('tab', { name: 'Description' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Body text');
  });

  it('moves between the tabs with the arrow keys', async () => {
    renderPanel(fixtureTask(8));
    screen.getByRole('tab', { name: 'Description' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Conditions' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Conditions' }));
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Description' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('shows the empty note for an empty description', () => {
    renderPanel(fixtureTask(12));
    expect(screen.getByRole('tabpanel').textContent).toBe('No description.');
  });

  it('puts the tabs directly below the task metadata', () => {
    const { container } = renderPanel(fixtureTask(12));
    const order = Array.from(container.querySelector('.detail')?.children ?? []).map(
      (el) => el.className.split(' ')[0],
    );
    expect(order).toEqual([
      'detail__top',
      'detail__title',
      'detail__meta',
      'detail__tabs',
      'detail__viewport',
      'detail__viewport',
      'detail__viewport',
      'detail__viewport',
    ]);
  });
});

describe('chapters of the description', () => {
  it('shows each H2 chapter as a plain heading and keeps every chapter open, with no fold control', async () => {
    const { container } = renderPanel(makeTask({ id: 50, description: `Intro\n\n${SECTIONED}` }));
    expect(container.querySelector('.md-chapter__number')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Goal' })).toBeTruthy();
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('Intro')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Goal/ })).toBeNull();
    // The chapters have no fold control; the conditions dock below the panel is the only one.
    expect(container.querySelector('.detail__viewport [aria-expanded]')).toBeNull();
  });

  it('keeps every chapter visible when the History tab is looked at and back', async () => {
    renderPanel(makeTask({ id: 50, description: SECTIONED }));
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Description' }));
    expect(screen.getByText('one')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Goal' })).toBeTruthy();
  });

  it('returns to the Description tab when another task is shown', async () => {
    const { rerender } = renderPanel(fixtureTask(8));
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(9)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Description' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('toolbar', () => {
  const names = () =>
    within(screen.getByRole('toolbar'))
      .getAllByRole('button')
      .map((b) => b.textContent || b.getAttribute('aria-label'));

  it('offers Make draft and Delete for an idle task that is not a draft, Delete last', () => {
    renderPanel(fixtureTask(8));
    expect(names()).toEqual(['Make draft', 'Archive task']);
  });

  it('offers the edit icon and Delete for a draft', () => {
    renderPanel({ ...fixtureTask(8), isDraft: true });
    expect(names()).toEqual(['Edit task', 'Archive task']);
  });

  it('offers Make draft for pending tasks but only Delete for running tasks', () => {
    const { rerender } = renderPanel(fixtureTask(11));
    expect(names()).toEqual(['Archive task']);
    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={fixtureTask(12)}
        onClose={noop}
        onRemove={noRemove}
      />,
    );
    expect(names()).toEqual(['Make draft', 'Archive task']);
  });

  it('offers Make draft to an idle task that has no run state of its own (Todo)', () => {
    renderPanel(fixtureTask(14));
    expect(names()).toEqual(['Make draft', 'Archive task']);
  });

  it('shows only Delete in the History tab', async () => {
    renderPanel({ ...fixtureTask(8), isDraft: true });
    await userEvent.click(screen.getByRole('tab', { name: /^History/ }));
    expect(names()).toEqual(['Archive task']);
  });

  it('calls onEdit with the task when the edit icon is pressed', async () => {
    const onEdit = vi.fn();
    const task = { ...fixtureTask(8), isDraft: true };
    renderPanel(task, { onEdit });
    await userEvent.click(screen.getByRole('button', { name: 'Edit task' }));
    expect(onEdit).toHaveBeenCalledWith(task);
  });

  it('opens the delete confirmation above the tabs', async () => {
    const { container } = renderPanel(fixtureTask(8));
    await userEvent.click(screen.getByRole('button', { name: 'Archive task' }));
    const confirm = container.querySelector('.delete-confirm') as HTMLElement;
    const tabs = container.querySelector('.detail__tabs') as HTMLElement;
    expect(confirm.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Description' })).toBeTruthy();
  });

  it('places restore and delete in the top toolbar and removes the normal toolbar actions', async () => {
    const onRestore = vi.fn();
    const onRemove = vi.fn(async () => true);
    const { container } = renderPanel(fixtureTask(8), { archived: true, onRestore, onRemove });
    const detail = container.querySelector('.detail') as HTMLElement;
    const order = Array.from(detail.children).map((element) => element.className.split(' ')[0]);
    expect(order).toEqual([
      'detail__top',
      'detail__title',
      'detail__meta',
      'detail__tabs',
      'detail__viewport',
      'detail__viewport',
      'detail__viewport',
      'detail__viewport',
    ]);
    const top = container.querySelector('.detail__top') as HTMLElement;
    const toolbar = within(top).getByRole('toolbar');
    expect(within(toolbar).getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: 'Delete task' })).toBeTruthy();
    expect(within(toolbar).queryByRole('button', { name: 'Make draft' })).toBeNull();
    expect(detail.querySelector('.detail__archive-actions')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('uses the inline delete confirmation to call the lifecycle action and explains removed data', async () => {
    const onRemove = vi.fn(async () => true);
    renderPanel(fixtureTask(8), { archived: true, onRemove });
    await userEvent.click(screen.getByRole('button', { name: 'Delete task' }));
    expect(screen.getByText(/description, images, and history/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onRemove).toHaveBeenCalledWith('delete', fixtureTask(8));
  });

  it('matches the Pen Japanese delete confirmation copy', async () => {
    selectLocale('ja');
    renderPanel(fixtureTask(8), { archived: true, onRemove: vi.fn() });
    await userEvent.click(screen.getByRole('button', { name: 'タスクを削除' }));
    expect(
      screen.getByText(
        '#8「Initialize the board」を削除しますか？ 本文・画像・履歴も削除されます。この操作は元に戻せません。',
      ),
    ).toBeTruthy();
    selectLocale('en');
  });

  it('shows restore failure in the selected detail and disables actions while saving', () => {
    renderPanel(fixtureTask(8), {
      archived: true,
      onRestore: vi.fn(),
      restoreFailed: true,
      operationSaving: true,
    });
    expect(screen.getByRole('alert').textContent).toBe('Could not restore the task. Try again.');
    expect(screen.getByRole('button', { name: 'Restore' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Delete task' }).hasAttribute('disabled')).toBe(true);
  });

  it('names the toolbar buttons in Japanese', () => {
    selectLocale('ja');
    renderPanel({ ...fixtureTask(8), isDraft: true });
    expect(names()).toEqual(['タスクを編集', 'タスクをアーカイブ']);
  });

  it('names the archived delete icon in Japanese inside the top toolbar', () => {
    selectLocale('ja');
    renderPanel(fixtureTask(8), { archived: true, onRestore: vi.fn() });
    const deleteButton = screen.getByRole('button', { name: 'タスクを削除' });
    expect(deleteButton.closest('.detail__top')).not.toBeNull();
    expect(screen.getByRole('button', { name: '復元' })).toBeTruthy();
  });
});

describe('epic tab', () => {
  const EPIC_LINKED = {
    id: 'FILE-SHARE',
    name: 'File share',
    color: '#7C3AED',
    isDraft: false,
    plan: '## Plan\n\nEpic plan text.',
    body: '## Plan\n\nEpic plan text.',
    acceptance: [{ id: 'AC-1', text: 'Epic condition', done: true }],
    acceptanceError: false,
    priority: [],
    priorityError: false,
    attachments: [],
    createdAt: '2026-10-02T00:00:00Z',
    updatedAt: '2026-10-02T00:00:00Z',
  };
  const linked = (id: number) =>
    makeTask({ id, epic: { id: 'FILE-SHARE', name: 'File share', color: '#7C3AED' } });

  it('says that a task without an epic belongs to none', async () => {
    renderPanel(makeTask({ id: 60, epic: null }), { epics: [] });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(screen.getByText('This task belongs to no epic.')).toBeTruthy();
  });

  it('shows the epic plan of the task in the epic tab', async () => {
    renderPanel(linked(61), { epics: [EPIC_LINKED] });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(screen.getByText('Epic plan text.')).toBeTruthy();
  });

  it('shows only task conditions in the dedicated conditions tab', async () => {
    const { container } = renderPanel(linked(62), { epics: [EPIC_LINKED] });
    await userEvent.click(screen.getByRole('tab', { name: 'Conditions' }));
    expect(container.querySelector('.detail__dock')).toBeNull();
    expect(within(screen.getByRole('tabpanel')).queryByText('Epic condition')).toBeNull();
    expect(within(screen.getByRole('tabpanel')).queryByRole('region', { name: 'Epic' })).toBeNull();
  });

  it('shows that the epic is still loading, and offers to try again when it cannot be read', async () => {
    const onRetryEpics = vi.fn();
    const { rerender } = renderPanel(linked(63), { epics: undefined });
    await userEvent.click(screen.getByRole('tab', { name: /^Epic/ }));
    expect(within(screen.getByRole('tabpanel')).getByText('Loading the epic…')).toBeTruthy();

    rerender(
      <DetailPanel
        projectId={PROJECT_A.id}
        task={linked(63)}
        onClose={noop}
        onRemove={noRemove}
        epics={[]}
        epicsFailed
        onRetryEpics={onRetryEpics}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('The epic could not be read.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryEpics).toHaveBeenCalledTimes(1);
  });
});
