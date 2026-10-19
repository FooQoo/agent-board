import { preloadable } from '../../../shared/lib/lazy/preloadable';
import type { HeaderSettings } from '../../../shared/ui/app-header/Header';

/** The settings dialog loads after the header is shown (see `preloadable`). */
export const settingsDialog = preloadable(() =>
  import('./SettingsDialog').then((module) => module.SettingsDialog),
);

/** The settings dialog as the header hosts it; pages pass it to `Header`. */
export const settingsSlot: HeaderSettings = {
  render: (state) => <settingsDialog.Component {...state} />,
  preload: settingsDialog.preload,
};
