import { Suspense, useEffect, useRef, useState } from 'react';
import type { HeaderSettings } from '../../../shared/ui/app-header/Header';
import { type PhoneNavItem, PhoneNavBar } from './PhoneNavBar';

export interface PhoneNavProps {
  /** The settings drawer the Settings item opens. */
  settings: HeaderSettings;
  /** The questions that wait for an answer (the count on Messages). */
  questionCount: number;
  /** Nothing to archive (no done card), or no way to archive. */
  archiveDisabled: boolean;
  /** What the screen has open above the board, for the open item of the bar. */
  open: Exclude<PhoneNavItem, 'board' | 'settings'> | null;
  onMessages: () => void;
  onAsk: () => void;
  onArchive: () => void;
  /** Board: every sheet the screen owns closes. Settings calls it before it opens. */
  onBoard: () => void;
}

/**
 * The bottom bar with the settings drawer it opens. The screen owns the other drawers (messages,
 * Ask, the archive confirmation) and says which one is open.
 */
export function PhoneNav({
  settings,
  questionCount,
  archiveDisabled,
  open,
  onMessages,
  onAsk,
  onArchive,
  onBoard,
}: PhoneNavProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const restoreFocusRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // A failed fetch is tried again when the drawer is first rendered.
    settings.preload?.().catch(() => {});
  }, [settings]);
  return (
    <>
      <PhoneNavBar
        current={settingsOpen ? 'settings' : (open ?? 'board')}
        questionCount={questionCount}
        archiveDisabled={archiveDisabled}
        onBoard={() => {
          setSettingsOpen(false);
          onBoard();
        }}
        // The bar stays in front of an open sheet, so each item first closes whatever is open.
        onMessages={() => {
          setSettingsOpen(false);
          onMessages();
        }}
        onAsk={() => {
          setSettingsOpen(false);
          onAsk();
        }}
        onArchive={() => {
          setSettingsOpen(false);
          onArchive();
        }}
        onSettings={() => {
          onBoard();
          setSettingsOpen(true);
        }}
      />
      <Suspense fallback={null}>
        {settings.render({ open: settingsOpen, onOpenChange: setSettingsOpen, restoreFocusRef })}
      </Suspense>
    </>
  );
}
