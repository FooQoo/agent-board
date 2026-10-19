import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { Epic } from '../../../shared/api/contracts';
import type { MonitorDetailTab, MonitorReadResolvers } from '../contracts';
import type { EpicReadState } from '../hooks/useMonitorDetailDrawer';
import { createMonitorFixtureProps } from '../mock';
import { MonitorDetailDrawer } from './MonitorDetailDrawer';

const meta = {
  title: 'Pages/Monitor/Components/MonitorDetailDrawer',
  component: DrawerStory,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof DrawerStory>;

type Story = StoryObj<typeof meta>;

const epic: Epic = {
  id: 'MOB-1',
  name: 'Mobile work',
  color: '#4466aa',
  isDraft: false,
  plan: '---\nname: Mobile work\n---\nEpic body text',
  body: 'Epic body text',
  priority: [],
  priorityError: false,
  attachments: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};

const resolvers: MonitorReadResolvers = {
  attachmentUrl: (_projectId, _taskId, id) => `/task/${id}`,
  evidenceUrl: (_projectId, _taskId, id) => `/evidence/${id}`,
  epicAttachmentUrl: (_projectId, _epicId, id) => `/epic/${id}`,
  getEpics: async () => [epic],
};

function DrawerStory({ epicState = 'loaded' }: { epicState?: 'loaded' | 'error' }) {
  const item = createMonitorFixtureProps().todo[0];
  const [tab, setTab] = useState<MonitorDetailTab>('description');
  if (!item) return null;
  item.task = {
    ...item.task,
    title: 'Mobile drawer example',
    body: 'Task description for the mobile monitor.',
    epic: { id: epic.id, name: epic.name, color: epic.color },
  };
  const epicRead: EpicReadState =
    epicState === 'loaded'
      ? { status: 'loaded', epic }
      : { status: 'error', cause: new Error('offline') };
  return (
    <MonitorDetailDrawer
      item={item}
      open
      tab={tab}
      epicRead={epicRead}
      onOpenChange={fn()}
      onTabChange={setTab}
      onRetryEpic={fn()}
      resolvers={resolvers}
    />
  );
}

export default meta;

/** The drawer keeps all four linked panels mounted and presents loaded epic content. */
export const FourTabs: Story = {
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    const tabs = dialog.getAllByRole('tab');
    await expect(tabs).toHaveLength(4);
    await expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(dialog.getByRole('tab', { name: /History/ }));
    await expect(dialog.getByText('Created task in Todo.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Epic body text')).toBeInTheDocument();
  },
};

/** Epic read errors remain visible and expose the retry callback. */
export const EpicError: Story = {
  args: { epicState: 'error' },
  play: async () => {
    const dialog = within(await within(document.body).findByRole('dialog'));
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(dialog.getByText('Could not load this epic.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Try again' }));
  },
};
