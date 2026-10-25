import { i18n } from './index';
import { onboardingEn } from './locales/en/onboarding';
import { onboardingJa } from './locales/ja/onboarding';

// The first-run guide's text is registered by the guide's own code, not by the shared resources, so
// pages that never show the guide (such as the monitor) do not load it. Import this module before
// rendering any guide view.
i18n.addResourceBundle('en', 'translation', onboardingEn, true, true);
i18n.addResourceBundle('ja', 'translation', onboardingJa, true, true);
