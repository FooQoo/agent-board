import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { i18n } from '../../src/shared/i18n';
import '../../src/shared/i18n/docs-strings';
import { DocsDialogView } from '../../src/features/docs/ui/shell/DocsDialogView';
import { ConnectionSettingsView } from '../../src/features/monitor-connections/ui/ConnectionSettingsView';
import { OnboardingWelcome } from '../../src/features/onboarding/ui/OnboardingWelcome';
import { Header } from '../../src/shared/ui/app-header/Header';
import {
  FEATURE_STAGES_URL,
  PREVIEW_FEATURES,
  featureStagesUrl,
  type PreviewFeature,
} from '../../src/shared/ui/preview-feature/feature-stage';

const EN = 'https://fooqoo.github.io/agent-board/guide/feature-stages';
const JA = 'https://fooqoo.github.io/agent-board/ja/guide/feature-stages';

beforeAll(() => {
  // jsdom has no matchMedia; the Docs dialog asks for the phone layout through it.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

describe('the list of preview features', () => {
  it('names exactly the approved features, each with its own anchor', () => {
    expect(Object.keys(PREVIEW_FEATURES).sort()).toEqual(
      ['docs', 'listen', 'mobileMonitor'].sort(),
    );
    expect(Object.values(PREVIEW_FEATURES).map((f) => f.anchor)).toEqual([
      'docs',
      'mobile-monitor',
      'listen',
    ]);
  });

  it('builds the documentation link from the language and the anchor', () => {
    expect(FEATURE_STAGES_URL).toEqual({ en: EN, ja: JA });
    expect(featureStagesUrl('docs', 'en')).toBe(`${EN}#docs`);
    expect(featureStagesUrl('mobileMonitor', 'ja')).toBe(`${JA}#mobile-monitor`);
  });
});

const entries = {
  docs: () => (
    <DocsDialogView
      status="ready"
      tree={[]}
      selectedPath={null}
      onSelectFile={() => {}}
      listWidth={280}
      onResize={() => {}}
      onClose={() => {}}
    />
  ),
  mobileMonitor: () => (
    <ConnectionSettingsView
      open
      onOpenChange={() => {}}
      status="needs_config"
      draft={{ token: '', save: false }}
      onConnect={() => {}}
      onStop={() => {}}
      onResetToken={() => {}}
    />
  ),
} satisfies Partial<Record<PreviewFeature, () => React.ReactElement>>;

const WORDS = {
  en: { badge: 'Public preview', link: 'documentation', base: EN },
  ja: { badge: 'パブリックプレビュー', link: 'ドキュメント', base: JA },
} as const;

describe.each(['en', 'ja'] as const)('the preview entries in %s', (locale) => {
  const words = WORDS[locale];

  it.each(Object.keys(entries) as (keyof typeof entries)[])('%s shows the badge', async (name) => {
    await i18n.changeLanguage(locale);
    render(entries[name]());
    const dialog = screen.getByRole('dialog');
    const badge = within(dialog).getByText(words.badge);
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-variant')).toBe('outline');
  });

  it.each(['docs', 'mobileMonitor'] as const)('%s shows the notice with its link', async (name) => {
    await i18n.changeLanguage(locale);
    render(entries[name]());
    const link = within(screen.getByRole('dialog')).getByRole('link', { name: words.link });
    expect(link.getAttribute('href')).toBe(`${words.base}#${PREVIEW_FEATURES[name].anchor}`);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    const sentence = link.closest('p')?.textContent ?? '';
    expect(sentence).toContain(
      locale === 'en'
        ? 'This feature is in public preview.'
        : 'この機能はパブリックプレビューです。',
    );
  });

  it('keeps the Docs dialog named after the feature, not the badge', async () => {
    await i18n.changeLanguage(locale);
    render(entries.docs());
    expect(
      screen.getByRole('dialog', { name: locale === 'en' ? 'Docs' : 'ドキュメント' }),
    ).toBeTruthy();
  });
});

describe('a generally available screen', () => {
  it('shows no preview badge or notice', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('[data-preview-feature]')).toBeNull();
    expect(screen.queryByText('Public preview')).toBeNull();
    expect(screen.queryByText(/public preview/i)).toBeNull();
  });

  it.each(['en', 'ja'] as const)('the first-run welcome shows none in %s', async (locale) => {
    await i18n.changeLanguage(locale);
    render(<OnboardingWelcome busy={false} error={null} onStart={() => {}} onSkip={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText(WORDS[locale].badge)).toBeNull();
    expect(within(dialog).queryByRole('link')).toBeNull();
  });
});
