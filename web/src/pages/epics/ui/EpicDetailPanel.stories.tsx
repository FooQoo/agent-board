import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { makeEpic, makeProject } from '../../../../.storybook/support/fixtures';
import { detailData } from '../../../../.storybook/support/detailData';
import { EpicDetailPanel, EpicDetailPlaceholder } from './EpicDetailPanel';

const epic = makeEpic({ id: 'EPIC-ALPHA', name: 'Alpha delivery', body: '' });
const meta = {
  title: 'Pages/Epics/EpicDetailPanel',
  component: EpicDetailPanel,
  decorators: [detailData],
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
/** The epic's text is a skeleton until it arrives; the title and actions are shown at once. */
export const DocumentLoading: Story = {
  parameters: { detailFixture: { stallAfter: 1 } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(view.getByRole('heading', { name: 'Alpha delivery' })).toBeInTheDocument();
    expect(view.getByRole('status', { name: 'Loading details…' })).toBeInTheDocument();
  },
};

/** When the epic's text cannot be read, the panel says so and offers to try again. */
export const DocumentFailed: Story = {
  parameters: { detailFixture: { failDetail: true } },
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    expect(await view.findByRole('alert')).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  },
};

/** An epic with no text says so. */
export const DocumentEmpty: Story = {
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getByText('No epic details yet')).toBeInTheDocument(),
    );
  },
};

export const NoSelection: StoryObj<typeof EpicDetailPlaceholder> = {
  render: () => <EpicDetailPlaceholder />,
  play: async ({ canvasElement }) =>
    expect(within(canvasElement).getByLabelText('Epic details')).toBeInTheDocument(),
};
