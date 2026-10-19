import { Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchiveIcon, ArrowLeftIcon, LayersIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import type { Project, ProjectId } from '../../api/contracts';

export type ViewMode = 'board' | 'archive' | 'epics';

/** What the header hands to the settings dialog it hosts. */
export interface SettingsSlotState {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The settings button, which takes the focus back when the dialog closes. */
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
}

/** The settings dialog, composed by the page. Its code may load after the header is shown. */
export interface HeaderSettings {
  render: (state: SettingsSlotState) => ReactNode;
  /** Fetches the dialog's code once the header is shown (see `preloadable`). */
  preload?: () => Promise<unknown>;
}

export interface HeaderProps {
  /** The project list; `null` until it is known, which hides the switcher. */
  projects?: Project[] | null;
  activeProjectId?: ProjectId | null;
  /** A card form or confirmation is open, so the project cannot change. */
  switchDisabled?: boolean;
  /** Add card is offered only once the board of the project has loaded. */
  canAdd?: boolean;
  onAdd?: () => void;
  onArchive?: () => void;
  onEpics?: () => void;
  viewMode?: ViewMode;
  onBack?: () => void;
  /** The project switcher, shown after the slash when the project list is known. */
  projectSwitcher?: ReactNode;
  /** The settings dialog; without it the settings button opens nothing. */
  settings?: HeaderSettings;
}

export function Header({
  projects = null,
  activeProjectId = null,
  switchDisabled = false,
  canAdd = false,
  onAdd = () => {},
  onArchive = () => {},
  onEpics = () => {},
  viewMode = 'board',
  onBack = () => {},
  projectSwitcher = null,
  settings,
}: HeaderProps) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    // A failed fetch is tried again when the dialog is first rendered.
    settings?.preload?.().catch(() => {});
  }, [settings]);
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
          {viewMode === 'epics' ? (
            // The epic screen shows the project's name as text, as its design does; switch projects from the board.
            <span className="header__board-name">
              {projects.find((project) => project.id === activeProjectId)?.name ?? ''}
            </span>
          ) : (
            <div className="header__switcher">{projectSwitcher}</div>
          )}
        </>
      )}
      <span className="header__spacer" aria-hidden="true" />
      {viewMode === 'board' && canAdd && (
        <Button type="button" className="header__add" disabled={switchDisabled} onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {t('dialog.addCard')}
        </Button>
      )}
      {viewMode === 'archive' || viewMode === 'epics' ? (
        <Button
          type="button"
          variant="outline"
          className="header__back"
          disabled={switchDisabled}
          onClick={onBack}
        >
          {viewMode === 'epics' && <ArrowLeftIcon aria-hidden="true" />}
          {viewMode === 'epics' ? t('epics.back') : t('archive.back')}
        </Button>
      ) : canAdd ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="header__epics"
            disabled={switchDisabled}
            onClick={onEpics}
          >
            <LayersIcon aria-hidden="true" />
            {t('epics.title')}
          </Button>
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
        </>
      ) : null}
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
      <Suspense fallback={null}>
        {settings?.render({
          open: settingsOpen,
          onOpenChange: setSettingsOpen,
          restoreFocusRef: settingsButtonRef,
        })}
      </Suspense>
    </header>
  );
}
