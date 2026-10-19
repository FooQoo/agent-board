import type { Meta, StoryObj } from '@storybook/react-vite';
import type { FormEvent } from 'react';
import { expect, fn, within } from 'storybook/test';
import { DecisionRequestFormView } from './DecisionRequestFormView';
import type { DecisionRequestFormModel } from './useDecisionRequestForm';

const question =
  'Choose whether to keep the current direction, or add a note explaining another option. This deliberately long question demonstrates the existing four-line clamp on narrow screens.';
const choices = [
  { id: 'keep', label: 'Keep current direction' },
  { id: 'change', label: 'Choose another direction' },
];
const baseModel: DecisionRequestFormModel = {
  choiceId: null,
  text: '',
  questionExpanded: false,
  phase: 'editing',
  message: null,
  tooLong: false,
  sendable: false,
  disabled: false,
};

const meta = {
  title: 'Task/Answer/DecisionRequestFormView',
  component: DecisionRequestFormView,
  args: {
    question,
    choices,
    model: baseModel,
    onChoiceChange: fn(),
    onTextChange: fn(),
    onExpandQuestion: fn(),
    onClear: fn(),
    onSubmit: fn((event: FormEvent<HTMLFormElement>) => event.preventDefault()),
  },
} satisfies Meta<typeof DecisionRequestFormView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

export const ChoicesAndSelected: Story = {
  args: { model: { ...baseModel, choiceId: 'keep', sendable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Keep current direction' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Choose another direction' })).not.toBeChecked();
  },
};

export const FreeTextOnly: Story = {
  args: {
    choices: [],
    model: { ...baseModel, text: 'Please keep the current behavior.', sendable: true },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Answer in your own words.')).toBeInTheDocument();
    await expect(within(canvasElement).getByRole('textbox', { name: 'Your answer' })).toHaveValue(
      'Please keep the current behavior.',
    );
  },
};

export const Sending: Story = {
  args: {
    model: { ...baseModel, text: 'Waiting for the server.', phase: 'sending', disabled: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toBeDisabled();
  },
};

export const FailedWithInputKept: Story = {
  args: {
    model: {
      ...baseModel,
      text: 'Please keep this note.',
      phase: 'failed',
      message: 'Could not save. Try again.',
      sendable: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Could not save. Try again.');
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toHaveValue(
      'Please keep this note.',
    );
    await expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};

export const RequestChanged: Story = {
  args: {
    model: {
      ...baseModel,
      text: 'The request changed while I was writing.',
      message: 'This request has changed. Review the latest board.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('This request has changed.');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

export const TooLong: Story = {
  args: {
    model: { ...baseModel, text: '𠮷'.repeat(2001), tooLong: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Your answer' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
  },
};

export const ExpandQuestion: Story = {
  args: { model: { ...baseModel, questionExpanded: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reason = canvas.getByText(question);
    await expect(reason).toHaveClass('detail__reason');
    await expect(reason).not.toHaveClass('detail__reason--clamped');
  },
};
