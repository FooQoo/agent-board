import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Project, ProjectId } from '../types';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SettingsDialog } from './SettingsDialog';

export interface HeaderProps {
  /** The project list; `null` until it is known, which hides the switcher. */
  projects?: Project[] | null;
  activeProjectId?: ProjectId | null;
  /** A card form or confirmation is open, so the project cannot change. */
  switchDisabled?: boolean;
  onSelectProject?: (projectId: ProjectId) => void;
  /** Add card is offered only once the board of the project has loaded. */
  canAdd?: boolean;
  onAdd?: () => void;
  onArchive?: () => void;
}

export function Header({
  projects = null,
  activeProjectId = null,
  switchDisabled = false,
  onSelectProject = () => {},
  canAdd = false,
  onAdd = () => {},
  onArchive = () => {},
}: HeaderProps) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <header className="header">
      <h1 className="header__app">
        <span className="header__logo">
          <img src="/logo-white.png" alt="" width="24" height="24" />
        </span>
        <span>Agent Board</span>
      </h1>
      {projects !== null && (
        <>
          <span className="header__slash" aria-hidden="true">
            /
          </span>
          <div className="header__switcher">
            <ProjectSwitcher
              projects={projects}
              activeProjectId={activeProjectId}
              disabled={switchDisabled}
              onSelect={onSelectProject}
            />
          </div>
        </>
      )}
      <span className="header__spacer" aria-hidden="true" />
      {canAdd && (
        <Button
          type="button"
          variant="outline"
          className="header__archive"
          disabled={switchDisabled}
          onClick={onArchive}
        >
          <ArchiveIcon aria-hidden="true" />
          {t('archive.title')}
        </Button>
      )}
      {canAdd && (
        <Button type="button" className="header__add" disabled={switchDisabled} onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {t('dialog.addCard')}
        </Button>
      )}
      <Button
        ref={settingsButtonRef}
        type="button"
        variant="outline"
        size="icon"
        className="header__settings"
        aria-label={t('settings.title')}
        aria-haspopup="dialog"
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsIcon aria-hidden="true" />
      </Button>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        restoreFocusRef={settingsButtonRef}
      />
    </header>
  );
}
