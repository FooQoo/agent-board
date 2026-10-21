import type { Decorator } from '@storybook/react-vite';
import { createInstance, type i18n as I18n } from 'i18next';
import { type ReactNode, useLayoutEffect, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { resources } from '../../src/shared/i18n/resources';
import {
  selectTheme,
  type ACCENTS,
  type MODES,
  type Theme,
  type ThemeStorage,
} from '../../src/shared/theme';
import decisionRequestCss from '../../src/features/tasks/answer/decision-request.css?inline';
import modalCss from '../../src/shared/styles/modal.css?inline';
import monitorCss from '../../src/pages/monitor/monitor.css?inline';

export type StoryLocale = 'en' | 'ja';
export type StoryWidth = 'desktop' | 'desktop-900' | 'phone-320' | 'phone-375' | 'phone-390';
export type StoryFrame = 'board' | 'monitor';

/** The toolbar values a Story reads. The toolbar itself is declared in preview.tsx. */
export interface StoryGlobals {
  locale: StoryLocale;
  mode: (typeof MODES)[number];
  accent: (typeof ACCENTS)[number];
  width: StoryWidth;
}

/** Widths a Story is checked at: the desktop board, and the phone monitor at two phone widths. */
export const STORY_WIDTHS: Record<StoryWidth, number> = {
  desktop: 1280,
  'desktop-900': 900,
  'phone-320': 320,
  'phone-375': 375,
  'phone-390': 390,
};

/** The monitor's own stylesheets. They are injected only in a monitor frame, and removed after it. */
export const MONITOR_STYLESHEETS = [modalCss, decisionRequestCss, monitorCss];

/** Storage that keeps the value in memory, so a Story never writes to the browser's storage. */
export function createMemoryStorage(): ThemeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A translation instance for one locale, built from the product's resources. */
export function createStoryI18n(locale: StoryLocale): I18n {
  const instance = createInstance();
  void instance.init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: ['en', 'ja'],
    defaultNS: 'translation',
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
}

/**
 * Applies a theme and a language to the document of the Story, and returns a function that puts back
 * what was there before. Storage is in memory, so nothing outlives the Story.
 */
function applyStoryDocument(mode: Theme['mode'], accent: Theme['accent'], locale: StoryLocale) {
  const root = document.documentElement;
  const before = {
    mode: root.dataset.mode,
    accent: root.dataset.accent,
    dark: root.classList.contains('dark'),
    colorScheme: root.style.colorScheme,
    lang: root.lang,
  };
  selectTheme({ mode, accent }, createMemoryStorage);
  root.lang = locale;
  return () => {
    if (before.mode === undefined) delete root.dataset.mode;
    else root.dataset.mode = before.mode;
    if (before.accent === undefined) delete root.dataset.accent;
    else root.dataset.accent = before.accent;
    root.classList.toggle('dark', before.dark);
    root.style.colorScheme = before.colorScheme;
    root.lang = before.lang;
  };
}

function useStoryDocument(mode: Theme['mode'], accent: Theme['accent'], locale: StoryLocale): void {
  useLayoutEffect(() => applyStoryDocument(mode, accent, locale), [mode, accent, locale]);
}

function useMonitorStylesheets(enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return;
    const elements = MONITOR_STYLESHEETS.map((text) => {
      const element = document.createElement('style');
      element.dataset.storyStyle = 'monitor';
      element.textContent = text;
      document.head.append(element);
      return element;
    });
    return () => {
      for (const element of elements) element.remove();
    };
  }, [enabled]);
}

interface StoryEnvironmentProps {
  globals: StoryGlobals;
  frame: StoryFrame;
  searchParams?: string;
  children: ReactNode;
}

/**
 * The product's surroundings for one Story: theme, language, the memory URL of nuqs, the monitor
 * stylesheets and the width frame. Everything it sets is undone when the Story unmounts.
 */
export function StoryEnvironment({
  globals,
  frame,
  searchParams,
  children,
}: StoryEnvironmentProps) {
  const i18n = useMemo(() => createStoryI18n(globals.locale), [globals.locale]);
  useStoryDocument(globals.mode, globals.accent, globals.locale);
  useMonitorStylesheets(frame === 'monitor');
  return (
    <I18nextProvider i18n={i18n}>
      <NuqsTestingAdapter searchParams={searchParams ?? ''} hasMemory>
        <div
          className={`story-frame story-frame--${frame} story-frame--${globals.width}`}
          data-story-width={globals.width}
          data-story-frame={frame}
          style={{ width: STORY_WIDTHS[globals.width], margin: '0 auto' }}
        >
          {children}
        </div>
      </NuqsTestingAdapter>
    </I18nextProvider>
  );
}

/** Wraps every Story in the product's surroundings, chosen by the toolbar and the Story's parameters. */
export const withStoryEnvironment: Decorator = (Story, context) => {
  const globals = context.globals as unknown as StoryGlobals;
  const parameters = context.parameters as {
    storyFrame?: StoryFrame;
    searchParams?: string;
  };
  return (
    <StoryEnvironment
      globals={globals}
      frame={parameters.storyFrame ?? 'board'}
      searchParams={parameters.searchParams}
    >
      <Story />
    </StoryEnvironment>
  );
};
