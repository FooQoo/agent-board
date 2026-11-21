import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/shared/i18n';
import { MonitorView } from '../../src/pages/monitor/View';
import type { MonitorViewProps } from '../../src/pages/monitor/contracts';
import { makeTask, PROJECT_A } from '../fixtures';

function props(): MonitorViewProps {
  const item = (
    id: number,
    taskStatus: 'todo' | 'doing' | 'done',
    agentStatus: 'idle' | 'running' | 'pending',
  ) => ({
    projectId: PROJECT_A.id,
    projectName: PROJECT_A.name,
    task: makeTask({
      id,
      taskStatus,
      agentStatus,
      pendingReason: agentStatus === 'pending' ? 'Waiting for decision' : null,
      pendingRequestId: agentStatus === 'pending' ? `request-${id}` : null,
      pendingChoices: agentStatus === 'pending' ? [{ id: 'choice', label: 'Continue' }] : [],
    }),
  });
  return {
    summary: { backlog: 0, todo: 1, doing: 3, done: 1 },
    backlog: [],
    todo: [item(1, 'todo', 'idle')],
    doing: [item(2, 'doing', 'running'), item(4, 'doing', 'pending'), item(5, 'doing', 'idle')],
    done: [item(3, 'done', 'idle')],
    freshness: {
      state: 'fresh',
      lastFetchedAt: '2026-10-11T00:00:00Z',
      snapshotProblems: [],
    },
    onRefresh: vi.fn(),
  };
}

/** The view with the messages routes the page gives it. */
function Connected() {
  return (
    <MonitorView
      {...props()}
      projectId="p"
      messages={[]}
      messagesApi={{ read: vi.fn(), answer: vi.fn(), withdraw: vi.fn() }}
    />
  );
}

describe('MonitorView', () => {
  beforeEach(() => selectLocale('en'));
  it('lists each task once in its Todo, Doing, or Done lane', () => {
    const { container } = render(<Connected />);
    expect(container.querySelector('header.header')).toBeTruthy();
    const tabs = screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'));
    expect(tabs).toEqual(['Backlog 0', 'Todo 1', 'Doing 3', 'Done 1']);
    expect(screen.getAllByRole('article', { name: /^#4 / })).toHaveLength(1);
    const pendingTask = screen.getByRole('article', { name: /^#4 Doing Pending / });
    expect(pendingTask.querySelector('.status-label')?.textContent).toBe('Pending');
    // A decision card shows the button only: no question, no choices, no note.
    expect(within(pendingTask).getByRole('button', { name: 'Answer the question' })).toBeTruthy();
    expect(within(pendingTask).queryByText('Waiting for decision')).toBeNull();
    expect(within(pendingTask).queryByRole('textbox')).toBeNull();
    expect(within(pendingTask).queryByRole('button', { name: 'Send' })).toBeNull();
    expect(pendingTask.getAttribute('data-agent-status')).toBe('pending');
    const idleTodo = screen.getByRole('article', { name: /^#1 Todo Idle / });
    expect(idleTodo.getAttribute('data-agent-status')).toBe('idle');
    expect(idleTodo.querySelector('.status-label')?.textContent).toBe('Idle');
    const idleDoing = screen.getByRole('article', { name: /^#5 Doing Idle / });
    expect(idleDoing.getAttribute('data-agent-status')).toBe('idle');
    expect(idleDoing.querySelector('.status-label')?.textContent).toBe('Idle');

    const doneTask = screen.getByRole('article', { name: /^#3 Done / });
    expect(doneTask.querySelector('.status-label')).toBeNull();
    expect(
      (
        within(doneTask).getByRole('button', {
          name: 'Task 3',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The bar's Archive item is the only archive control in view; nothing deletes or edits.
    expect(
      screen.getAllByRole('button', { name: /Archive|Delete|Edit/ }).map((b) => b.textContent),
    ).toEqual(['Archive']);
  });

  it('changes lane tab and run state labels with the locale', () => {
    render(<MonitorView {...props()} />);
    const tabs = {
      en: ['Backlog 0', 'Todo 1', 'Doing 3', 'Done 1'],
      ja: ['Backlog 0件', '未着手 1件', '進行中 3件', '完了 1件'],
    };
    for (const locale of ['en', 'ja', 'en'] as const) {
      act(() => {
        selectLocale(locale);
      });
      expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual(
        tabs[locale],
      );
      const runningLabel = locale === 'ja' ? '稼働中' : 'Running';
      const running = screen.getByRole('article', { name: new RegExp(`^#2 .*${runningLabel} `) });
      expect(running.querySelector('.status-label')?.textContent).toBe(runningLabel);
    }
  });
});
