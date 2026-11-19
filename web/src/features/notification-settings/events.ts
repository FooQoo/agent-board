// A small bus between the settings row that asks for the notification dialog and the host that
// shows it; the two never render each other.

type Listener = () => void;

const listeners = new Set<Listener>();

/** Asks the board to open the phone notification dialog. */
export function requestNotificationDialog(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` for each request to open the dialog; returns the function that stops listening. */
export function onNotificationDialogRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
