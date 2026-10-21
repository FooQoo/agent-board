import { settingsDialog } from '../features/settings/ui/settingsSlot';
import { preloadable } from '../shared/lib/lazy/preloadable';
import type { HeaderSettings } from '../shared/ui/app-header/Header';

/** The connection entry loads with the settings dialog, not with the first screen. */
const connectionSettings = preloadable(() =>
  import('../features/monitor-connections/ui/ConnectionSettings').then(
    (module) => module.ConnectionSettings,
  ),
);

/**
 * The settings dialog of the PC board: language, theme and the mobile connection.
 * The phone monitor uses the plain `settingsSlot`, so it never offers the connection.
 */
export const boardSettingsSlot: HeaderSettings = {
  render: (state) => (
    <settingsDialog.Component {...state} extra={<connectionSettings.Component />} />
  ),
  preload: () => Promise.all([settingsDialog.preload(), connectionSettings.preload()]),
};
