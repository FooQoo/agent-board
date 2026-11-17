import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { modalDocsParameters } from '../../../.storybook/support/modal-docs';
import { ExchangesScreen } from './ExchangesScreen';

// The remote-access (phone) side of the exchanges mock: the same band, and the panel and the plan
// review as bottom sheets.
const meta = {
  title: 'Mocks/Exchanges/Phone',
  component: ExchangesScreen,
  args: { variant: 'phone' },
  parameters: { storyFrame: 'monitor', layout: 'fullscreen', ...modalDocsParameters },
  globals: { width: 'phone-375' },
} satisfies Meta<typeof ExchangesScreen>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** 7. The band above the lanes, with the plan card at the top of Todo. */
export const BandAndLanes: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Exchanges' })).toBeVisible();
  },
};

/** 7. The exchanges panel as a bottom sheet. */
export const PanelSheet: Story = {
  args: { initial: { kind: 'panel', tab: 'human' } },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Exchanges' })).toBeInTheDocument();
  },
};

/** 7. An opened question in the sheet. */
export const PanelSheetQuestion: Story = {
  args: { initial: { kind: 'panel', tab: 'human', openId: 'Q-12' } },
};

/** 7. The plan review as a sheet, with a question open. */
export const PlanReviewSheetWithOpenQuestion: Story = {
  args: { scenario: 'newEpic', initial: { kind: 'review', planId: 'LOGIN-1' } },
  play: async () => {
    await expect(
      await page().findByRole('button', { name: 'Start with this plan' }),
    ).toBeDisabled();
  },
};

/** 7. The plan review as a sheet, ready to start. */
export const PlanReviewSheetReady: Story = {
  args: { scenario: 'newEpicReady', initial: { kind: 'review', planId: 'LOGIN-1' } },
};

/** 7. Japanese, dark. */
export const BandJaDark: Story = {
  args: { scenario: 'all' },
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
};
