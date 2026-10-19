import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { EpicLabel } from './EpicLabel';

const epic = { id: 'e1a2b3c4d5e6f708192a3b4c5d6e7f80', name: 'Sample epic', color: '#3b82f6' };

const meta = {
  title: 'Epic/Label/EpicLabel',
  component: EpicLabel,
  args: {
    epic,
    className: 'card__epic',
    onClick: fn(),
  },
} satisfies Meta<typeof EpicLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = { args: { disabled: true } };

/** The label shows the epic ID; its name is the tooltip. A click opens the epic. */
export const ClickOpensEpic: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: epic.id }));
    expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
