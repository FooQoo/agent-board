import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { HistoryIcon, LayersIcon, ListChecksIcon, FileTextIcon } from 'lucide-react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DetailTabList, type DetailTabOption } from './detail-tabs';

type TabId = 'description' | 'conditions' | 'history' | 'epic';

const TABS: DetailTabOption<TabId>[] = [
  { id: 'description', label: 'Description', icon: <FileTextIcon /> },
  { id: 'conditions', label: 'Conditions', icon: <ListChecksIcon /> },
  { id: 'history', label: 'History', icon: <HistoryIcon />, count: 3 },
  { id: 'epic', label: 'Epic', icon: <LayersIcon /> },
];

/**
 * The tab list keeps its selection in the parent. The Stories use the mobile drawer's class and its
 * stylesheet (the `monitor` frame), which is where the drawer shows these tabs.
 */
function ControlledTabs({
  initial = 'description',
  wrap = true,
  onChange,
}: {
  initial?: TabId;
  wrap?: boolean;
  onChange: (tab: TabId) => void;
}) {
  const [selected, setSelected] = useState<TabId>(initial);
  return (
    <div style={{ width: 360 }}>
      <DetailTabList<TabId>
        idBase="sample-detail"
        tabs={TABS}
        selected={selected}
        wrap={wrap}
        className="monitor-drawer__tablist"
        onChange={(tab) => {
          setSelected(tab);
          onChange(tab);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Shared/UI/DetailTabs',
  component: ControlledTabs,
  args: { onChange: fn() },
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof ControlledTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const tabs = within(canvasElement).getAllByRole('tab');
    await expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Description',
      'Conditions',
      'History 3',
      'Epic',
    ]);
    await expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await expect(tabs[0]).toHaveAttribute('tabindex', '0');
    await expect(tabs[1]).toHaveAttribute('tabindex', '-1');
  },
};

/** A click selects the tab and calls the callback with its ID. */
export const ClickSelects: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('tab', { name: /History/ }));
    await expect(args.onChange).toHaveBeenCalledWith('history');
    await expect(within(canvasElement).getByRole('tab', { name: /History/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

/** Arrow keys move the selection and the focus, and the last arrow wraps to the first tab. */
export const ArrowKeysWrap: Story = {
  play: async ({ args, canvasElement }) => {
    const description = within(canvasElement).getByRole('tab', { name: 'Description' });
    description.focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(within(canvasElement).getByRole('tab', { name: 'Conditions' })).toHaveFocus();
    await expect(args.onChange).toHaveBeenLastCalledWith('conditions');
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    await expect(within(canvasElement).getByRole('tab', { name: 'Epic' })).toHaveFocus();
    await expect(args.onChange).toHaveBeenLastCalledWith('epic');
  },
};

/** Home and End jump to the first and the last tab. */
export const HomeAndEnd: Story = {
  play: async ({ args, canvasElement }) => {
    const description = within(canvasElement).getByRole('tab', { name: 'Description' });
    description.focus();
    await userEvent.keyboard('{End}');
    await expect(args.onChange).toHaveBeenLastCalledWith('epic');
    await userEvent.keyboard('{Home}');
    await expect(args.onChange).toHaveBeenLastCalledWith('description');
    await expect(description).toHaveFocus();
  },
};

/**
 * With wrapping off, the arrow keys stop at the first and the last tab: the focus and the selection
 * stay on the first tab. The callback still reports that tab, as the tab list does for every key press.
 */
export const NoWrapStopsAtEnd: Story = {
  args: { wrap: false },
  play: async ({ args, canvasElement }) => {
    const description = within(canvasElement).getByRole('tab', { name: 'Description' });
    description.focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(description).toHaveFocus();
    await expect(description).toHaveAttribute('aria-selected', 'true');
    await expect(args.onChange).toHaveBeenLastCalledWith('description');
  },
};
