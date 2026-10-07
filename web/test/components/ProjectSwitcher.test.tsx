import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSwitcher } from '../../src/components/ProjectSwitcher';
import { selectLocale } from '../../src/i18n';
import type { Project } from '../../src/types';
import { PROJECTS, PROJECT_A, PROJECT_B, PROJECT_C } from '../fixtures';

beforeEach(() => selectLocale('en'));

const trigger = () => screen.getByRole('button', { expanded: false });

describe('ProjectSwitcher', () => {
  it('shows the current project as the button and opens a menu of every project', async () => {
    render(
      <ProjectSwitcher projects={PROJECTS} activeProjectId={PROJECT_A.id} onSelect={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'agent-board' }).getAttribute('aria-haspopup')).toBe(
      'menu',
    );
    expect(screen.queryByRole('menu')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'agent-board' }));

    const menu = screen.getByRole('menu');
    expect(within(menu).getByText('Projects')).toBeTruthy();
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      'agent-board',
      'knowledge',
      'tech-blog',
    ]);
  });

  it('checks only the current project, by ID', async () => {
    const twins: Project[] = [PROJECT_A, { ...PROJECT_B, name: PROJECT_A.name }];
    render(<ProjectSwitcher projects={twins} activeProjectId={PROJECT_B.id} onSelect={() => {}} />);
    await userEvent.click(trigger());
    const [first, second] = screen.getAllByRole('menuitemradio');
    expect(first?.getAttribute('aria-checked')).toBe('false');
    expect(second?.getAttribute('aria-checked')).toBe('true');
  });

  it('reports the ID of the chosen project with a click and closes', async () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher projects={PROJECTS} activeProjectId={PROJECT_A.id} onSelect={onSelect} />,
    );
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'knowledge' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PROJECT_B.id);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('works from the keyboard: Enter opens, arrows move, Enter chooses', async () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher projects={PROJECTS} activeProjectId={PROJECT_A.id} onSelect={onSelect} />,
    );
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PROJECT_C.id);
  });

  it('closes on Escape and returns the focus to the button without choosing', async () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher projects={PROJECTS} activeProjectId={PROJECT_A.id} onSelect={onSelect} />,
    );
    const button = trigger();
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('jumps to a project by typing its first letters', async () => {
    const onSelect = vi.fn();
    render(
      <ProjectSwitcher projects={PROJECTS} activeProjectId={PROJECT_A.id} onSelect={onSelect} />,
    );
    await userEvent.click(trigger());
    await userEvent.keyboard('te');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(PROJECT_C.id);
  });

  it('cannot be opened while a form is open', async () => {
    render(
      <ProjectSwitcher
        projects={PROJECTS}
        activeProjectId={PROJECT_A.id}
        disabled
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'agent-board' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.click(button);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is a disabled "No projects" entry when there are none', async () => {
    render(<ProjectSwitcher projects={[]} activeProjectId={null} onSelect={() => {}} />);
    const button = screen.getByRole('button', { name: 'No projects' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('offers "Choose a project" with nothing checked when the current project is unknown', async () => {
    render(
      <ProjectSwitcher projects={PROJECTS} activeProjectId={'f'.repeat(32)} onSelect={() => {}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose a project' }));
    for (const item of screen.getAllByRole('menuitemradio')) {
      expect(item.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('uses the Japanese labels', async () => {
    selectLocale('ja');
    render(<ProjectSwitcher projects={PROJECTS} activeProjectId={null} onSelect={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'プロジェクトを選択' }));
    expect(within(screen.getByRole('menu')).getByText('プロジェクト')).toBeTruthy();
  });

  it('keeps the full name of a long project as the accessible name and tooltip', async () => {
    const name = 'a-very-long-project-name-'.repeat(2).slice(0, 50);
    render(
      <ProjectSwitcher
        projects={[{ ...PROJECT_A, name }]}
        activeProjectId={PROJECT_A.id}
        onSelect={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('title')).toBe(name);
    await userEvent.click(button);
    expect(screen.getByRole('menuitemradio', { name }).getAttribute('title')).toBe(name);
  });

  it('lists a hundred projects in one scrolling menu', async () => {
    const many: Project[] = Array.from({ length: 100 }, (_, index) => ({
      id: index.toString(16).padStart(32, '0'),
      name: `project-${String(index).padStart(3, '0')}`,
      createdAt: PROJECT_A.createdAt,
    }));
    render(
      <ProjectSwitcher projects={many} activeProjectId={many[0]?.id ?? null} onSelect={() => {}} />,
    );
    await userEvent.click(trigger());
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(100);
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });
});
