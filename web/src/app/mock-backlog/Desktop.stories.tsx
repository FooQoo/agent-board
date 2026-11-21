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

/** The board with Backlog (dashed, "plans") before Todo (filled). Compare with the four-lane order. */
export const BoardWithBacklog: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Backlog' })).toBeVisible();
    await expect(within(canvasElement).getByRole('region', { name: 'Todo' })).toBeVisible();
  },
};

/** A Backlog card's detail: the plan banner, and the tick note on the conditions tab. */
export const BacklogCardDetail: Story = {
  args: { initial: { openId: 42 } },
};

/** Two cards picked in the Backlog group, with the picked-count bar. */
export const PickSome: Story = {
  args: { initial: { selected: [41, 43] } },
};

/** Sending two picked cards: target, before/after counts and the wave warning. */
export const SendSelectedConfirm: Story = {
  args: {
    initial: {
      selected: [43, 44],
      overlay: { kind: 'send', target: { scope: 'cards', epicId: 'LOGIN-1', ids: [43, 44] } },
    },
  },
};

/** Sending the whole epic: the open question needs an explicit confirmation (the button stays off). */
export const SendEpicWithQuestion: Story = {
  args: {
    initial: {
      overlay: {
        kind: 'send',
        target: { scope: 'epic', epicId: 'LOGIN-1', ids: [41, 42, 43, 44] },
      },
    },
  },
};

/** After a send: the cards are in Todo (marked), the counts moved, and "Move back to Backlog" is offered. */
export const AfterSend: Story = {
  args: { initial: { sentIds: [41, 43] } },
};
