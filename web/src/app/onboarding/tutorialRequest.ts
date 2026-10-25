// The settings dialog asks the board to show the guide again. A request only says that the
// user wants it: the guide decides when it can be shown, and keeps the request until then.

type Listener = () => void;

const listeners = new Set<Listener>();

export function requestTutorial(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` for each request; returns the function that stops listening. */
export function onTutorialRequest(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
