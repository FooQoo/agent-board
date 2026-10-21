import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import type { Project, ProjectId } from '../../api/contracts';
import { makeProject } from '../../../../.storybook/support/fixtures';
import { Button } from '../button';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { Header, type HeaderSettings, type ViewMode } from './Header';

const PROJECTS: Project[] = [
  makeProject({ id: 'p-alpha' as ProjectId, name: 'alpha' }),
  makeProject({ id: 'p-beta' as ProjectId, name: 'beta' }),
];

/**
 * The settings slot the page fills. A Story cannot import the product's settings dialog, because the
 * layer rules keep shared code from importing features. This stand-in uses the same render contract:
 * it opens and closes with the header and gives the focus back to the settings button.
 */
const settingsStandIn: HeaderSettings = {
  render: ({ open, onOpenChange, restoreFocusRef }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocusRef.current?.focus();
        }}
      >
        <DialogTitle>Settings sample</DialogTitle>
      </DialogContent>
    </Dialog>
  ),
};

interface HeaderDemoProps {
  projects: Project[] | null;
  activeProjectId: ProjectId | null;
  switchDisabled?: boolean;
  canAdd?: boolean;
  viewMode?: ViewMode;
  onAdd?: () => void;
  onArchive?: () => void;
  onEpics?: () => void;
  onBack?: () => void;
}

/**
 * The header with the page's slots filled in. The project control is a plain button here: the real
 * switcher is covered by its own Stories under features/projects, which the header only hosts.
 */
function HeaderDemo({
  projects,
  activeProjectId,
  switchDisabled = false,
  ...props
}: HeaderDemoProps) {
  const active = projects?.find((project) => project.id === activeProjectId);
  return (
    <Header
      {...props}
      projects={projects}
      activeProjectId={activeProjectId}
      switchDisabled={switchDisabled}
      projectSwitcher={
        active ? (
          <Button variant="ghost" size="s" disabled={switchDisabled}>
            {active.name}
          </Button>
        ) : null
      }
      settings={settingsStandIn}
    />
  );
}

const meta = {
  title: 'Shared/UI/Header',
  component: HeaderDemo,
  args: {
    projects: PROJECTS,
    activeProjectId: 'p-alpha' as ProjectId,
    canAdd: true,
    viewMode: 'board',
    onAdd: fn(),
    onArchive: fn(),
    onEpics: fn(),
    onBack: fn(),
  },
} satisfies Meta<typeof HeaderDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The board header: the app name, the project control, the add, epics and archive buttons, and settings. */
export const Board: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Agent Board' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'alpha' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /add task/i })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /epics/i })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: /archive/i })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Settings' })).toBeEnabled();
  },
};

/** Before the board has loaded, add, epics and archive are not offered; settings stays. */
export const BoardNotReady: Story = {
  args: { canAdd: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /add task/i })).toBeNull();
    await expect(canvas.queryByRole('button', { name: /archive/i })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  },
};

/** While a card form or confirmation is open, the project control and the header buttons are disabled. */
export const SwitchDisabled: Story = {
  args: { switchDisabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'alpha' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /add task/i })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /epics/i })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /archive/i })).toBeDisabled();
  },
};

/** The archive screen replaces the board buttons with a back button; the project control stays. */
export const ArchiveView: Story = {
  args: { viewMode: 'archive' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /add task/i })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Back to board' }));
    await expect(args.onBack).toHaveBeenCalledTimes(1);
  },
};

/** The epics screen shows the project name as text instead of the project control, and its back button. */
export const EpicsView: Story = {
  args: { viewMode: 'epics' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'alpha' })).toBeNull();
    await expect(canvas.getByText('alpha')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Back to board' })).toBeEnabled();
  },
};

/** Without a project list the project control and the slash are hidden, and only the app name is shown. */
export const NoProjectList: Story = {
  args: { projects: null, activeProjectId: null, canAdd: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Agent Board' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'alpha' })).toBeNull();
  },
};

/** The board header in Japanese: the labels come from the product's own `ja` resources. */
export const JapaneseBoard: Story = {
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /タスク追加/ })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: '設定' })).toBeEnabled();
  },
};

/** Each header action calls its own callback once. */
export const ActionCallbacks: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /add task/i }));
    await expect(args.onAdd).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: /epics/i }));
    await expect(args.onEpics).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: /archive/i }));
    await expect(args.onArchive).toHaveBeenCalledTimes(1);
  },
};

/** The settings button opens the settings slot, and Escape gives the focus back to the button. */
export const SettingsOpensAndRestoresFocus: Story = {
  play: async ({ canvasElement }) => {
    const settings = within(canvasElement).getByRole('button', { name: 'Settings' });
    await userEvent.click(settings);
    await expect(await within(document.body).findByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(settings).toHaveFocus());
  },
};
