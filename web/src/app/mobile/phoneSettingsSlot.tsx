import { preloadable } from '../../shared/lib/lazy/preloadable';
import type { PreferencesEndpoint } from '../../shared/preferences';
import type { HeaderSettings } from '../../shared/ui/app-header/Header';

/** The dialog loads after the header is shown, like the other settings dialogs. */
const phoneSettings = preloadable(() =>
  import('./PhoneSettings').then((module) => module.PhoneSettings),
);

/** The phone screen's settings as the header hosts them, saving through `endpoint` when given. */
export function phoneSettingsSlot(endpoint: PreferencesEndpoint | undefined): HeaderSettings {
  return {
    render: (state) => <phoneSettings.Component {...state} preferencesEndpoint={endpoint} />,
    preload: phoneSettings.preload,
  };
}
