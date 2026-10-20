import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { makeEpic, makeProject } from '../../../../.storybook/support/fixtures';
import { EpicDetailPanel, EpicDetailPlaceholder } from './EpicDetailPanel';

const epic = makeEpic({ id: 'EPIC-ALPHA', name: 'Alpha delivery', body: '' });
const meta = {
  title: 'Pages/Epics/EpicDetailPanel',
  component: EpicDetailPanel,
  args: {
    projectId: makeProject().id,
    epic,
    onEdit: fn(),
    onDelete: fn(async () => {}),
    onClose: fn(),
  },
} satisfies Meta<typeof EpicDetailPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Selected: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Alpha delivery' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Edit epic' }));
    await expect(args.onEdit).toHaveBeenCalledOnce();
    await userEvent.click(canvas.getByRole('button', { name: 'Close details' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
export const WithDocument: Story = {
  args: {
    epic: makeEpic({ id: 'EPIC-PLAN', name: 'Epic with plan', body: '# Plan\n\nA short plan.' }),
  },
};
export const NoSelection: StoryObj<typeof EpicDetailPlaceholder> = {
  render: () => <EpicDetailPlaceholder />,
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByLabelText('Epic details')).toBeInTheDocument(),
};
