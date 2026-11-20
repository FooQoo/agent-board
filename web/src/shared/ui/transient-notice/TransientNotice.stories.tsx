import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { TransientNotice } from './TransientNotice';

const meta = {
  title: 'Shared/UI/TransientNotice',
  component: TransientNotice,
  args: {
    message: 'Another change moved this task to Doing. It stays there.',
    onDismiss: () => {},
  },
} satisfies Meta<typeof TransientNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The notice is rendered at the body, so it is outside the Story's canvas. It reads as a status. */
export const Default: Story = {
  play: async () => {
    const notice = within(document.body).getByRole('status');
    await expect(notice).toHaveTextContent('Another change moved this task to Doing');
  },
};

/** Without a message nothing is drawn. */
export const Hidden: Story = {
  args: { message: null },
  play: async () => {
    await expect(within(document.body).queryByRole('status')).toBeNull();
  },
};
