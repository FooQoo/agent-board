import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../../src/features/tasks/card/TaskCard';
import { useTaskAnswers } from '../../src/features/tasks/answer/model/useTaskAnswers';
import { selectLocale } from '../../src/shared/i18n';
import type { AnswerLeaseChange } from '../../src/features/tasks/answer/model/useTaskAnswers';
import type { Task as TaskModel } from '../../src/shared/api/contracts';
import { deferred, jsonResponse } from '../fakes';
import { PROJECT_A, makeTask } from '../fixtures';

const LONG =
  'It is unclear whether to keep the existing data or start from scratch. There are three options: replace the old board, export it and import a new one, or keep both for now. Please decide which one to use.';
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
  function Harness({ value }: { value: TaskModel }) {
    const answers = useTaskAnswers(onLeaseChange);
    return (
      <TaskCard
        task={value}
        selected={false}
        onSelect={vi.fn()}
        projectId={PROJECT_A.id}
        answers={answers}
        syncedAt={new Date('2026-10-12T01:00:00Z')}
      />
    );
  }
  const utils = render(<Harness value={task} />);
  return {
    ...utils,
    rerenderTask: (next: TaskModel) => utils.rerender(<Harness value={next} />),
  };
}

const request = (container: HTMLElement) =>
  container.querySelector('.card__answer .detail__request') as HTMLElement;
const box = () => screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement;
const send = () => screen.getByRole('button', { name: /^(Send|Retry)$/ }) as HTMLButtonElement;
const choice = (label: string) => screen.getByRole('radio', { name: label });
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

beforeEach(() => {
  selectLocale('en');
  document.head.innerHTML = '<meta name="agboard-token" content="test-token">';
});

describe('PC task answer form', () => {
  it('shows the current Todo request and choices directly on the task', () => {
    const { container } = renderPendingTask();
    expect(request(container).textContent).toContain('Which way should the board go?');
    expect(within(request(container)).getAllByRole('radio')).toHaveLength(2);
    expect(box().value).toBe('');
    expect(send().disabled).toBe(true);
  });

  it('enables Send for a choice or non-blank text and sends the current request id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ task: pendingTask(), changed: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderPendingTask();
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
  });

  it('prevents duplicate sends and keeps the form locked during the request', async () => {
    const gate = deferred<Response>();
    const fetchMock = vi.fn(() => gate.promise);
    vi.stubGlobal('fetch', fetchMock);
    renderPendingTask();
    await userEvent.type(box(), 'Go');
    await userEvent.click(send());
    expect(screen.getByRole('button', { name: 'Sending…' })).toHaveProperty('disabled', true);
    expect(box().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.resolve(jsonResponse({ task: pendingTask(), changed: true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sending…' })).toBeNull());
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
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Keep me');
    await userEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save. Try again.');
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

  it('keeps an old draft but prevents sending it after the request changes', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: 'request_changed', message: 'x', reason: 'changed.' } }, 409),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = pendingTask();
    const { container, rerenderTask } = renderPendingTask(first);
    await userEvent.click(choice('Keep the data'));
    await userEvent.type(box(), 'Old answer');
    rerenderTask(
      pendingTask({
        pendingRequestId: 'req-2',
        pendingReason: 'A new question',
        pendingChoices: [{ id: 'other', label: 'Another path' }],
      }),
    );
    expect(request(container).textContent).toContain('A new question');
    expect(screen.getByRole('alert').textContent).toBe(
      'This request has changed. Review the latest board.',
    );
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

  it('cuts a long question to four lines and lets the user expand it', async () => {
    const lineBox = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(200);
    const client = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(78);
    try {
      const { container } = renderPendingTask(pendingTask({ pendingReason: LONG }));
      const reason = request(container).querySelector('.detail__reason') as HTMLElement;
      expect(reason.className).toContain('detail__reason--clamped');
      await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
      expect(reason.className).not.toContain('detail__reason--clamped');
    } finally {
      lineBox.mockRestore();
      client.mockRestore();
    }
  });

  it('keeps labels, hints and buttons in Japanese', async () => {
    selectLocale('ja');
    renderPendingTask();
    expect(screen.getByText('AIが回答を待っています')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '回答' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '送信' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy();
    expect(screen.getByText('選択肢を選ぶか、自由記述で回答できます。')).toBeTruthy();
  });
});
