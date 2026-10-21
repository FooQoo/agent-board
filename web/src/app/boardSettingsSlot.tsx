import { preloadable } from '../shared/lib/lazy/preloadable';
import type { HeaderSettings } from '../shared/ui/app-header/Header';

/** The settings and the connection entry load after the first screen, not with it. */
const boardSettings = preloadable(() =>
  import('./BoardSettings').then((module) => module.BoardSettings),
);

/**
 * The settings dialog of the PC board: language, theme and the mobile connection.
 * The phone monitor uses the plain `settingsSlot`, so it never offers the connection.
 */
export const boardSettingsSlot: HeaderSettings = {
  render: (state) => <boardSettings.Component {...state} />,
  preload: boardSettings.preload,
};
