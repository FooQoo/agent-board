import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { Project, ProjectId } from '../../../shared/api/contracts';
import { makeProject } from '../../../../.storybook/support/fixtures';
import { ProjectSwitcher } from './ProjectSwitcher';

const PROJECTS: Project[] = [
  makeProject({ id: 'p-alpha' as ProjectId, name: 'alpha' }),
  makeProject({ id: 'p-beta' as ProjectId, name: 'beta' }),
];

const meta = {
  title: 'Project/Switcher/ProjectSwitcher',
  component: ProjectSwitcher,
  args: {
    projects: PROJECTS,
    activeProjectId: 'p-alpha' as ProjectId,
    onSelect: fn(),
  },
} satisfies Meta<typeof ProjectSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The header shows the active project's name; the trigger is a button with the project's full name as tooltip. */
export const Closed: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'alpha' });
    await expect(trigger).toHaveAttribute('title', 'alpha');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

/** Opening the menu lists the projects under the "Projects" label, with the active one checked. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'alpha' }));
    const menu = within(document.body).getByRole('menu');
    await expect(within(menu).getByText('Projects')).toBeInTheDocument();
    await expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2);
    await expect(within(menu).getByRole('menuitemradio', { name: 'alpha' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  },
};

/** Choosing another project calls the callback with its ID and closes the menu. */
export const SelectsProject: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'alpha' }));
    await userEvent.click(within(document.body).getByRole('menuitemradio', { name: 'beta' }));
    await expect(args.onSelect).toHaveBeenCalledWith('p-beta');
    await expect(within(document.body).queryByRole('menu')).toBeNull();
  },
};

/** The menu is not offered while a card form or a confirmation is open. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'alpha' })).toBeDisabled();
  },
};

/** With the all-projects scope, the choice shows the scope's own label and is checked in the menu. */
export const AllProjects: Story = {
  args: { allProjects: true, activeProjectId: 'all', allProjectsLabel: 'All Projects' },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'All Projects' });
    await userEvent.click(trigger);
    await expect(
      within(document.body).getByRole('menuitemradio', { name: 'All Projects' }),
    ).toHaveAttribute('aria-checked', 'true');
  },
};

/** With no projects, the trigger is disabled and says so. */
export const NoProjects: Story = {
  args: { projects: [], activeProjectId: null },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'No projects' });
    await expect(trigger).toBeDisabled();
  },
};

/** Without a chosen project, the trigger asks the person to choose one. */
export const NoSelection: Story = {
  args: { activeProjectId: null },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'Choose a project' }),
    ).toBeEnabled();
  },
};

/** A long name is cut visually, but the full name stays in the tooltip and in the menu. */
export const LongName: Story = {
  args: {
    projects: [
      makeProject({
        id: 'p-long' as ProjectId,
        name: 'an-unusually-long-project-name-that-would-not-fit-in-the-header-bar',
      }),
    ],
    activeProjectId: 'p-long' as ProjectId,
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', {
      name: 'an-unusually-long-project-name-that-would-not-fit-in-the-header-bar',
    });
    await expect(trigger).toHaveAttribute(
      'title',
      'an-unusually-long-project-name-that-would-not-fit-in-the-header-bar',
    );
  },
};

/** Without a chosen project the trigger asks for one in Japanese. */
export const JapaneseNoSelection: Story = {
  args: { activeProjectId: null },
  globals: { locale: 'ja' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'プロジェクトを選択' }),
    ).toBeEnabled();
  },
};
