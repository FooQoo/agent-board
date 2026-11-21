import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { BacklogScreen } from './BacklogScreen';

// The phone side of the Backlog mock: four lane tabs, selection at the bottom of the Backlog lane, and three
// alternative ways to confirm the move to Todo (A bar, B destination sheet, C drag onto the Todo tab).
const meta = {
  title: 'Mocks/Backlog/Phone',
  component: BacklogScreen,
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor', layout: 'fullscreen', ...modalDocsParameters },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof BacklogScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The Backlog tab: a plain lane with the select button at the bottom of the lane. */
export const BacklogTab: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('tab')).toHaveLength(4);
  },
};

/** Selection mode with the selectors at the left of the cards (alternative A: a bottom action bar). */
export const AltABottomBar: Story = {
  args: { phoneConfirm: 'bar', initial: { selected: [41, 43] } },
};

/** Alternative B: the bar opens a sheet that asks for the destination lane. */
export const AltBDestinationSheet: Story = {
  args: { phoneConfirm: 'sheet', initial: { selected: [41, 43], sheet: true } },
};

/** Alternative C: hold the selection chip and drag it onto the Todo tab. Shown mid-drag. */
export const AltCDragToTodoTab: Story = {
  args: { phoneConfirm: 'tab', initial: { selected: [41, 43], dragPreview: true } },
};

/** The confirm step when a selected card has an open question (same for all three alternatives). */
export const ConfirmWithQuestion: Story = {
  args: { initial: { selected: [42, 43], confirm: [42, 43] } },
};

/** After a send: the Todo tab shows the moved cards, with the toast and the way back. */
export const AfterSend: Story = {
  args: { initial: { sentIds: [41, 43], lane: 'todo' } },
};
