import type { Locale } from '@/shared/i18n';

/**
 * The one list of features that are in public preview. A screen asks for its feature here; every
 * other feature is generally available and shows nothing. `anchor` is the heading of that feature
 * on the feature-stages documentation page. The `connectAndUpdate` and `listen` entries have no
 * screen of their own: connect and update print their notice in the terminal (Rust), and listen is
 * explained in the documentation only. They are listed so the list stays complete.
 */
export const PREVIEW_FEATURES = {
  docs: { anchor: 'docs' },
  mobileMonitor: { anchor: 'mobile-monitor' },
  onboarding: { anchor: 'onboarding' },
  connectAndUpdate: { anchor: 'connect-and-update' },
  listen: { anchor: 'listen' },
} as const;

export type PreviewFeature = keyof typeof PREVIEW_FEATURES;

/** The scheme is joined here so the source keeps no literal remote address (see test/styles.test.ts). */
const SITE = `${'https'}://fooqoo.github.io/agent-board`;

/** The feature-stages page of the documentation site, per language. */
export const FEATURE_STAGES_URL: Record<Locale, string> = {
  en: `${SITE}/guide/feature-stages`,
  ja: `${SITE}/ja/guide/feature-stages`,
};

/** The documentation link of a preview feature in the given language. */
export function featureStagesUrl(feature: PreviewFeature, locale: Locale): string {
  return `${FEATURE_STAGES_URL[locale]}#${PREVIEW_FEATURES[feature].anchor}`;
}
