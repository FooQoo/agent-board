import { preloadable } from '../../../shared/lib/lazy/preloadable';
import type { PreferencesEndpoint } from '../../../shared/preferences';
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

/** The settings as a bottom sheet, for the phone screen's bar. */
export const sheetSettingsSlot: HeaderSettings = {
  render: (state) => <settingsDialog.Component {...state} kind="sheet" />,
  preload: settingsDialog.preload,
};

/** The settings dialog that saves its choices through `endpoint`; `sheet` makes it a bottom sheet. */
export function savingSettingsSlot(endpoint: PreferencesEndpoint, kind?: 'sheet'): HeaderSettings {
  return {
    render: (state) => (
      <settingsDialog.Component {...state} preferencesEndpoint={endpoint} kind={kind} />
    ),
    preload: settingsDialog.preload,
  };
}
