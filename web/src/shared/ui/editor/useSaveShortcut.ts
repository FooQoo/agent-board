import { useEffect } from 'react';

/** What can sit on top of the editor: the discard question and an enlarged picture. */
const COVERING = '.editor-confirm, [data-lightbox]';

/**
 * Cmd+S and Ctrl+S run `onSave` instead of the browser's "Save page". `onSave` decides for itself
 * whether a save can start, so the keys do what the Save button would. The listener is on the
 * document, in the capture phase, because the focus can be on any field or on nothing at all.
 */
export function useSaveShortcut(onSave: (() => void) | undefined): void {
  useEffect(() => {
    if (onSave === undefined) return;
    const handle = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 's' || event.isComposing) return;
      event.preventDefault();
      if (event.repeat || document.querySelector(COVERING) !== null) return;
      onSave();
    };
    document.addEventListener('keydown', handle, true);
    return () => document.removeEventListener('keydown', handle, true);
  }, [onSave]);
}
