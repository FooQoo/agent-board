// The guide's timing and screen types, shared by the controller and the layer.

/** The minimum time a card stays in Running before it can move on, in milliseconds. */
export const RUNNING_MIN_MS = 1800;

/** The step the guide is on; each one is shown by the two sample cards in a lane. */
export type GuidePhase =
  | 'samples'
  | 'first-running'
  | 'first-done'
  | 'question'
  | 'second-running'
  | 'second-done';

export type GuideScreen =
  | { kind: 'hidden' }
  | { kind: 'welcome' }
  | { kind: 'step' }
  | { kind: 'complete' };
