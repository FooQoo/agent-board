import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DetailError, DetailPartialNotice, DetailSkeleton } from './DetailState';

const meta = {
  title: 'Shared/UI/DetailState',
  component: DetailSkeleton,
} satisfies Meta<typeof DetailSkeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

const frame = (
  <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <h2 style={{ margin: 0, fontSize: 16 }}>Sample task</h2>
    <nav aria-label="Sections" style={{ display: 'flex', gap: 12, fontSize: 13 }}>
      <span>Document</span>
      <span>History</span>
    </nav>
  </header>
);

/** Loading: the title and tabs are there at once, and the body is a busy placeholder. */
export const Loading: Story = {
  args: { frame },
  render: (args) => (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <DetailSkeleton {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('heading', { name: 'Sample task' })).toBeInTheDocument();
    expect(canvas.getByRole('status', { name: 'Loading details…' })).toBeInTheDocument();
    expect(canvasElement.querySelectorAll('.detail-state__line').length).toBe(6);
  },
};

/** Loading in Japanese and the dark theme, on a phone. */
export const LoadingJaDarkPhone: Story = {
  ...Loading,
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('status', { name: '詳細を読み込んでいます…' }),
    ).toBeInTheDocument();
  },
};

/** Partial: the first blocks are shown and the rest is still arriving. */
export const Partial: Story = {
  render: () => (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <DetailPartialNotice />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      'Still receiving this document',
    );
  },
};

/** Partial in Japanese and the dark theme. */
export const PartialJaDark: Story = {
  ...Partial,
  globals: { locale: 'ja', mode: 'dark' },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('status')).toHaveTextContent('本文を受信中です');
  },
};

/** Failed: one line of the reason and a Retry button that calls back. */
export const Failed: Story = {
  args: { frame },
  render: () => <FailedSample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('alert')).toHaveTextContent('Could not load the details');
    expect(canvas.getByRole('alert')).toHaveTextContent('The connection was lost.');
    await userEvent.click(canvas.getByRole('button', { name: 'Retry' }));
    expect(canvas.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};

/** Failed in Japanese and the dark theme, on a phone. */
export const FailedJaDarkPhone: Story = {
  ...Failed,
  globals: { locale: 'ja', mode: 'dark', width: 'phone-375' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByRole('alert')).toHaveTextContent('詳細を読み込めませんでした');
    expect(canvas.getByRole('button', { name: '再試行' })).toBeEnabled();
  },
};

/** A retry that is running disables the button. */
export const Retrying: Story = {
  render: () => (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <DetailError message="The connection was lost." onRetry={fn()} retrying />
    </div>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('button', { name: 'Retry' })).toBeDisabled();
  },
};

function FailedSample() {
  return (
    <div style={{ padding: 16, maxWidth: 560 }}>
      <DetailError message="The connection was lost." onRetry={fn()} />
    </div>
  );
}
