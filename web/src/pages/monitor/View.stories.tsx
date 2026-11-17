import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { PlanReviewContainer } from '../../features/tasks/plans/PlanReviewContainer';
import { addedPlan, SAMPLE_PROJECT } from '../../features/tasks/plans/planSamples';
import { sampleMessagesApi } from '../../features/tasks/messages/messageSamples';
import type { Message } from '../../shared/data/api/contracts';
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

/** The phone screen with an approval and the question that blocks it, wired as the app wires them. */
function WiredPhoneStory({ onAsk }: { onAsk: () => void }) {
  const fixture = useMemo(() => createMonitorFixture(), []);
  const props = useMemo(() => createMonitorFixtureProps(fixture), [fixture]);
  const plan = { ...addedPlan('en'), questions: [{ id: 'Q-13', title: 'Keep password sign-in?' }] };
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
    {
      id: plan.id,
      type: 'approval',
      from: 'ai',
      to: 'human',
      turn: 'human',
      title: 'Approve the search filters',
      createdAt: '2026-11-17T08:45:00.000Z',
      tasks: [26, 27],
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
      plans={[plan]}
      renderPlanReview={({ approvalId, onClose, onOpenQuestion }) => (
        <PlanReviewContainer
          projectId={SAMPLE_PROJECT}
          plans={[plan]}
          approval={approvalId}
          kind="sheet"
          start={async () => {}}
          onClose={onClose}
          onOpenQuestion={onOpenQuestion}
        />
      )}
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

/** An approval row of the messages list closes the list and opens the plan review as a sheet. */
export const ApprovalOpensPlanReview: StoryObj<typeof WiredPhoneStory> = {
  args: { onAsk: fn() },
  globals: { locale: 'en' },
  render: (args) => <WiredPhoneStory {...args} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Open the list' }),
    );
    const list = within(await body().findByRole('dialog'));
    await userEvent.click(await list.findByText('Approve the search filters'));
    await expect(await body().findByText('Review the plan')).toBeInTheDocument();
  },
};

/** A question button of the review closes it and opens that question in the messages list. */
export const ReviewQuestionOpensQuestion: StoryObj<typeof WiredPhoneStory> = {
  args: { onAsk: fn() },
  globals: { locale: 'en' },
  render: (args) => <WiredPhoneStory {...args} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: 'Review and start' }),
    );
    await userEvent.click(await body().findByRole('button', { name: 'Answer the question' }));
    await waitFor(() => expect(body().queryByText('Review the plan')).not.toBeInTheDocument());
    await expect(await body().findByRole('button', { name: 'Send answer' })).toBeInTheDocument();
  },
};

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
