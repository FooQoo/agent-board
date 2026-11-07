import { act, renderHook } from '@testing-library/react';
import type { FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { makeProject, makeTask } from '../../../../.storybook/support/fixtures';
import '../../../shared/i18n';
import { noOperations } from '../../../shared/lib/operations/operations';
import type { AnswerWriter } from './model/answer';
import { useDecisionRequestForm } from './useDecisionRequestForm';

const projectId = makeProject().id;
const asked = makeTask({
  id: 7,
  taskStatus: 'doing',
  agentStatus: 'pending',
  pendingRequestId: 'request-7',
  pendingReason: 'Which plan?',
  pendingChoices: [
    { id: 'a', label: 'Plan A' },
    { id: 'b', label: 'Plan B' },
  ],
});
const answered = { ...asked, agentStatus: 'idle' as const, pendingRequestId: null };
const event = { preventDefault: () => {} } as FormEvent;

function render(writeAnswer: AnswerWriter) {
  return renderHook(
    ({ task }) =>
      useDecisionRequestForm({
        projectId,
        task,
        operations: noOperations,
        writeAnswer,
        disabled: false,
      }),
    { initialProps: { task: asked } },
  );
}

describe('useDecisionRequestForm', () => {
  it('says a question is withdrawn when it goes away without an answer from here', () => {
    const { result, rerender } = render(vi.fn());
    rerender({ task: answered });
    expect(result.current.model.notice).toBe('withdrawn');
  });

  // I-029: the sheet closes after a successful answer, and while it slides away the task already
  // has no request. That is the answer just sent, not a withdrawn question.
  it('does not call its own answered question withdrawn', async () => {
    const writeAnswer = vi.fn<AnswerWriter>(async () => ({
      task: answered as never,
      changed: true,
    }));
    const { result, rerender } = render(writeAnswer);
    act(() => result.current.updateChoice('a'));
    await act(() => result.current.submit(event));
    expect(writeAnswer).toHaveBeenCalledTimes(1);
    rerender({ task: answered });
    expect(result.current.model.notice).toBeNull();
    expect(result.current.model.disabled).toBe(true);
    expect(result.current.model.sendable).toBe(false);
  });
});
