import type { Locale } from '../../../shared/i18n';

/**
 * The language the demo starts in: Japanese when the browser's most preferred language is
 * Japanese (`ja`, `ja-JP`, and so on), English otherwise. The demo saves nothing, so every page
 * load decides again; a language chosen in the settings lasts until the page is reloaded.
 */
export function demoLocale(languages: readonly string[]): Locale {
  const first = languages[0] ?? '';
  return first.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** The browser's preferred languages, most preferred first. */
export function browserLanguages(nav: Pick<Navigator, 'languages' | 'language'>): string[] {
  if (nav.languages && nav.languages.length > 0) return [...nav.languages];
  return nav.language ? [nav.language] : [];
}
