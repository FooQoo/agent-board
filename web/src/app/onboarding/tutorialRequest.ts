// The settings dialog asks the board to show the guide again. A request only says that the
// user wants it: the guide decides when it can be shown, and keeps the request until then.
// The guide's code loads after the board, so a request made before the guide listens is kept
// and handed to the first listener.

type Listener = () => void;

const listeners = new Set<Listener>();
let unheard = false;

export function requestTutorial(): void {
  if (listeners.size === 0) {
    unheard = true;
    return;
  }
  for (const listener of listeners) listener();
}

/** Calls `listener` for each request; returns the function that stops listening. */
export function onTutorialRequest(listener: Listener): () => void {
  listeners.add(listener);
  if (unheard) {
    unheard = false;
    listener();
  }
  return () => {
    listeners.delete(listener);
  };
}
