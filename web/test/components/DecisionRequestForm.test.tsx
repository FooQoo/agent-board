import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DecisionRequestForm } from '../../src/components/detail/DecisionRequestForm';
import { selectLocale } from '../../src/i18n';
import type { AnswerFormKey, AnswerFormState, AnswerFormStateStore } from '../../src/lib/answer';
import { noOperations } from '../../src/lib/projectSession';
import { makeTask, PROJECT_A } from '../fixtures';

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
});
