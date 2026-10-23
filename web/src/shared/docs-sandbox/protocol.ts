/** What the board sends the sandbox page: the MDX to run and the words for its own notices. */
export interface SandboxRenderMessage {
  type: 'render';
  source: string;
  labels: SandboxLabels;
}

/** The sandbox page has no translations of its own; the board sends the words it shows. */
export interface SandboxLabels {
  /** Before the name of a component that is not registered: "Unregistered component". */
  unregistered: string;
  /** Before the message of a failure while running the MDX: "Runtime error". */
  runtimeError: string;
}

/** What the sandbox page tells the board. */
export type SandboxReply =
  | { type: 'ready' }
  | { type: 'rendered'; height: number }
  | { type: 'height'; height: number }
  | { type: 'error'; message: string };

export function isRenderMessage(data: unknown): data is SandboxRenderMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Partial<SandboxRenderMessage>;
  return (
    message.type === 'render' &&
    typeof message.source === 'string' &&
    typeof message.labels?.unregistered === 'string' &&
    typeof message.labels?.runtimeError === 'string'
  );
}

export function isSandboxReply(data: unknown): data is SandboxReply {
  if (typeof data !== 'object' || data === null) return false;
  const type = (data as { type?: unknown }).type;
  return type === 'ready' || type === 'rendered' || type === 'height' || type === 'error';
}
