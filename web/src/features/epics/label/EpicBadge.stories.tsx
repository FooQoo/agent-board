import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { epicInk } from '../model/epic';
import { EpicBadge } from './EpicBadge';

const epic = { id: 'e1a2b3c4d5e6f708192a3b4c5d6e7f80', name: 'Sample epic', color: '#3b82f6' };

const meta = {
  title: 'Epic/Label/EpicBadge',
  component: EpicBadge,
  args: {
    epic,
    className: 'card__epic',
  },
} satisfies Meta<typeof EpicBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The non-interactive badge shows the epic icon and ID and exposes its name as a tooltip. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const id = canvas.getByText(epic.id);
    const badge = id.closest('[data-epic-label]');
    await expect(id).toBeVisible();
    await expect(badge).toHaveAttribute('title', epic.name);
    await expect(badge).toHaveStyle({ backgroundColor: epic.color, color: epicInk(epic.color) });
    await expect(canvasElement.querySelector('svg')).toBeInTheDocument();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

/** The epic list uses the same badge without the layers icon. */
export const IconHidden: Story = {
  args: { icon: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(epic.id)).toBeVisible();
    await expect(canvasElement.querySelector('svg')).toBeNull();
  },
};

/** Long epic names remain available from the badge tooltip without changing the visible ID. */
export const LongNameTooltip: Story = {
  args: { epic: { ...epic, name: 'A longer epic name available from the badge tooltip' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const id = canvas.getByText(epic.id);
    await expect(id).toBeVisible();
    await expect(id.closest('[data-epic-label]')).toHaveAttribute('title', args.epic.name);
  },
};
