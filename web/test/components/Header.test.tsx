import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { Header } from '../../src/components/Header';
import { PROJECTS, PROJECT_A } from '../fixtures';
import { selectTheme } from '../../src/theme';

function reset() {
  window.localStorage.clear();
  selectLocale('en');
  selectTheme({ mode: 'light', accent: 'blue' });
  window.localStorage.clear();
}

describe('settings entry in the header', () => {
  beforeEach(reset);
  afterEach(() => {
    cleanup();
    reset();
  });

  it('replaces the globe language menu with a Settings button', () => {
    render(<Header projects={PROJECTS} activeProjectId={PROJECT_A.id} canAdd />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
    expect(document.querySelector('.language-menu, .header__language')).toBeNull();
  });

  it('draws the white logo on a tile that takes the theme accent', () => {
    const { container } = render(
      <Header projects={PROJECTS} activeProjectId={PROJECT_A.id} canAdd />,
    );
    const logo = container.querySelector('.header__logo') as HTMLElement;
    expect(logo.tagName).toBe('SPAN');
    const image = logo.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('/logo-white.png');
    expect(image.getAttribute('alt')).toBe('');
    expect(container.querySelector('img[src="/logo.png"]')).toBeNull();
  });

  it('shows the project switcher after a slash and the Add card button', () => {
    const { container } = render(
      <Header
        projects={[{ ...PROJECT_A, name: 'my-board' }]}
        activeProjectId={PROJECT_A.id}
        canAdd
      />,
    );
    expect(screen.getByRole('button', { name: 'my-board' })).toBeTruthy();
    expect(container.querySelector('.header__slash')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Add card' }).getAttribute('data-slot')).toBe(
      'button',
    );
  });

  it('shows only the logo, the app name and Settings while the board is unknown', () => {
    const { container } = render(<Header />);
    expect(container.querySelector('.header__slash')).toBeNull();
    expect(container.querySelector('.header__board')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('data-slot')).toBe(
      'button',
    );
  });

  it('keeps the Settings button while the board name is unknown (loading or error)', () => {
    render(<Header />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
  });

  it('opens the settings dialog, which holds the language choice', async () => {
    render(<Header projects={PROJECTS} activeProjectId={PROJECT_A.id} canAdd />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    await userEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'English' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: '日本語' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'English' })),
    );
  });

  it('supports keyboard opening, Tab navigation, Space selection, and focus restoration', async () => {
    render(<Header />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'English' })),
    );

    // Radix moves the focus on a timer, so hold the key until it has landed.
    await userEvent.keyboard('{ArrowRight>}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: '日本語' })),
    );
    await userEvent.keyboard('{/ArrowRight}');
    expect(document.documentElement.lang).toBe('ja');
    expect(window.localStorage.getItem('agboard.locale')).toBe('ja');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '設定' }));
  });

  it('opens with Space on the trigger and closes on Escape with focus on the trigger', async () => {
    render(<Header />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    trigger.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the user clicks the backdrop', async () => {
    render(<Header projects={PROJECTS} activeProjectId={PROJECT_A.id} canAdd />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('still calls onAdd from the add button', async () => {
    const onAdd = vi.fn();
    render(<Header projects={PROJECTS} activeProjectId={PROJECT_A.id} canAdd onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add card' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
