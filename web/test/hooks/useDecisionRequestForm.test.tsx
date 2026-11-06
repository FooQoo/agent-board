import { act, renderHook } from '@testing-library/react';
import type { FormEvent } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDecisionRequestForm } from '../../src/features/tasks/answer/useDecisionRequestForm';
import { useTaskAnswers } from '../../src/features/tasks/answer/model/useTaskAnswers';
import { selectLocale } from '../../src/shared/i18n';
import type { OperationControls } from '../../src/shared/lib/operations/operations';
import type { TaskSummary } from '../../src/shared/api/contracts';
import { WriteError } from '../../src/shared/api/writeErrors';
import { makeTask, PROJECT_A } from '../fixtures';

const choices = [
  { id: 'keep', label: 'Keep' },
  { id: 'change', label: 'Change' },
];
const first = makeTask({
  id: 15,
  agentStatus: 'pending',
  pendingRequestId: 'r1',
  pendingReason: 'First question',
  pendingChoices: choices,
});
const replaced = makeTask({
  ...first,
  pendingRequestId: 'r2',
  pendingReason: 'Second question',
  pendingChoices: choices,
});
const withdrawn = makeTask({
  ...first,
  agentStatus: 'idle',
  pendingRequestId: null,
  pendingReason: null,
  pendingChoices: [],
});

const submitEvent = { preventDefault: () => {} } as FormEvent;

function operationSpies() {
  return {
    begin: vi.fn(() => 7),
    saveStarted: vi.fn(),
    saveFailed: vi.fn(),
    end: vi.fn(),
    taskRemoved: vi.fn(),
  } satisfies OperationControls;
}

interface Props {
  task: TaskSummary;
  missing?: boolean;
}

function setup(initial: Props, options: { store?: boolean; write?: () => Promise<never> } = {}) {
  const operations = operationSpies();
  const onLeaseChange = vi.fn();
  const writeAnswer = vi.fn(
    options.write ?? (async () => ({ task: withdrawn, changed: true }) as never),
  );
  const hook = renderHook(
    ({ task, missing }: Props) => {
      const answers = useTaskAnswers(onLeaseChange);
      const form = useDecisionRequestForm({
        projectId: PROJECT_A.id,
        task,
        operations,
        writeAnswer,
        disabled: false,
        stateStore: options.store === false ? undefined : answers.stateStore,
        missing,
      });
      return { answers, form };
    },
    { initialProps: initial },
  );
  return { ...hook, operations, writeAnswer, onLeaseChange };
}

beforeEach(() => {
  selectLocale('en');
});

describe('useDecisionRequestForm answer view', () => {
  it('reports hasInput for a choice or a note and no notice for a fresh question', () => {
    const { result } = setup({ task: first });
    expect(result.current.form.model).toMatchObject({
      hasInput: false,
      notice: null,
      failure: null,
      phase: 'editing',
    });
    act(() => result.current.form.updateText('memo'));
    expect(result.current.form.model.hasInput).toBe(true);
    act(() => result.current.form.clear());
    expect(result.current.form.model.hasInput).toBe(false);
    act(() => result.current.form.updateChoice('keep'));
    expect(result.current.form.model.hasInput).toBe(true);
  });

  it.each([{ store: true }, { store: false }])(
    'drops the choice, keeps the note and reports changed when the question is replaced ($store)',
    ({ store }) => {
      const { result, rerender } = setup({ task: first }, { store });
      act(() => {
        result.current.form.updateChoice('keep');
        result.current.form.updateText('my note');
      });
      rerender({ task: replaced });
      expect(result.current.form.model).toMatchObject({
        choiceId: null,
        text: 'my note',
        notice: 'changed',
        sendable: false,
      });
      act(() => result.current.form.updateChoice('keep'));
      expect(result.current.form.model).toMatchObject({
        choiceId: 'keep',
        notice: null,
        sendable: true,
      });
    },
  );

  it('shows the change notice and no choice when reopened after a replacement while closed', () => {
    const { result, unmount } = setup({ task: first });
    act(() => {
      result.current.form.updateChoice('change');
      result.current.form.updateText('kept note');
    });
    const answers = result.current.answers;
    unmount();
    const reopened = renderHook(() =>
      useDecisionRequestForm({
        projectId: PROJECT_A.id,
        task: replaced,
        operations: operationSpies(),
        writeAnswer: vi.fn(),
        disabled: false,
        stateStore: answers.stateStore,
      }),
    );
    expect(reopened.result.current.model).toMatchObject({
      choiceId: null,
      text: 'kept note',
      notice: 'changed',
    });
  });

  it('keeps the input readable and refuses to send once the request is withdrawn', async () => {
    const { result, rerender, writeAnswer } = setup({ task: first });
    act(() => {
      result.current.form.updateChoice('keep');
      result.current.form.updateText('still here');
    });
    rerender({ task: withdrawn });
    expect(result.current.form.model).toMatchObject({
      choiceId: 'keep',
      text: 'still here',
      notice: 'withdrawn',
      sendable: false,
      disabled: true,
    });
    await act(async () => {
      await result.current.form.submit(submitEvent);
    });
    expect(writeAnswer).not.toHaveBeenCalled();
  });

  it('treats a task that disappeared as withdrawn', () => {
    const { result, rerender } = setup({ task: first });
    act(() => result.current.form.updateText('memo'));
    rerender({ task: first, missing: true });
    expect(result.current.form.model).toMatchObject({
      text: 'memo',
      notice: 'withdrawn',
      sendable: false,
      disabled: true,
    });
  });
});

describe('useDecisionRequestForm operations', () => {
  it('holds an operation only while sending, not while the user types', async () => {
    const { result, operations, writeAnswer } = setup({ task: first });
    act(() => {
      result.current.form.updateChoice('keep');
      result.current.form.updateText('typing');
    });
    expect(operations.begin).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.form.submit(submitEvent);
    });
    expect(operations.begin).toHaveBeenCalledTimes(1);
    expect(operations.begin).toHaveBeenCalledWith('answer', PROJECT_A.id);
    expect(operations.saveStarted).toHaveBeenCalledWith(7);
    expect(writeAnswer).toHaveBeenCalledTimes(1);
    expect(operations.end).toHaveBeenCalledWith(7);
  });

  it('releases the operation after a failed send and keeps the input', async () => {
    const { result, operations } = setup(
      { task: first },
      {
        write: async () => {
          throw new WriteError('boom', 500, 'server_error');
        },
      },
    );
    act(() => result.current.form.updateText('retry me'));
    await act(async () => {
      await result.current.form.submit(submitEvent);
    });
    expect(operations.saveFailed).toHaveBeenCalledWith(7);
    expect(operations.end).toHaveBeenCalledWith(7);
    expect(result.current.form.model).toMatchObject({ phase: 'failed', text: 'retry me' });
  });
});
