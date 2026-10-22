import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { ArchiveIcon, LayersIcon, PlusIcon } from 'lucide-react';
import { Button } from './button';
import { IconLabel } from './icon-label';

const meta = {
  title: 'Shared/UI/IconLabel',
  component: IconLabel,
  args: { icon: LayersIcon, children: 'Epics' },
} satisfies Meta<typeof IconLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Button variant="outline">
      <IconLabel {...args} />
    </Button>
  ),
};

/** The three header buttons: the icon box and the gap to the text are the same in each. */
export const HeaderButtons: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 12 }}>
      <Button>
        <IconLabel icon={PlusIcon} optical={1.5}>
          Add task
        </IconLabel>
      </Button>
      <Button variant="outline">
        <IconLabel icon={LayersIcon}>Epics</IconLabel>
      </Button>
      <Button variant="outline">
        <IconLabel icon={ArchiveIcon}>Archive</IconLabel>
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement);
    for (const name of ['Add task', 'Epics', 'Archive']) {
      const label = view.getByText(name).closest('.icon-label') as HTMLElement;
      const icon = label.querySelector('svg') as SVGElement;
      await expect(icon.getBoundingClientRect().width).toBe(16);
      await expect(getComputedStyle(label).columnGap).toBe('8px');
    }
  },
};
