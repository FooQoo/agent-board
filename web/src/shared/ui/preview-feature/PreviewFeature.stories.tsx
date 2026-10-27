import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { PreviewBadge } from './PreviewBadge';
import { PreviewNotice } from './PreviewNotice';
import { FEATURE_STAGES_URL, PREVIEW_FEATURES, type PreviewFeature } from './feature-stage';

const FEATURES = Object.keys(PREVIEW_FEATURES) as PreviewFeature[];

const meta = {
  title: 'Shared/UI/PreviewFeature',
  component: PreviewNotice,
  args: { feature: 'docs' },
  argTypes: { feature: { control: 'select', options: FEATURES } },
} satisfies Meta<typeof PreviewNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The badge is the shared outline Badge with the "Public preview" label. */
export const Badge: Story = {
  render: (args) => <PreviewBadge feature={args.feature} />,
  play: async ({ canvasElement }) => {
    const badge = within(canvasElement).getByText('Public preview');
    await expect(badge).toHaveAttribute('data-slot', 'badge');
    await expect(badge).toHaveAttribute('data-variant', 'outline');
  },
};

/** The sentence, with the word "documentation" linking to the feature's section in a new tab. */
export const Notice: Story = {
  args: { feature: 'mobileMonitor' },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'documentation' });
    await expect(link).toHaveAttribute('href', `${FEATURE_STAGES_URL.en}#mobile-monitor`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  },
};

/** The Japanese sentence links to the Japanese page. */
export const NoticeJapanese: Story = {
  args: { feature: 'docs' },
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', { name: 'ドキュメント' });
    await expect(link).toHaveAttribute('href', `${FEATURE_STAGES_URL.ja}#docs`);
  },
};

/** The badge and the notice of every listed feature, one under another. */
export const EveryFeature: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
      {FEATURES.map((feature) => (
        <div key={feature} style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
          <PreviewBadge feature={feature} />
          <PreviewNotice feature={feature} />
        </div>
      ))}
    </div>
  ),
};
