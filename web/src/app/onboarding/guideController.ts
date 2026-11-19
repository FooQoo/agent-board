// What the guide's controller returns to the view: the screen to show, the step, the sample cards
// of that step, and the commands to run.

import type { TaskSummary } from '../../shared/api/contracts';
import type { GuideLocale } from './guideSamples';
import type { GuidePhase, GuideScreen } from './guideTiming';

export interface GuideController {
  screen: GuideScreen;
  phase: GuidePhase;
  /** The sample cards as the step shows them; they are never part of the board. */
  samples: TaskSummary[];
  /** The language of the samples and of their question, fixed when the guide starts. */
  locale: GuideLocale;
  /** True once a running card has been on screen for the minimum time, so its step can move on. */
  ready: boolean;
  start(): void;
  skip(): void;
  next(): void;
  exit(): void;
  finish(): void;
  /** The sample request was sent: the agent plans it. */
  sent(): void;
  /** The sample question was answered: the agent starts the plan. */
  answered(): void;
}
