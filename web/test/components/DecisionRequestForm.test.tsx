import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionRequestForm } from '../../src/features/tasks/answer/DecisionRequestForm';
import { selectLocale } from '../../src/shared/i18n';
import type {
  AnswerFormKey,
  AnswerFormState,
  AnswerFormStateStore,
} from '../../src/features/tasks/answer/model/answer';
import { noOperations } from '../../src/shared/lib/operations/operations';
import { makeTask, PROJECT_A } from '../fixtures';
import { WriteError } from '../../src/shared/api/writeErrors';

function memoryStore(): AnswerFormStateStore {
  const states = new Map<AnswerFormKey, AnswerFormState>();
  const listeners = new Map<AnswerFormKey, Set<() => void>>();
  return {
    getSnapshot: (key) => states.get(key) ?? null,
    subscribe: (key, listener) => {
      const current = listeners.get(key) ?? new Set();
      current.add(listener);
      listeners.set(key, current);
      return () => current.delete(listener);
    },
    update: (key, update) => {
      states.set(
        key,
        update(
          states.get(key) ?? {
            baseRequestId: 'request-15',
            choiceId: null,
            text: '',
            questionExpanded: false,
            phase: 'editing',
            failure: null,
            requestChanged: false,
          },
        ),
      );
      listeners.get(key)?.forEach((listener) => {
        listener();
      });
    },
  };
}

const pending = makeTask({
  id: 15,
  agentStatus: 'pending',
  pendingRequestId: 'request-15',
  pendingReason: 'Choose a direction',
  pendingChoices: [],
});
const pendingWithChoices = makeTask({
  ...pending,
  pendingChoices: [
    { id: 'keep', label: 'Keep current behavior' },
    { id: 'change', label: 'Change direction' },
  ],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  selectLocale('en');
});

describe('DecisionRequestForm', () => {
  it('uses an injected writer and restores its draft from an optional state store after remount', async () => {
    const store = memoryStore();
    const writeAnswer = vi.fn(async (_projectId, _taskId, _input) => ({
      task: pending,
      changed: true,
    }));
    const props = {
      projectId: PROJECT_A.id,
      task: pending,
      operations: noOperations,
      writeAnswer,
      stateStore: store,
    };
    const first = render(<DecisionRequestForm {...props} />);
    const textbox = screen.getByRole('textbox', { name: 'Your answer' });
    await userEvent.type(textbox, 'Keep the current behavior');
    first.unmount();

    render(<DecisionRequestForm {...props} />);
    expect(
      (screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value,
    ).toBe('Keep the current behavior');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(writeAnswer).toHaveBeenCalledTimes(1));
    expect(writeAnswer).toHaveBeenCalledWith(PROJECT_A.id, 15, {
      requestId: 'request-15',
      text: 'Keep the current behavior',
    });
  });

  it('keeps the input visible and disables editing when the host is locked', async () => {
    const props = {
      projectId: PROJECT_A.id,
      task: pending,
      operations: noOperations,
      writeAnswer: vi.fn(),
      disabled: true,
    };
    render(<DecisionRequestForm {...props} />);
    const textbox = screen.getByRole('textbox', { name: 'Your answer' });
    expect((textbox as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect((textbox as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps choice and free text while sending and ignores a second submit', async () => {
    const answer = deferred<{ task: typeof pendingWithChoices; changed: boolean }>();
    const writeAnswer = vi.fn(() => answer.promise);
    const props = {
      projectId: PROJECT_A.id,
      task: pendingWithChoices,
      operations: noOperations,
      writeAnswer,
    };
    render(<DecisionRequestForm {...props} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Keep current behavior' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Your answer' }), 'Keep the details');
    const send = screen.getByRole('button', { name: 'Send' });
    await userEvent.click(send);
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sending…' }));
    expect(writeAnswer).toHaveBeenCalledTimes(1);
    expect(writeAnswer).toHaveBeenCalledWith(PROJECT_A.id, 15, {
      requestId: 'request-15',
      choiceId: 'keep',
      text: 'Keep the details',
    });

    answer.resolve({ task: pendingWithChoices, changed: true });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(
      (screen.getByRole('textbox', { name: 'Your answer' }) as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('retains the same input after failure and retries it', async () => {
    const writeAnswer = vi
      .fn()
      .mockRejectedValueOnce(new WriteError('unavailable', 503, null))
      .mockResolvedValueOnce({ task: pending, changed: true });
    render(
      <DecisionRequestForm
        projectId={PROJECT_A.id}
        task={pending}
        operations={noOperations}
        writeAnswer={writeAnswer}
      />,
    );
    const textbox = screen.getByRole('textbox', { name: 'Your answer' });
    await userEvent.type(textbox, 'Try again with the same answer');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save. Try again.');
    expect((textbox as HTMLTextAreaElement).value).toBe('Try again with the same answer');

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(writeAnswer).toHaveBeenCalledTimes(2));
    expect(writeAnswer).toHaveBeenNthCalledWith(2, PROJECT_A.id, 15, {
      requestId: 'request-15',
      text: 'Try again with the same answer',
    });
    await waitFor(() => expect((textbox as HTMLTextAreaElement).value).toBe(''));
  });

  it('does not send an old request after the question changes, then sends the new request', async () => {
    const writeAnswer = vi.fn(async (_projectId, _taskId, _input) => ({
      task: pending,
      changed: true,
    }));
    const { rerender } = render(
      <DecisionRequestForm
        projectId={PROJECT_A.id}
        task={pendingWithChoices}
        operations={noOperations}
        writeAnswer={writeAnswer}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Keep current behavior' }));
    const nextRequest = {
      ...pending,
      pendingRequestId: 'request-16',
      pendingChoices: [{ id: 'new', label: 'Use the new request' }],
    };
    rerender(
      <DecisionRequestForm
        projectId={PROJECT_A.id}
        task={nextRequest}
        operations={noOperations}
        writeAnswer={writeAnswer}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('This request has changed.');
    expect(
      screen.getByRole('radio', { name: 'Use the new request' }).getAttribute('data-state'),
    ).toBe('unchecked');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('radio', { name: 'Use the new request' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(writeAnswer).toHaveBeenCalledTimes(1));
    expect(writeAnswer).toHaveBeenCalledWith(PROJECT_A.id, 15, {
      requestId: 'request-16',
      choiceId: 'new',
    });
  });

  it('limits free text by Unicode code points', async () => {
    render(
      <DecisionRequestForm
        projectId={PROJECT_A.id}
        task={pending}
        operations={noOperations}
        writeAnswer={vi.fn()}
      />,
    );
    const textbox = screen.getByRole('textbox', { name: 'Your answer' });
    fireEvent.change(textbox, { target: { value: '𠮷'.repeat(2000) } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.change(textbox, { target: { value: '𠮷'.repeat(2001) } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
