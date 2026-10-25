import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from './button';
import { DialogActions } from './dialog-actions';

const meta = {
  title: 'Shared/UI/DialogActions',
  component: DialogActions,
} satisfies Meta<typeof DialogActions>;

export default meta;
type Story = StoryObj<typeof meta>;

const pair = (
  <>
    <Button variant="outline">Cancel</Button>
    <Button variant="destructive">Delete the epic</Button>
  </>
);

/** A dialog's actions: M high, equal columns as wide as the longer label. */
export const Dialog: Story = {
  args: { children: pair },
  play: async ({ canvasElement }) => {
    const [cancel, remove] = within(canvasElement).getAllByRole('button');
    await expect(getComputedStyle(cancel as HTMLElement).height).toBe('38px');
    await expect((cancel as HTMLElement).offsetWidth).toBe((remove as HTMLElement).offsetWidth);
  },
};

/** The confirm inside a panel: S high. */
export const Small: Story = { args: { size: 's', align: 'start', children: pair } };

/** The first button at the left edge, the last at the right edge. */
export const Between: Story = {
  args: { align: 'between', children: pair },
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
};
