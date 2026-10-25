// The guide's timing and screen types, shared by the controller and the layer.

/** The minimum time a card stays in Running before it can move on, in milliseconds. */
export const RUNNING_MIN_MS = 1800;
/** How often the tab that holds the guide renews its lease, in milliseconds. */
export const HEARTBEAT_MS = 10_000;
/** How long the archive notice stays on the board, in milliseconds. */
export const NOTICE_MS = 4000;

export type GuideScreen =
  | { kind: 'hidden' }
  | { kind: 'welcome' }
  | { kind: 'step' }
  | { kind: 'complete' }
  | { kind: 'notice' };
