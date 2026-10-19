import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DialogFrame, type DialogFrameProps } from './DialogFrame';

type DialogFrameStoryProps = Omit<DialogFrameProps, 'children'>;

function DialogFrameStory(args: DialogFrameStoryProps) {
  return (
    <DialogFrame {...args}>
      <input aria-label="Task title" defaultValue="A task" />
    </DialogFrame>
  );
}

const meta = {
  title: 'Shared/DialogFrame',
  component: DialogFrameStory,
  parameters: { layout: 'fullscreen' },
  args: {
    title: 'Create task',
    submitLabel: 'Save',
    onClose: fn(),
    validate: fn<() => string | null>(() => null),
    save: fn(async () => {}),
  },
} satisfies Meta<typeof DialogFrameStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const ValidationError: Story = {
  args: { validate: fn(() => 'A title is required') },
  play: async () => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await expect(view.getByRole('alert')).toHaveTextContent('A title is required');
  },
};

export const SaveFailureRetry: Story = {
  render: (args) => {
    let attempt = 0;
    return (
      <DialogFrame
        {...args}
        save={async () => {
          if (attempt++ === 0) throw new Error('Temporary failure');
        }}
      >
        <input aria-label="Task title" defaultValue="A task" />
      </DialogFrame>
    );
  },
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await expect(await view.findByRole('alert')).toHaveTextContent('Temporary failure');
    await userEvent.click(view.getByRole('button', { name: 'Save' }));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};

export const ConfirmDiscard: Story = {
  args: { dirty: true },
  play: async ({ args }) => {
    const view = within(document.body);
    await userEvent.click(view.getByRole('button', { name: 'Cancel' }));
    await expect(view.getByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    await userEvent.click(view.getByRole('button', { name: 'Discard and close' }));
    await expect(args.onClose).toHaveBeenCalledTimes(1);
  },
};
