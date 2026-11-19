import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { modalDocsParameters } from '../../../../.storybook/support/modal-docs';
import { scenarios } from './scenarios';
import { ResidentView } from './ResidentView';

// The resident-session dialog in the states of the approved design. The board launches at most ONE
// session (Claude Code or Codex); external sessions are unlimited. The state comes first, the
// choices below it; while a session runs the tool and model stay editable and apply from the next start.
const meta = {
  title: 'Resident/ResidentView',
  component: ResidentView,
  args: { ...scenarios.working, kind: 'dialog', onClose: fn() },
  parameters: { layout: 'fullscreen', ...modalDocsParameters },
} satisfies Meta<typeof ResidentView>;
export default meta;
type Story = StoryObj<typeof meta>;

const page = () => within(document.body);

/** Working on a task: the heading is the tool in use; state, model and since-time come first. */
export const Working: Story = {
  play: async () => {
    await expect(await page().findByRole('heading', { name: 'Claude Code' })).toBeInTheDocument();
    await expect(page().getByText('Working on a task')).toBeInTheDocument();
    await expect(page().getByRole('button', { name: 'Stop' })).toBeEnabled();
    await expect(page().getByRole('checkbox')).toBeChecked();
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
    await expect(await page().findByRole('dialog', { name: 'Resident session' })).toBeVisible();
  },
};
