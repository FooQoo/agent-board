import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailView } from '../../src/features/tasks/detail/TaskDetailView';
import { selectLocale } from '../../src/shared/i18n';
import { PROJECT_A, makeTask } from '../fixtures';

describe('TaskDetailView', () => {
  beforeEach(() => selectLocale('en'));
  it('renders the shared task body without duplicating the task answer prompt', async () => {
    const onClose = vi.fn();
    const task = makeTask({
      id: 72,
      title: 'Awaiting API review',
      agentStatus: 'pending',
      pendingReason: 'Which API shape should we use?',
      pendingChoices: [
        { id: 'a', label: 'Keep the current interface' },
        { id: 'b', label: 'Add an adapter' },
      ],
      description: '## Work\nReview the routes.',
    });
    const { container } = render(
      <TaskDetailView
        projectId={PROJECT_A.id}
        task={task}
        tab="description"
        onTabChange={vi.fn()}
        onClose={onClose}
        ownerName={PROJECT_A.name}
        statusLabels="monitor"
        attachmentUrl={() => '/monitor/api/attachment'}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Awaiting API review' })).toBeTruthy();
    expect(screen.getByText('Review the routes.')).toBeTruthy();
    expect(screen.queryByText('Which API shape should we use?')).toBeNull();
    expect(container.querySelector('.detail__request')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /send|edit|archive|delete|answer/i })).toBeNull();
    expect(container.querySelector('.detail__tablist')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('localizes shared status labels when the selected locale is Japanese', () => {
    selectLocale('ja');
    render(
      <TaskDetailView
        projectId={PROJECT_A.id}
        task={makeTask({ id: 73, taskStatus: 'done', agentStatus: 'idle' })}
        tab="description"
        onTabChange={vi.fn()}
        onClose={vi.fn()}
        statusLabels="monitor"
      />,
    );
    expect(screen.getByText('完了')).toBeTruthy();
    expect(screen.queryByText('Done')).toBeNull();
    selectLocale('en');
  });
});
