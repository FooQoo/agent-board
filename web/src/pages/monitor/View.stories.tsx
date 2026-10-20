import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import type { Epic } from '../../shared/api/contracts';
import type { MonitorViewProps } from './contracts';
import { MonitorView } from './View';
import { createMonitorFixtureProps } from './mock';

const meta = {
  title: 'Pages/Monitor',
  component: MonitorPageStory,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof MonitorPageStory>;

type Story = StoryObj<typeof meta>;

const epic: Epic = {
  id: 'MOB-1',
  name: 'Mobile work',
  color: '#4466aa',
  isDraft: false,
  document: '---\nname: Mobile work\n---\nEpic body text',
  body: 'Epic body text',
  priority: [],
  priorityError: false,
  attachments: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};

function MonitorPageStory({ epicReadFails = false }: { epicReadFails?: boolean }) {
  const props = createMonitorFixtureProps();
  const item = props.todo[0];
  if (item) {
    item.task = {
      ...item.task,
      title: 'Mobile drawer example',
      body: 'Task description for the mobile monitor.',
      epic: { id: epic.id, name: epic.name, color: epic.color },
    };
  }
  const readResolvers: NonNullable<MonitorViewProps['readResolvers']> = {
    attachmentUrl: (projectId, taskId, id) => `/monitor/${projectId}/tasks/${taskId}/${id}`,
    epicAttachmentUrl: (projectId, epicId, id) => `/monitor/${projectId}/epics/${epicId}/${id}`,
    getEpics: async () => {
      if (epicReadFails) throw new Error('offline');
      return [epic];
    },
  };
  return <MonitorView {...props} readResolvers={readResolvers} />;
}

export default meta;

/** The monitor opens the mobile drawer with body, acceptance, history, and epic tabs. */
export const DrawerTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Mobile drawer example' }));
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

/** A read failure offers a retry action inside the epic tab. */
export const EpicReadFailure: Story = {
  args: { epicReadFails: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Mobile drawer example' }));
    const dialog = within(await within(document.body).findByRole('dialog'));
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Could not load this epic.')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeEnabled();
  },
};
