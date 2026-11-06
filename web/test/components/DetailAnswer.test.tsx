import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { TaskCard } from '../../src/features/tasks/card/TaskCard';
import { DecisionAnswerDialogContainer } from '../../src/features/tasks/answer/DecisionAnswerDialogContainer';
import { noOperations } from '../../src/shared/lib/operations/operations';
import { useTaskAnswers } from '../../src/features/tasks/answer/model/useTaskAnswers';
import { selectLocale } from '../../src/shared/i18n';
import type { AnswerLeaseChange } from '../../src/features/tasks/answer/model/useTaskAnswers';
import type { Task as TaskModel } from '../../src/shared/api/contracts';
import { deferred, jsonResponse } from '../fakes';
import { PROJECT_A, makeTask } from '../fixtures';

const pendingTask = (overrides: Partial<TaskModel> = {}): TaskModel =>
  makeTask({
    id: 12,
    title: 'Pending task',
    taskStatus: 'todo',
    agentStatus: 'pending',
    pendingRequestId: 'req-1',
    pendingReason: 'Which way should the board go?',
    pendingChoices: [
      { id: 'keep', label: 'Keep the data' },
      { id: 'reset', label: 'Start over' },
    ],
    ...overrides,
  });

function renderPendingTask(
  task: TaskModel = pendingTask(),
  onLeaseChange: AnswerLeaseChange = vi.fn(),
) {
  function Harness({ value, missing }: { value: TaskModel; missing: boolean }) {
    const answers = useTaskAnswers(onLeaseChange);
    const [open, setOpen] = useState(false);
    return (
      <>
        <TaskCard
          task={value}
          selected={false}
          onSelect={vi.fn()}
          projectId={PROJECT_A.id}
          answers={answers}
          onAnswer={() => setOpen(true)}
        />
        {open && (
          <DecisionAnswerDialogContainer
            projectId={PROJECT_A.id}
            taskId={value.id}
            task={missing ? null : value}
            answers={answers}
            operations={noOperations}
            syncedAt={new Date('2026-10-12T01:00:00Z')}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  const utils = render(<Harness value={task} missing={false} />);
  return {
    ...utils,
    rerenderTask: (next: TaskModel, missing = false) =>
      utils.rerender(<Harness value={next} missing={missing} />),
  };
}

const answerButton = () =>
  screen.getByRole('button', { name: /^(Answer the question|Continue answering)$/ });
const openDialog = async () => {
  await userEvent.click(answerButton());
  return screen.findByRole('dialog');
};
const box = () => screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: /^(Send|Retry)$/ }) as HTMLButtonElement;
const choice = (label: string) => screen.getByRole('radio', { name: label });
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});

describe('PC task answer dialog', () => {
  it('shows only the answer button on the card and the question, choices and note in the dialog', async () => {
    const { container } = renderPendingTask();
    expect(container.querySelector('.card__answer')?.textContent).toBe('Answer the question');
    expect(screen.queryByText('Which way should the board go?')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    const dialog = await openDialog();
    expect(await within(dialog).findByText('Which way should the board go?')).toBeTruthy();
    expect(within(dialog).getAllByRole('radio')).toHaveLength(2);
    expect(box().value).toBe('');
    expect(send().disabled).toBe(true);
  });

  it('enables Send for a choice or non-blank text, sends the current request id and closes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: pendingTask(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderPendingTask();
    await openDialog();
    await userEvent.type(box(), '   ');
    expect(send().disabled).toBe(true);
    await userEvent.click(choice('Start over'));
    expect(send().disabled).toBe(false);
    await userEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      `/api/projects/${PROJECT_A.id}/tasks/12/answer`,
    );
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      requestId: 'req-1',
      choiceId: 'reset',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('prevents duplicate sends and keeps the form locked during the request', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderPendingTask();
    await openDialog();
    await userEvent.type(box(), 'Go');
    await userEvent.click(send());
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveProperty('disabled', true);
    expect(box().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.resolve(jsonResponse({ task: pendingTask(), changed: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the input after a save failure and retries the same answer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'database_busy', message: 'x', reason: 'busy' } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse({ task: pendingTask(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderPendingTask();
    await openDialog();
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Keep me');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save. Try again.');
    expect(box().value).toBe('Keep me');
    expect(choice('Keep the data').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(bodyOf(fetchMock.mock.calls[1] as unknown[])).toEqual({
      requestId: 'req-1',
      choiceId: 'keep',
      text: 'Keep me',
    });
  });

  it('shows the new question, drops the choice and keeps the note when the request changes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: pendingTask(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerenderTask } = renderPendingTask(pendingTask());
    await openDialog();
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Old answer');
    rerenderTask(
      pendingTask({
        pendingRequestId: 'req-2',
        pendingReason: 'A new question',
        pendingChoices: [{ id: 'other', label: 'Another path' }],
      }),
    );
    expect(await screen.findByText('A new question')).toBeTruthy();
    expect(screen.getByText('The question has changed. Review it and answer again.')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Keep the data' })).toBeNull();
    expect(box().value).toBe('Old answer');
    expect(send().disabled).toBe(true);
    await userEvent.type(box(), ' again');
    await userEvent.click(send());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock.mock.calls[0] as unknown[])).toEqual({
      requestId: 'req-2',
      text: 'Old answer again',
    });
  });

  it('keeps the last question readable and stops sending when the request is withdrawn or the card is gone', async () => {
    const { rerenderTask } = renderPendingTask(pendingTask());
    await openDialog();
    await userEvent.type(box(), 'Half way');
    rerenderTask(
      pendingTask({
        agentStatus: 'idle',
        pendingRequestId: null,
        pendingReason: null,
        pendingChoices: [],
      }),
    );
    expect(
      await screen.findByText('This question was withdrawn. You can no longer answer it.'),
    ).toBeTruthy();
    expect(screen.getByText('Which way should the board go?')).toBeTruthy();
    expect(box().value).toBe('Half way');
    expect(box().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
    rerenderTask(
      pendingTask({
        agentStatus: 'idle',
        pendingRequestId: null,
        pendingReason: null,
        pendingChoices: [],
      }),
      true,
    );
    expect(screen.getByText('Which way should the board go?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Send$/ })).toBeNull();
  });

  it('keeps the input when the dialog is closed and offers to continue', async () => {
    const onLeaseChange = vi.fn();
    renderPendingTask(pendingTask(), onLeaseChange);
    await openDialog();
    await userEvent.type(box(), 'Not yet');
    expect(onLeaseChange).toHaveBeenLastCalledWith(expect.any(String), PROJECT_A.id, true);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onLeaseChange).toHaveBeenLastCalledWith(expect.any(String), PROJECT_A.id, false);
    await waitFor(() => expect(answerButton().textContent).toBe('Continue answering'));
    await waitFor(() => expect(document.activeElement).toBe(answerButton()));
    await openDialog();
    expect(box().value).toBe('Not yet');
  });

  it('keeps labels and buttons in Japanese', async () => {
    selectLocale('ja');
    renderPendingTask();
    await userEvent.click(screen.getByRole('button', { name: '質問に回答する' }));
    await screen.findByRole('dialog');
    expect(screen.getByRole('textbox', { name: 'メモ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy();
    expect(screen.getByText('選択肢を選ぶか、メモだけでも回答できます。')).toBeTruthy();
  });
});
