// What the guide's controller returns to the view: the screen to show and the commands to send.

import type { GuideState } from './api';
import type { GuideScreen } from './guideTiming';

export interface GuideController {
  screen: GuideScreen;
  state: GuideState | null;
  busy: boolean;
  error: string | null;
  /** True once a running card has been on screen for the minimum time, so its step can move on. */
  ready: boolean;
  start(): void;
  skip(): void;
  next(): void;
  exit(): void;
  finish(): void;
  retry(): void;
}
