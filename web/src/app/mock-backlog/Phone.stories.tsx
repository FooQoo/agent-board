import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { BacklogScreen } from './BacklogScreen';

// The phone side of the Backlog mock: four lane tabs, the card drawer, and the same surfaces as bottom sheets.
const meta = {
  title: 'Mocks/Backlog/Phone',
  component: BacklogScreen,
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor', layout: 'fullscreen', ...modalDocsParameters },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof BacklogScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** AC-1. Backlog is its own tab with its own count, apart from Todo. */
export const BacklogTab: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('tab')).toHaveLength(4);
  },
};

/** AC-1. The Todo tab for comparison: filled lane, no plan marks. */
export const TodoTab: Story = { args: { initial: { lane: 'todo' } } };

/** AC-1. The whole epic plan as a sheet: goal, wave order, conditions. */
export const EpicPlanSheet: Story = {
  args: { initial: { overlay: { kind: 'plan', epicId: 'LOGIN-1' } } },
  play: async () => {
    await expect(
      await page().findByRole('dialog', { name: 'Plan of LOGIN-1' }),
    ).toBeInTheDocument();
  },
};

/** AC-1 and AC-2. The card drawer of a Backlog card, with Edit and Send to Todo. */
export const CardDrawer: Story = {
  args: { initial: { openId: 42 } },
};

/** AC-2. The editor as a sheet. */
export const EditSheet: Story = {
  args: { initial: { openId: 43, overlay: { kind: 'edit', id: 43 } } },
};

/** AC-3. Two cards picked in the Backlog tab. */
export const PickSome: Story = {
  args: { initial: { selected: [41, 43] } },
};

/** AC-3. Sending picked cards as a sheet, with the wave warning. */
export const SendSelectedSheet: Story = {
  args: {
    initial: {
      selected: [43, 44],
      overlay: { kind: 'send', target: { scope: 'cards', epicId: 'LOGIN-1', ids: [43, 44] } },
    },
  },
};

/** AC-3. Sending the whole epic: the open-question confirmation. */
export const SendEpicSheet: Story = {
  args: {
    initial: {
      overlay: {
        kind: 'send',
        target: { scope: 'epic', epicId: 'LOGIN-1', ids: [41, 42, 43, 44] },
      },
    },
  },
};

/** AC-3. After a send: the Todo tab shows the sent cards, with the result notice. */
export const AfterSend: Story = {
  args: { initial: { sentIds: [41, 43], lane: 'todo' } },
};
