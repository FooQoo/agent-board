import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsIcon } from 'lucide-react';
import { SettingsDialog } from './SettingsDialog';
import { Plus } from './icons';

export function Header({
  boardName,
  onAdd = () => {},
}: {
  boardName: string | null;
  onAdd?: () => void;
}) {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <header className="header">
      <h1 className="header__app">
        <img className="header__logo" src="/logo.png" alt="" width="44" height="44" />
        <span>Agent Board</span>
      </h1>
      {boardName !== null && (
        <>
          <span className="header__slash" aria-hidden="true">
            /
          </span>
          <span className="header__board">{boardName}</span>
        </>
      )}
      <span className="header__spacer" aria-hidden="true" />
      {boardName !== null && (
        <button type="button" className="header__add" onClick={onAdd}>
          <Plus />
          {t('dialog.addCard')}
        </button>
      )}
      <button
        ref={settingsButtonRef}
        type="button"
        className="header__settings"
        aria-label={t('settings.title')}
        aria-haspopup="dialog"
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsIcon aria-hidden="true" />
      </button>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        restoreFocusRef={settingsButtonRef}
      />
    </header>
  );
}
