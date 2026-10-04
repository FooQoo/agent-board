import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { Header } from '../../src/components/Header';
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
    render(<Header boardName="simplekanban" />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Language' })).toBeNull();
    expect(document.querySelector('.language-menu, .header__language')).toBeNull();
  });

  it('keeps the Settings button while the board name is unknown (loading or error)', () => {
    render(<Header boardName={null} />);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add card' })).toBeNull();
  });

  it('opens the settings dialog, which holds the language choice', async () => {
    render(<Header boardName="simplekanban" />);
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
    render(<Header boardName={null} />);
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
    expect(window.localStorage.getItem('skan.locale')).toBe('ja');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '設定' }));
  });

  it('opens with Space on the trigger and closes on Escape with focus on the trigger', async () => {
    render(<Header boardName={null} />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    trigger.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the user clicks the backdrop', async () => {
    render(<Header boardName="simplekanban" />);
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
    render(<Header boardName="simplekanban" onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add card' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
