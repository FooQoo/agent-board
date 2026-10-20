import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { makeTask } from '../../../../.storybook/support/fixtures';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { EditDialog } from './EditDialog';

const meta = {
  title: 'Task/Editor/EditDialog',
  component: EditDialog,
  parameters: modalDocsParameters,
  args: {
    task: makeTask({
      id: 12,
      isDraft: true,
      title: 'Edit this task',
      description: '## Task details\n\nBody content.',
      acceptance: [{ id: 'AC-1', text: 'Keep the condition panel', done: false }],
    }),
    onClose: fn(),
    onSubmit: fn(async () => {}),
    renderEpicChip: (epic) => <span>{epic.name}</span>,
  },
} satisfies Meta<typeof EditDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async () => {
    const view = within(document.body);
    const outline = view.getByRole('navigation', { name: 'Outline' });
    await expect(within(outline).getByRole('button', { name: /Task details/ })).toBeInTheDocument();
    await expect(within(outline).queryByRole('link')).toBeNull();
    await expect(view.getByText('Acceptance conditions')).toBeInTheDocument();
  },
};
