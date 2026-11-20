// A small bus between the phone navigation bar and the dialogs that the settings open (the
// notification and resident-session dialogs). Those dialogs live outside the monitor screen, so
// the bar cannot close them directly: it announces that the person switched tabs, and each dialog
// that listens closes itself.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Closes every dialog that listens: the phone bar calls it when a tab is chosen. */
export function dismissSettingsSheets(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` when the bar switches tabs; returns the function that stops listening. */
export function onDismissSettingsSheets(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
