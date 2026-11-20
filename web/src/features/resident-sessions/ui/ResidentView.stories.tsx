import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { FEATURE_STAGES_URL } from '@/shared/ui/preview-feature/feature-stage';
import { logs, scenarios } from './scenarios';
import { ResidentView } from './ResidentView';

// The resident-session dialog in the states of the approved design. The board launches at most ONE
// session (Claude Code or Codex); external sessions are unlimited. The state comes first, the
// choices below it; while a session runs the tool and model stay editable and apply from the next start.
const meta = {
  title: 'Resident/ResidentView',
  component: ResidentView,
  args: { ...scenarios.working, kind: 'dialog', onClose: fn(), log: logs.running },
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
} satisfies Meta<typeof ResidentView>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** Working on a task: the heading is the tool in use; state, model and since-time come first. */
export const Working: Story = {
  play: async () => {
    await expect(await page().findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    // The right pane shows the log of the tool that runs.
    await expect(page().getByText(/Request R-12 received/)).toBeInTheDocument();
    await expect(page().getByText('Working on a task')).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Stop' })).toBeEnabled();
    await expect(page().getByRole('checkbox')).toBeChecked();
    // The dialog is in public preview: the badge beside the title and the notice, linking to the stages page.
    // The dialog fades in, so the badge is hidden for the first frames.
    await waitFor(() =>
      expect(page().getByText('Public preview', { selector: '[data-slot="badge"]' })).toBeVisible(),
    );
    await expect(page().getByRole('link', { name: 'documentation' })).toHaveAttribute(
      'href',
      `${FEATURE_STAGES_URL.en}#resident-sessions`,
    );
    // The notice is one line with a link to the user guide.
    await expect(page().getByRole('link', { name: 'Learn more' })).toHaveAttribute(
      'href',
      expect.stringContaining('/guide/delegate/resident-session'),
    );
  },
};

/** Waiting: running with its wait registered. Codex, one automatic restart behind it. */
export const Waiting: Story = {
  args: scenarios.waiting,
  play: async () => {
    await expect((await page().findAllByText('Waiting')).length).toBeGreaterThan(0);
    await expect(page().getByText(/Restarted automatically 1 time$/)).toBeInTheDocument();
  },
};

/** Restarting: the next automatic try with its countdown, the reason and the restart count. */
export const Restarting: Story = {
  args: scenarios.restarting,
  play: async () => {
    await expect(await page().findByText(/Next try in \d+ s/)).toBeInTheDocument();
    await expect(page().getByText(/SIGKILL/)).toBeInTheDocument();
  },
};

/** Items the board gave up pushing: each is named, with the last failure, and the hint says how to clear them. */
export const StalledItems: Story = {
  args: scenarios.stalled,
  play: async () => {
    await expect(await page().findByText('Some items could not be handled')).toBeInTheDocument();
    await expect(page().getByText('Request Q-3')).toBeInTheDocument();
    await expect(page().getByText('Answer to Q-5')).toBeInTheDocument();
    await expect(page().getByText('Task #12')).toBeInTheDocument();
    await expect(page().getByText('rate limited')).toBeInTheDocument();
  },
};

/** Next start: Codex is chosen while Claude Code runs, so a hint says what the next start uses. */
export const NextStartHint: Story = {
  args: scenarios.nextStart,
  play: async () => {
    await expect(await page().findByText('Next start: Codex · Default model')).toBeInTheDocument();
  },
};

/** Stopped: nothing attached; Codex is chosen and Start is ready. */
export const Stopped: Story = {
  args: scenarios.stopped,
  play: async () => {
    await expect(
      await page().findByText('No session is attached to this board now.'),
    ).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Start' })).toBeEnabled();
  },
};

/** Failed (crash loop): the reason and restart count come first; the button is Restart. */
export const Failed: Story = {
  args: scenarios.failed,
  play: async () => {
    await expect(await page().findByText(/exited 4 times/)).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Restart' })).toBeEnabled();
  },
};

/** The chosen tool's CLI is not installed: the server's reason and the next step; Start is disabled. */
export const CliMissing: Story = {
  args: scenarios.cliMissing,
  play: async () => {
    await expect(await page().findByText('Claude Code CLI not found')).toBeInTheDocument();
    await expect(page().getByText(/not on the PATH/)).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Start' })).toBeDisabled();
  },
};

/** The chosen tool is not logged in (reported by the launch request). */
export const NotLoggedIn: Story = {
  args: scenarios.notLoggedIn,
  play: async () => {
    await expect(await page().findByText('Not logged in to Codex')).toBeInTheDocument();
    await expect(page().getByText('Run codex login in a terminal to log in.')).toBeInTheDocument();
  },
};

/** The model list could not be read: the reason is shown and only the default is on offer. */
export const ModelsUnreadable: Story = {
  args: scenarios.modelsUnreadable,
  play: async () => {
    await expect(await page().findByText(/codex printed no model list/)).toBeInTheDocument();
    await expect(page().getByRole('button', { name: /^Model:/ })).toBeDisabled();
  },
};

/** A launch request in flight: every control is disabled and the button says "Starting…". */
export const Starting: Story = {
  args: scenarios.starting,
  play: async () => {
    await expect(await page().findByRole('button', { name: 'Starting…' })).toBeDisabled();
    await expect(page().getByRole('checkbox')).toBeDisabled();
  },
};

/** The launch request failed (no project folder): the server's reason is shown under the controls. */
export const LaunchError: Story = {
  args: scenarios.launchError,
  play: async () => {
    await expect(
      await page().findByText(/Could not start: The project has no bound folder/),
    ).toBeInTheDocument();
  },
};

/** The external sessions list opened (collapsed by default in the other stories). */
export const ExternalOpen: Story = {
  args: { ...scenarios.working, externalOpen: true },
  play: async () => {
    await expect(await page().findByText(/Connected since/)).toBeInTheDocument();
  },
};

/** The model menu lists Default and the models the API returned. */
export const ModelMenu: Story = {
  play: async () => {
    await userEvent.click(await page().findByRole('button', { name: /^Model:/ }));
    await expect(await page().findByRole('menuitemradio', { name: 'Default model' })).toBeVisible();
    await expect(page().getByRole('menuitemradio', { name: 'Fable' })).toBeVisible();
  },
};

/** The same dialog in Japanese. */
export const Japanese: Story = {
  globals: { locale: 'ja' },
  play: async () => {
    await expect(await page().findByText('タスク作業中')).toBeInTheDocument();
    // The dialog fades in, so the badge is hidden for the first frames.
    await waitFor(() =>
      expect(
        page().getByText('パブリックプレビュー', { selector: '[data-slot="badge"]' }),
      ).toBeVisible(),
    );
    await expect(page().getByRole('link', { name: 'ドキュメント' })).toHaveAttribute(
      'href',
      `${FEATURE_STAGES_URL.ja}#resident-sessions`,
    );
  },
};

/** The dark theme. */
export const Dark: Story = {
  args: scenarios.failed,
  globals: { mode: 'dark' },
};

/** A phone: the dialog is a bottom sheet and the controls stack in one column. */
export const Sheet: Story = {
  args: { ...scenarios.nextStart, kind: 'sheet' },
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    await expect(await page().findByRole('dialog', { name: 'Resident agent' })).toBeVisible();
    // The dialog fades in, so the badge is hidden for the first frames.
    await waitFor(() =>
      expect(page().getByText('Public preview', { selector: '[data-slot="badge"]' })).toBeVisible(),
    );
  },
};

/** Stop while mid-turn: the button asks first, naming what is lost; Stop anyway then stops. */
export const StopAsksWhileWorking: Story = {
  args: { onStop: fn() },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Stop' }));
    await expect(await page().findByText('Stop while it is working?')).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Keep running' })).toHaveFocus();
    await expect(args.onStop).not.toHaveBeenCalled();
    await userEvent.click(page().getByRole('button', { name: 'Stop anyway' }));
    await expect(args.onStop).toHaveBeenCalledTimes(1);
  },
};

/** Keep running closes the question without stopping. */
export const StopCancelled: Story = {
  args: { onStop: fn() },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Stop' }));
    await userEvent.click(await page().findByRole('button', { name: 'Keep running' }));
    await expect(page().queryByText('Stop while it is working?')).toBeNull();
    await expect(args.onStop).not.toHaveBeenCalled();
  },
};

/** An idle (waiting) session stops at once, with no question. */
export const StopWhileWaiting: Story = {
  args: { ...scenarios.waiting, onStop: fn() },
  play: async ({ args }) => {
    await userEvent.click(await page().findByRole('button', { name: 'Stop' }));
    await expect(args.onStop).toHaveBeenCalledTimes(1);
    await expect(page().queryByText('Stop while it is working?')).toBeNull();
  },
};

/** The question on a phone, in Japanese. */
export const StopAsksSheetJapanese: Story = {
  args: { kind: 'sheet', onStop: fn() },
  globals: { locale: 'ja', viewport: { value: 'mobile1' } },
  play: async () => {
    await userEvent.click(await page().findByRole('button', { name: '停止' }));
    await expect(await page().findByText('作業中ですが停止しますか?')).toBeInTheDocument();
    await expect(page().getByRole('button', { name: '停止する' })).toBeVisible();
  },
};

/** The question in the dark theme. */
export const StopAsksDark: Story = {
  globals: { mode: 'dark' },
  play: async () => {
    await userEvent.click(await page().findByRole('button', { name: 'Stop' }));
    await expect(await page().findByText('Stop while it is working?')).toBeInTheDocument();
  },
};

/** The log pane before any session was launched: the empty state, with the settings unchanged. */
export const LogEmpty: Story = {
  args: { ...scenarios.stopped, log: logs.empty },
  play: async () => {
    await expect(
      await page().findByText('The log appears once the agent has started.'),
    ).toBeInTheDocument();
  },
};

/** The log is longer than the tail the board returns: a note says only the end is shown. */
export const LogTruncated: Story = {
  args: { ...scenarios.working, log: logs.truncated },
  play: async () => {
    await expect(await page().findByText('Only the end of the log is shown.')).toBeInTheDocument();
  },
};

/** A failed read keeps the last tail and adds a quiet line. */
export const LogReadFailed: Story = {
  args: { ...scenarios.working, log: logs.failed },
  play: async () => {
    await expect(
      await page().findByText('Could not read the log. Trying again.'),
    ).toBeInTheDocument();
  },
};

/** A phone: the log sits under the settings in the sheet. */
export const SheetWithLog: Story = {
  args: { ...scenarios.working, kind: 'sheet' },
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    await expect(await page().findByText(/Request R-12 received/)).toBeInTheDocument();
  },
};

/** The Japanese dialog with its log pane. */
export const LogJapanese: Story = {
  args: { ...scenarios.stopped, log: logs.empty },
  globals: { locale: 'ja' },
  play: async () => {
    await expect(
      await page().findByText('エージェントを起動すると、ここにログが表示されます。'),
    ).toBeInTheDocument();
  },
};
