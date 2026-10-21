import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog, THEME_SWATCHES } from '../../src/features/settings/ui/SettingsDialog';
import { selectLocale } from '../../src/shared/i18n';
import { ACCENTS, MODES, selectTheme } from '../../src/shared/theme';

const COLORS = [
  'Blue',
  'Sky',
  'Cyan',
  'Teal',
  'Green',
  'Lime',
  'Yellow',
  'Orange',
  'Red',
  'Pink',
  'Purple',
  'Gray',
];

function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open settings
      </button>
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function reset() {
  window.localStorage.clear();
  selectLocale('en');
  selectTheme({ mode: 'light', accent: 'blue' });
  window.localStorage.clear();
}

beforeEach(reset);
afterEach(() => {
  cleanup();
  reset();
});

describe('SettingsDialog content', () => {
  it('is a modal dialog titled Settings with the language and theme groups', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getByRole('radiogroup', { name: 'Language' })).toBeTruthy();
    expect(within(dialog).getByRole('radiogroup', { name: 'Color theme' })).toBeTruthy();
    expect(within(dialog).getByText('Changes apply immediately.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /save|cancel/i })).toBeNull();
  });

  it('lists all 24 swatches in the fixed order, Light row first, with color-independent names', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Color theme' });
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-label') ?? radio.textContent);
    expect(names).toEqual([
      ...COLORS.map((color) => `Light ${color}`),
      ...COLORS.map((color) => `Dark ${color}`),
    ]);
    expect(within(group).getByText('Light')).toBeTruthy();
    expect(within(group).getByText('Dark')).toBeTruthy();
  });

  it('marks exactly the current theme as selected, with a visible check, and names it', () => {
    selectTheme({ mode: 'dark', accent: 'purple' });
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Color theme' });
    const checked = within(group)
      .getAllByRole('radio')
      .filter((radio) => radio.getAttribute('aria-checked') === 'true');
    expect(checked.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Dark Purple']);
    expect(checked[0]?.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Dark Purple')).toBeTruthy();
  });

  it('defaults to Light Blue and English as the current selections', () => {
    render(<Harness />);
    expect(screen.getByRole('radio', { name: 'Light Blue' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: '日本語' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('uses Japanese names and labels after the language changes', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: '日本語' }));
    const dialog = await screen.findByRole('dialog', { name: '設定' });
    expect(within(dialog).getByRole('radiogroup', { name: 'カラーテーマ' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'ライト・ブルー' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'ダーク・グレー' })).toBeTruthy();
    expect(within(dialog).getByText('変更はすぐに適用され、保存されます。')).toBeTruthy();
  });

  it('keeps the swatch colors in step with the theme tokens of theme.css', () => {
    const css = readFileSync(
      join(resolve(import.meta.dirname, '../..'), 'src/shared/styles/theme.css'),
      'utf8',
    );
    expect(Object.keys(THEME_SWATCHES)).toHaveLength(24);
    for (const mode of MODES) {
      for (const accent of ACCENTS) {
        const rule = css.match(
          new RegExp(
            `:root\\[data-mode="${mode}"\\]\\[data-accent="${accent}"\\][^{]*\\{([^}]*)\\}`,
          ),
        );
        expect(rule, `${mode}/${accent}`).not.toBeNull();
        const accentColor = /--r-accent:\s*([^;]+);/.exec(rule?.[1] ?? '')?.[1];
        expect(THEME_SWATCHES[`${mode}-${accent}`]?.accent.toLowerCase()).toBe(
          accentColor?.toLowerCase(),
        );
      }
    }
  });
});

describe('SettingsDialog selection', () => {
  it('applies and saves a theme immediately, stays open, and keeps the focus on the choice', async () => {
    render(<Harness />);
    const tile = screen.getByRole('radio', { name: 'Dark Teal' });
    await userEvent.click(tile);

    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('teal');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(JSON.parse(window.localStorage.getItem('agboard.theme') ?? 'null')).toEqual({
      mode: 'dark',
      accent: 'teal',
    });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(tile.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Light Blue' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(document.activeElement).toBe(tile);
    expect(screen.getByText('Dark Teal')).toBeTruthy();
  });

  it('keeps the selection on the page when the theme cannot be saved', async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      render(<Harness />);
      await userEvent.click(screen.getByRole('radio', { name: 'Light Red' }));
      expect(document.documentElement.dataset.accent).toBe('red');
      expect(screen.getByRole('radio', { name: 'Light Red' }).getAttribute('aria-checked')).toBe(
        'true',
      );
      expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('switches the language immediately, saves agboard.locale, stays open and keeps focus', async () => {
    render(<Harness />);
    const japanese = screen.getByRole('radio', { name: '日本語' });
    await userEvent.click(japanese);

    expect(document.documentElement.lang).toBe('ja');
    expect(window.localStorage.getItem('agboard.locale')).toBe('ja');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '日本語' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '日本語' }));
  });

  it('does not touch the language or the other mode when only one is chosen', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: 'Dark Pink' }));
    expect(window.localStorage.getItem('agboard.locale')).toBeNull();
    expect(document.documentElement.lang).toBe('en');
    await userEvent.click(screen.getByRole('radio', { name: '日本語' }));
    expect(document.documentElement.dataset.accent).toBe('pink');
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('does not revert the selection when the dialog is closed', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('radio', { name: 'Light Orange' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.documentElement.dataset.accent).toBe('orange');
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(screen.getByRole('radio', { name: 'Light Orange' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });
});

describe('SettingsDialog keyboard and focus', () => {
  it('moves focus into the dialog on open, to the selected language', async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'English' })),
    );
  });

  it('selects a swatch with Space and with Enter', async () => {
    render(<Harness />);
    const tile = screen.getByRole('radio', { name: 'Light Cyan' });
    tile.focus();
    await userEvent.keyboard(' ');
    expect(document.documentElement.dataset.accent).toBe('cyan');

    const other = screen.getByRole('radio', { name: 'Dark Lime' });
    other.focus();
    await userEvent.keyboard('{Enter}');
    expect(document.documentElement.dataset.accent).toBe('lime');
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
  });

  it('keeps Tab inside the dialog', async () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let step = 0; step < 12; step++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let step = 0; step < 12; step++) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes with Escape and returns focus to the opener', async () => {
    render(<Harness initiallyOpen={false} />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes with the close button and returns focus to the opener', async () => {
    render(<Harness initiallyOpen={false} />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('SettingsDialog saving', () => {
  const saved = { locale: 'ja', theme: { mode: 'light', accent: 'blue' }, revision: 1 };

  function stubFetch(status: number) {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(status === 200 ? saved : { code: 'preferences_unavailable' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('applies a choice at once and saves it through the endpoint', async () => {
    const fetcher = stubFetch(200);
    render(
      <SettingsDialog
        open
        onOpenChange={() => {}}
        preferencesEndpoint={{ url: '/api/preferences', token: () => 't' }}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Dark Purple' }));
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(document.documentElement.dataset.accent).toBe('purple');
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/api/preferences');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ theme: { mode: 'dark', accent: 'purple' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('saves a language choice as locale only', async () => {
    const fetcher = stubFetch(200);
    render(
      <SettingsDialog
        open
        onOpenChange={() => {}}
        preferencesEndpoint={{ url: '/api/preferences' }}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '日本語' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ locale: 'ja' });
  });

  it('keeps the choice on the page and shows the save error when the save fails', async () => {
    stubFetch(500);
    render(
      <SettingsDialog
        open
        onOpenChange={() => {}}
        preferencesEndpoint={{ url: '/api/preferences' }}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Light Red' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(document.documentElement.dataset.accent).toBe('red');
  });

  it('follows a preferences event that changes the page while it is open', async () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    document.documentElement.dataset.mode = 'dark';
    document.documentElement.dataset.accent = 'pink';
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Dark Pink' }).getAttribute('aria-checked')).toBe(
        'true',
      ),
    );
  });
});
