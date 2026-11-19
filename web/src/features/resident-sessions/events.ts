// Two small buses between parts that never render each other: the footer and the settings row ask
// for the dialog, and the dialog tells the footer that the session changed.

type Listener = () => void;

const dialogListeners = new Set<Listener>();
const changeListeners = new Set<Listener>();

/** Asks the board to open the resident-session dialog. */
export function requestResidentDialog(): void {
  for (const listener of dialogListeners) listener();
}

/** Calls `listener` for each request to open the dialog; returns the function that stops listening. */
export function onResidentDialogRequest(listener: Listener): () => void {
  dialogListeners.add(listener);
  return () => {
    dialogListeners.delete(listener);
  };
}

/** Tells the readers of the session that a launch, stop or auto-start change just happened. */
export function notifyResidentChanged(): void {
  for (const listener of changeListeners) listener();
}

/** Calls `listener` after each change made from the dialog; returns the function that stops listening. */
export function onResidentChanged(listener: Listener): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
