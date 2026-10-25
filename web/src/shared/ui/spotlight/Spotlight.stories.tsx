import type { Meta, StoryObj } from '@storybook/react-vite';
import { Spotlight } from './Spotlight';

const meta = {
  title: 'Shared/UI/Spotlight',
  component: Spotlight,
  parameters: { layout: 'fullscreen' },
  args: { target: { x: 120, y: 120, width: 360, height: 200 } },
  render: (args) => (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--r-bg)' }}>
      <Spotlight {...args}>
        <div style={{ padding: 16, color: 'var(--r-text)', fontSize: 14 }}>
          Region inside the frame
        </div>
      </Spotlight>
    </div>
  ),
} satisfies Meta<typeof Spotlight>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The region is framed with the accent ring, and the stage outside it is dimmed. */
export const Default: Story = {};
