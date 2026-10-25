import { preloadable } from '../../shared/lib/lazy/preloadable';

/**
 * The first-run guide's layer. Its code loads after the board's first screen, so the guide stays out
 * of the board's first load. The guide mounts with the board and decides for itself when it may run.
 */
export const guideLayer = preloadable(() =>
  import('./GuideLayer').then((module) => module.GuideLayer),
);
