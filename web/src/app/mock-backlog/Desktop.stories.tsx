import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { BacklogScreen } from './BacklogScreen';

// A visual mock of the planned Backlog lane (SPEC 19_BACKLOG). Static data held in memory, no product behavior.
const meta = {
  title: 'Mocks/Backlog/Desktop',
  component: BacklogScreen,
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
} satisfies Meta<typeof BacklogScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A plain fourth lane before Todo. The Backlog header has the selection button (like Done's archive button). */
export const BoardWithBacklog: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Backlog' })).toBeVisible();
  },
};

/** Selection mode: a radio-style selector at the left of each card; two cards are selected. */
export const SelectionMode: Story = {
  args: { initial: { selected: [41, 43] } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getAllByRole('checkbox', { name: /^Select #/ }),
    ).toHaveLength(5);
  },
};

/** Drag in progress: the selected cards move as one stack with a count badge; Todo shows the drop target. */
export const DragInProgress: Story = {
  args: { initial: { selected: [41, 43, 44], dragPreview: true } },
};

/** After the drop: the moved cards are in Todo (marked), counts moved, and the toast offers the way back. */
export const AfterDrop: Story = {
  args: { initial: { sentIds: [41, 43, 44] } },
};

/** A card with an open question was selected: the confirm names it and needs a tick before sending. */
export const ConfirmWithQuestion: Story = {
  args: { initial: { selected: [42, 43], confirm: [42, 43] } },
};
