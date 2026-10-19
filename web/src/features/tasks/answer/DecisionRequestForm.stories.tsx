import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { noOperations } from '../../../shared/lib/operations/operations';
import type { AnswerFormKey, AnswerFormState, AnswerFormStateStore } from './model/answer';
import { DecisionRequestForm } from './DecisionRequestForm';
import { makeProject, makeTask } from '../../../../.storybook/support/fixtures';

const project = makeProject({ id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', name: 'answer-demo' });
const task = makeTask({
  id: 402,
  agentStatus: 'pending',
  pendingRequestId: 'request-402',
  pendingReason:
    'Choose whether to keep the current direction, or add a note explaining another option. This deliberately long question demonstrates the existing four-line clamp on narrow screens.',
  pendingChoices: [
    { id: 'keep', label: 'Keep current direction' },
    { id: 'change', label: 'Choose another direction' },
  ],
});

function stateStore(initial: AnswerFormState): AnswerFormStateStore {
  const key = `${project.id}:${task.id}:${task.pendingRequestId}` as AnswerFormKey;
  let current: AnswerFormState | null = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: (requested) => (requested === key ? current : null),
    subscribe: (requested, listener) => {
      if (requested !== key) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update: (requested, update) => {
      if (requested !== key) return;
      current = update(current ?? initial);
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

const meta = {
  title: 'Task/Answer/DecisionRequestForm',
  component: DecisionRequestForm,
  args: {
    projectId: project.id,
    task,
    operations: noOperations,
    writeAnswer: async () => ({ task, changed: true }),
  },
} satisfies Meta<typeof DecisionRequestForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

export const WithChoices: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Keep current direction' }));
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeEnabled();
  },
};

export const SendingRejectsDuplicateSubmit: Story = {
  args: {
    writeAnswer: () => new Promise<{ task: typeof task; changed: true }>(() => {}),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Your answer' }),
      'Wait for the server',
    );
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toBeDisabled();
  },
};

export const FailedThenRetry: Story = {
  args: {
    writeAnswer: (() => {
      let attempts = 0;
      return async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary failure');
        return { task, changed: true as const };
      };
    })(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const answer = 'Keep the note after a temporary failure';
    await userEvent.type(canvas.getByRole('textbox', { name: 'Your answer' }), answer);
    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('Could not save. Try again.');
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toHaveValue(answer);
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your answer' })).toHaveValue(''),
    );
  },
};

export const RestoresDraftFromStateStore: Story = {
  args: {
    stateStore: stateStore({
      baseRequestId: 'request-402',
      choiceId: 'keep',
      text: 'This draft survives unmount.',
      questionExpanded: false,
      phase: 'editing',
      failure: null,
      requestChanged: false,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Keep current direction' })).toBeChecked();
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toHaveValue(
      'This draft survives unmount.',
    );
  },
};

export const RequestChanged: Story = {
  args: {
    stateStore: stateStore({
      baseRequestId: 'request-402',
      choiceId: null,
      text: 'Review the updated request.',
      questionExpanded: false,
      phase: 'editing',
      failure: null,
      requestChanged: true,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('This request has changed.');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};
