import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../../src/features/tasks/card/TaskCard';
import { useTaskAnswers } from '../../src/features/tasks/answer/model/useTaskAnswers';
import { i18n } from '../../src/shared/i18n';
import { fixtureTask, makeTask } from '../fixtures';

const noop = () => {};

describe('Task', () => {
  it('shows the id, title and the local update time', () => {
    render(<TaskCard task={fixtureTask(14)} selected={false} onSelect={noop} />);
    expect(screen.getByText('#14')).toBeTruthy();
    expect(screen.getByText('Prepare the Windows build')).toBeTruthy();
    expect(screen.getByText('Updated 10/02 10:08')).toBeTruthy();
  });

  it('shows no run state for tasks in Todo or Done', () => {
    const { rerender } = render(
      <TaskCard task={fixtureTask(14)} selected={false} onSelect={noop} />,
    );
    for (const label of ['Idle', 'Running', 'Pending'])
      expect(screen.queryByText(label)).toBeNull();
    rerender(<TaskCard task={fixtureTask(8)} selected={false} onSelect={noop} />);
    for (const label of ['Idle', 'Running', 'Pending'])
      expect(screen.queryByText(label)).toBeNull();
  });

  it('shows acceptance progress in the card footer', () => {
    const task = makeTask({
      id: 42,
      acceptance: [{ id: 'AC-1', text: 'Ready', done: false }],
    });
    const { container } = render(<TaskCard task={task} selected={false} onSelect={noop} />);
    const footer = container.querySelector('.card__foot');
    expect(footer?.querySelector('.acceptance-chip')).not.toBeNull();
  });

  it('shows the run state badge for tasks in Doing', () => {
    const { rerender } = render(
      <TaskCard task={fixtureTask(11)} selected={false} onSelect={noop} />,
    );
    expect(screen.getByText('Running')).toBeTruthy();
    rerender(<TaskCard task={fixtureTask(13)} selected={false} onSelect={noop} />);
    expect(screen.getByText('Idle')).toBeTruthy();
    rerender(<TaskCard task={fixtureTask(12)} selected={false} onSelect={noop} />);
    expect(screen.getByText('Pending')).toBeTruthy();
  });

  it('translates the column run state and update label without changing task input or time', async () => {
    const task = makeTask({
      id: 40,
      title: 'Keep this title as entered',
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingReason: 'Keep this waiting reason as entered',
      updatedAt: '2026-10-02T10:08:00Z',
    });
    try {
      render(<TaskCard task={task} selected={true} onSelect={noop} />);
      expect(screen.getByText('Updated 10/02 10:08')).toBeTruthy();
      await act(async () => {
        await i18n.changeLanguage('ja');
      });
      expect(screen.getByText('待機中')).toBeTruthy();
      expect(screen.getByText('更新 10/02 10:08')).toBeTruthy();
      expect(screen.getByText('Keep this title as entered')).toBeTruthy();
      expect(screen.getByText('Keep this waiting reason as entered')).toBeTruthy();
      expect(screen.getByRole('button').getAttribute('aria-current')).toBe('true');
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('shows the waiting reason only for pending tasks', () => {
    const { rerender } = render(
      <TaskCard task={fixtureTask(12)} selected={false} onSelect={noop} />,
    );
    expect(screen.getByText('Waiting for confirmation on how to replace a board.')).toBeTruthy();
    rerender(<TaskCard task={fixtureTask(11)} selected={false} onSelect={noop} />);
    expect(screen.queryByText(/Waiting for/)).toBeNull();
  });

  it('marks pending tasks so they can be highlighted', () => {
    const { container } = render(
      <TaskCard task={fixtureTask(12)} selected={false} onSelect={noop} />,
    );
    expect(container.querySelector('.card--pending')).not.toBeNull();
  });

  it('shows the pending answer on the task without turning form clicks into task selection', async () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useTaskAnswers(vi.fn(), vi.fn()));
    const task = makeTask({
      id: 41,
      taskStatus: 'todo',
      agentStatus: 'pending',
      pendingRequestId: 'request-41',
      pendingReason: 'Choose a direction',
    });

    const { container } = render(
      <TaskCard
        task={task}
        selected={false}
        onSelect={onSelect}
        projectId="project-1"
        answers={result.current}
      />,
    );

    const answer = screen.getByRole('textbox', { name: 'Your answer' });
    await userEvent.click(answer);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();

    const taskButton = container.querySelector('.card');
    if (!taskButton) throw new Error('task button is missing');
    await userEvent.click(taskButton);
    expect(onSelect).toHaveBeenCalledWith(41);
  });

  it('keeps the waiting reason visible when no decision request is active', () => {
    const { result } = renderHook(() => useTaskAnswers(vi.fn(), vi.fn()));
    const task = makeTask({
      id: 42,
      taskStatus: 'doing',
      agentStatus: 'pending',
      pendingReason: 'Waiting for the request to be restored.',
      pendingRequestId: null,
    });

    render(
      <TaskCard
        task={task}
        selected={false}
        onSelect={noop}
        projectId="project-1"
        answers={result.current}
      />,
    );

    expect(screen.getByText('Waiting for the request to be restored.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull();
  });

  it('renders markup in a title as plain text', () => {
    const task = makeTask({ id: 30, title: '<b>Bold</b> <script>alert(1)</script>' });
    const { container } = render(<TaskCard task={task} selected={false} onSelect={noop} />);
    expect(screen.getByText('<b>Bold</b> <script>alert(1)</script>')).toBeTruthy();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('reflects the selection and reports clicks', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <TaskCard task={fixtureTask(8)} selected={false} onSelect={onSelect} />,
    );
    const button = screen.getByRole('button', { name: /Initialize the board/ });
    expect(button.getAttribute('aria-current')).toBe('false');
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(8);
    rerender(<TaskCard task={fixtureTask(8)} selected={true} onSelect={onSelect} />);
    expect(button.getAttribute('aria-current')).toBe('true');
  });

  it('draws the grip as decoration that cannot take focus', async () => {
    const { container } = render(
      <TaskCard task={fixtureTask(8)} selected={false} onSelect={noop} />,
    );
    const grip = container.querySelector('svg.grip');
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute('aria-hidden')).toBe('true');
    expect(grip?.getAttribute('focusable')).toBe('false');
    const button = screen.getByRole('button');
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    await userEvent.tab();
    expect(document.activeElement).toBe(document.body);
  });
});
