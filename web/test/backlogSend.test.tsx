import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectId, TaskSummary } from '../src/shared/api/contracts';

const postTask = vi.fn();
vi.mock('../src/shared/api/write', () => ({ postTask: (...args: unknown[]) => postTask(...args) }));

const { sendTasks, withOpenQuestions } = await import('../src/features/backlog/send');
const { useBacklogSend } = await import('../src/features/backlog/useBacklogSend');
const { useBacklogSelection } = await import('../src/features/backlog/useSelection');

const PROJECT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90' as ProjectId;

function card(id: number, lane: TaskSummary['taskStatus'], open: string[] = []): TaskSummary {
  return {
    id,
    title: `Card ${id}`,
    assignee: 'ai',
    taskStatus: lane,
    taskStatusChangedAt: '',
    position: id,
    agentStatus: 'idle',
    agentStatusChangedAt: '',
    pendingReason: null,
    pendingRequestId: null,
    pendingChoices: [],
    openQuestionIds: open,
    epic: null,
    updatedAt: '',
    draft: null,
    acceptance: { done: 0, total: 0 },
  };
}

beforeEach(() => postTask.mockReset());

describe('withOpenQuestions', () => {
  it('names only the chosen cards that still have an open question', () => {
    const tasks = [card(1, 'backlog'), card(2, 'backlog', ['Q-1']), card(3, 'backlog', ['Q-2'])];
    expect(withOpenQuestions(tasks, [1, 2]).map((task) => task.id)).toEqual([2]);
  });
});

describe('sendTasks', () => {
  it('sends the cards one after another and reports the ones that failed', async () => {
    postTask
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('no'))
      .mockResolvedValueOnce({});
    const outcome = await sendTasks(PROJECT, [1, 2, 3], false);
    expect(outcome).toEqual({ sent: [1, 3], failed: [2] });
    expect(postTask.mock.calls.map((call) => call[0])).toEqual([
      `/api/projects/${PROJECT}/tasks/1/send`,
      `/api/projects/${PROJECT}/tasks/2/send`,
      `/api/projects/${PROJECT}/tasks/3/send`,
    ]);
    expect(postTask.mock.calls[0]?.[1]).toEqual({ ack: false });
  });
});

describe('useBacklogSend', () => {
  const tasks = [card(1, 'backlog'), card(2, 'backlog', ['Q-1']), card(3, 'todo')];

  it('sends at once without a warning and tells the counts before and after', async () => {
    postTask.mockResolvedValue({});
    const onSent = vi.fn();
    const { result } = renderHook(() => useBacklogSend(PROJECT, tasks, onSent));
    let started = false;
    act(() => {
      started = result.current.request([1]);
    });
    expect(started).toBe(true);
    await waitFor(() => expect(result.current.notice).toContain('Sent 1 card to Todo.'));
    expect(result.current.notice).toContain('Backlog 2 → 1, Todo 1 → 2');
    expect(onSent).toHaveBeenCalled();
  });

  it('asks for a confirmation when a card has an open question, and sends with the acknowledgement', async () => {
    postTask.mockResolvedValue({});
    const { result } = renderHook(() => useBacklogSend(PROJECT, tasks, vi.fn()));
    let started = true;
    act(() => {
      started = result.current.request([1, 2]);
    });
    expect(started).toBe(false);
    expect(result.current.confirming?.warned.map((task) => task.id)).toEqual([2]);
    expect(postTask).not.toHaveBeenCalled();
    act(() => result.current.cancel());
    expect(result.current.confirming).toBeNull();
    act(() => {
      result.current.request([1, 2]);
    });
    act(() => result.current.confirm());
    await waitFor(() => expect(result.current.notice).toContain('Sent 2 cards to Todo.'));
    expect(postTask.mock.calls.every((call) => (call[1] as { ack: boolean }).ack)).toBe(true);
  });

  it('drops a pending confirmation when the project changes', () => {
    const other = 'b1b2c3d4e5f60718293a4b5c6d7e8f90' as ProjectId;
    const { result, rerender } = renderHook(
      ({ project }) => useBacklogSend(project, tasks, vi.fn()),
      { initialProps: { project: PROJECT } },
    );
    act(() => {
      result.current.request([1, 2]);
    });
    expect(result.current.confirming).not.toBeNull();
    rerender({ project: other });
    expect(result.current.confirming).toBeNull();
    act(() => result.current.confirm());
    expect(postTask).not.toHaveBeenCalled();
  });

  it('sends the cards of an epic with the epic route', async () => {
    postTask.mockResolvedValue({ sent: [1, 2] });
    const { result } = renderHook(() => useBacklogSend(PROJECT, tasks, vi.fn()));
    act(() => {
      result.current.request([1], 'EPIC-1');
    });
    await waitFor(() => expect(postTask).toHaveBeenCalled());
    expect(postTask.mock.calls[0]?.[0]).toBe(`/api/projects/${PROJECT}/epics/EPIC-1/send`);
    expect(postTask.mock.calls[0]?.[1]).toEqual({ taskIds: [1], ack: false });
  });

  it('says that nothing changed when every card fails', async () => {
    postTask.mockRejectedValueOnce(new Error('no'));
    const { result } = renderHook(() => useBacklogSend(PROJECT, tasks, vi.fn()));
    act(() => {
      result.current.request([1]);
    });
    await waitFor(() =>
      expect(result.current.notice).toBe('Could not send to Todo. Nothing was changed.'),
    );
  });
});

describe('useBacklogSelection', () => {
  it('picks cards, drops the ones that left the Backlog, and leaves the mode', () => {
    const { result, rerender } = renderHook(({ ids }) => useBacklogSelection(ids), {
      initialProps: { ids: [1, 2, 3] },
    });
    act(() => result.current.enter());
    act(() => result.current.toggle(1));
    act(() => result.current.toggle(3));
    expect(result.current.picked).toEqual([1, 3]);
    act(() => result.current.toggle(1));
    expect(result.current.picked).toEqual([3]);
    rerender({ ids: [1, 2] });
    expect(result.current.picked).toEqual([]);
    act(() => result.current.leave());
    expect(result.current.selecting).toBe(false);
  });

  it('is not a mode while the Backlog is empty', () => {
    const { result } = renderHook(() => useBacklogSelection([]));
    act(() => result.current.enter());
    expect(result.current.selecting).toBe(false);
  });
});
