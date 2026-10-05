import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusIcon, SettingsIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsDialog } from './SettingsDialog';

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
        <span className="header__logo">
          <img src="/logo-white.png" alt="" width="24" height="24" />
        </span>
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
        <Button type="button" className="header__add" onClick={onAdd}>
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
