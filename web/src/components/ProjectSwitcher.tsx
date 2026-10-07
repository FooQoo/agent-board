import { ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Project, ProjectId } from '../types';

export interface ProjectSwitcherProps {
  projects: Project[];
  /** The project whose board is shown; `null` or an unknown ID means no project is chosen. */
  activeProjectId: ProjectId | null;
  /** Card forms and confirmations are open, so the project cannot change. */
  disabled?: boolean;
  /** Called with the ID of the chosen project. */
  onSelect: (projectId: ProjectId) => void;
}

/**
 * The project name in the header, opening a single-choice menu of all projects. The menu, its keyboard
 * handling, typeahead and screen-edge placement are Radix's; long names are cut visually only, so the
 * full name stays in the accessible name and the tooltip.
 */
export function ProjectSwitcher({
  projects,
  activeProjectId,
  disabled = false,
  onSelect,
}: ProjectSwitcherProps) {
  const { t } = useTranslation();
  const active = projects.find((project) => project.id === activeProjectId) ?? null;
  const empty = projects.length === 0;
  const label = empty ? t('project.none') : (active?.name ?? t('project.choose'));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="project-switcher"
        disabled={disabled || empty}
        title={active?.name}
      >
        <span className="project-switcher__name">{label}</span>
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{t('project.menuLabel')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active?.id ?? ''} onValueChange={onSelect}>
          {projects.map((project) => (
            <DropdownMenuRadioItem key={project.id} value={project.id} title={project.name}>
              <span className="menu__name">{project.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
