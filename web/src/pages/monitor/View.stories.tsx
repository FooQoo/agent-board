import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
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

function MonitorPageStory({ epicReadFails = false }: { epicReadFails?: boolean }) {
  const fixture = useMemo(() => {
    const value = createMonitorFixture();
    const first = value.tasks.get(1);
    if (first) first.summary.title = 'Mobile drawer example';
    return value;
  }, []);
  const props = useMemo(() => createMonitorFixtureProps(fixture), [fixture]);
  return withMonitorFixtureData(fixture, <MonitorView {...props} />, { failEpic: epicReadFails });
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
      writeAnswer={async () => {
        throw new Error('The story takes no answers.');
      }}
      useBuildReload={() => undefined}
      onNotFound={() => undefined}
    />
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
