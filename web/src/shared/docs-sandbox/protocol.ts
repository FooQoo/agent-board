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

/**
 * The board's tokens the sandbox's Markdown typography uses. The sandbox has none of the board's
 * stylesheets, so the board sends their current values, and sends them again when the theme changes.
 */
export const SANDBOX_THEME_TOKENS = [
  '--r-bg',
  '--r-surface',
  '--r-lane',
  '--r-border',
  '--r-text',
  '--r-text2',
  '--r-muted',
  '--r-accent',
  '--r-accent-soft',
  '--r-done',
  '--r-danger',
  '--font-sans',
  '--font-mono',
] as const;

/** The board's theme: light or dark, and the values of `SANDBOX_THEME_TOKENS`. */
export interface SandboxThemeMessage {
  type: 'theme';
  colorScheme: 'light' | 'dark';
  tokens: Partial<Record<(typeof SANDBOX_THEME_TOKENS)[number], string>>;
}

export function isThemeMessage(data: unknown): data is SandboxThemeMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Partial<SandboxThemeMessage>;
  return (
    message.type === 'theme' &&
    (message.colorScheme === 'light' || message.colorScheme === 'dark') &&
    typeof message.tokens === 'object' &&
    message.tokens !== null &&
    Object.entries(message.tokens).every(
      ([name, value]) =>
        (SANDBOX_THEME_TOKENS as readonly string[]).includes(name) && typeof value === 'string',
    )
  );
}

/**
 * What the sandbox page tells the board. `link` is a link the reader chose: the page never follows
 * one itself, and the board decides what the `href` (untrusted text from the document) opens.
 */
export type SandboxReply =
  | { type: 'ready' }
  | { type: 'rendered' }
  | { type: 'error'; message: string }
  | { type: 'link'; href: string };

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
  const { type, href } = data as { type?: unknown; href?: unknown };
  if (type === 'link') return typeof href === 'string';
  return type === 'ready' || type === 'rendered' || type === 'error';
}
