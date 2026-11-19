import type { Meta, StoryObj } from '@storybook/react-vite';
import { type ReactNode, useMemo, useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SAMPLE_PROJECT, sampleMessagesApi } from '../../features/tasks/messages/messageSamples';
import type { Message } from '../../shared/data/api/contracts';
import { health } from '../../features/resident-sessions/fixtures';
import { ResidentIndicator } from '../../features/resident-sessions/ui/ResidentFooter';
import { unconnectedMonitorReadResolvers } from './contracts';
import { withMonitorFixtureData } from './fixture-provider';
import { MonitorProject } from './MonitorProject';
import { createMonitorFixture, createMonitorFixtureProps } from './mock';
import { createMonitorFixtureAdapter } from './mock-adapter';
import { MonitorView } from './View';

const meta = {
  title: 'Pages/Monitor',
  component: MonitorPageStory,
  parameters: { storyFrame: 'monitor' },
} satisfies Meta<typeof MonitorPageStory>;

type Story = StoryObj<typeof meta>;

function MonitorPageStory({
  epicReadFails = false,
  statusSlot,
}: {
  epicReadFails?: boolean;
  statusSlot?: ReactNode;
}) {
  const fixture = useMemo(() => {
    const value = createMonitorFixture();
    const first = value.tasks.get(1);
    if (first) first.summary.title = 'Mobile drawer example';
    return value;
  }, []);
  const props = useMemo(() => createMonitorFixtureProps(fixture), [fixture]);
  return withMonitorFixtureData(fixture, <MonitorView {...props} statusSlot={statusSlot} />, {
    failEpic: epicReadFails,
  });
}

/** The screen as the app builds it: the data layer reads the Summary, the list is drawn from it. */
function ConnectedProjectStory() {
  const [{ fixture, adapter }] = useState(() => {
    const value = createMonitorFixture();
    return { fixture: value, adapter: createMonitorFixtureAdapter(value) };
  });
  return (
    <MonitorProject
      projectId={fixture.projectId}
      adapter={adapter}
      readResolvers={unconnectedMonitorReadResolvers}
      messagesApi={{
        read: async () => {
          throw new Error('The story has no messages.');
        },
        answer: async () => {
          throw new Error('The story takes no answers.');
        },
        withdraw: async () => {
          throw new Error('The story withdraws nothing.');
        },
      }}
      useBuildReload={() => undefined}
      onNotFound={() => undefined}
    />
  );
}

/** The phone screen with a question, wired as the app wires them. */
function WiredPhoneStory({ onAsk }: { onAsk: () => void }) {
  const fixture = useMemo(() => createMonitorFixture(), []);
  const props = useMemo(() => createMonitorFixtureProps(fixture), [fixture]);
  const messages: Message[] = [
    {
      id: 'Q-13',
      type: 'question',
      from: 'ai',
      to: 'human',
      turn: 'human',
      title: 'Keep password sign-in?',
      createdAt: '2026-11-17T08:20:00.000Z',
      tasks: [26],
      epicId: 'SEARCH-2',
    },
  ];
  return withMonitorFixtureData(
    fixture,
    <MonitorView
      {...props}
      projectId={SAMPLE_PROJECT}
      messages={messages}
      messagesApi={sampleMessagesApi('en')}
      onAsk={onAsk}
    />,
  );
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
    await expect(await dialog.findByText('Created task in Todo.')).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('tab', { name: 'Epic' }));
    await expect(await dialog.findByText('Epic body text')).toBeInTheDocument();
  },
};

/**
 * The status line at the bottom shows the resident session after the connection state: the tool, a
 * short state word and a dot, display-only. At phone widths it takes the room of the fetch time.
 */
export const ResidentStatusLine: Story = {
  args: {
    statusSlot: (
      <ResidentIndicator health={health({ state: 'running', tool: 'claude-code' })} withState />
    ),
  },
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const line = canvasElement.querySelector('.monitor-freshness');
    await expect(line).not.toBeNull();
    const indicator = within(line as HTMLElement).getByRole('img', {
      name: 'Claude Code: Working on a task',
    });
    await expect(indicator).toHaveTextContent('Claude Code');
    await expect(indicator).toHaveTextContent('working');
    await expect(
      within(line as HTMLElement).queryByRole('button', { name: /Claude Code/ }),
    ).toBeNull();
  },
};

/** Nothing launched and auto-start off: the status line shows only the connection state. */
export const NoResidentStatus: Story = {
  args: { statusSlot: <ResidentIndicator health={health({})} withState /> },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.resident-footer')).toBeNull();
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
    await expect(await dialog.findByText('Could not load the details')).toBeInTheDocument();
    await expect(dialog.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
};

/** The whole screen reads its Summary from the data layer; the manual refresh button asks again. */
export const ConnectedProject: StoryObj<typeof ConnectedProjectStory> = {
  render: () => <ConnectedProjectStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Todo work item 1' })).toBeVisible();
    const refresh = canvas.getByRole('button', { name: 'Refresh' });
    await expect(refresh).toBeEnabled();
    await userEvent.click(refresh);
    await expect(await canvas.findByRole('button', { name: 'Todo work item 1' })).toBeVisible();
  },
};

const body = () => within(document.body);

/** The phone band's Ask AI button reaches the screen's callback. */
export const BandAskAi: StoryObj<typeof WiredPhoneStory> = {
  args: { onAsk: fn() },
  globals: { locale: 'en' },
  render: (args) => <WiredPhoneStory {...args} />,
  play: async ({ canvasElement, args }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Ask AI' }));
    await expect(args.onAsk).toHaveBeenCalledOnce();
  },
};

/** The connected screen opens the Ask AI sheet from the band. */
export const ConnectedAskAiSheet: StoryObj<typeof ConnectedProjectStory> = {
  render: () => <ConnectedProjectStory />,
  globals: { locale: 'en' },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Ask AI' }));
    await expect(await body().findByRole('dialog', { name: 'Ask AI' })).toBeInTheDocument();
  },
};
