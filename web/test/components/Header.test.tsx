import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectLocale } from '../../src/i18n';
import { Header } from '../../src/components/Header';

describe('language selector', () => {
  beforeEach(() => {
    window.localStorage.clear();
    selectLocale('en');
  });

  afterEach(() => {
    cleanup();
    selectLocale('en');
    window.localStorage.clear();
  });

  it('opens from the globe, exposes the selection, and focuses the current language', async () => {
    render(<Header boardName="simplekanban" />);

    const trigger = screen.getByRole('button', { name: 'Language' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('group', { name: 'Language' });
    expect(group.querySelector('[role="menu"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: '日本語' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'English' })),
    );
  });

  it('supports keyboard opening, Tab navigation, Space selection, and focus restoration', async () => {
    render(<Header boardName={null} />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'English' })),
    );

    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '日本語' }));
    await userEvent.keyboard(' ');

    expect(document.documentElement.lang).toBe('ja');
    expect(window.localStorage.getItem('skan.locale')).toBe('ja');
    expect(screen.getByRole('button', { name: '表示言語' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '表示言語' }));
  });

  it('opens and closes the language selector with Space on the trigger', async () => {
    render(<Header boardName={null} />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    trigger.focus();
    await userEvent.keyboard(' ');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'English' })),
    );

    trigger.focus();
    await userEvent.keyboard(' ');
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    render(<Header boardName={null} />);
    const trigger = screen.getByRole('button', { name: 'Language' });
    await userEvent.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'English' })),
    );
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the user clicks outside the language selector', async () => {
    render(<Header boardName="simplekanban" />);
    await userEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();

    await userEvent.click(document.body);

    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Language' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
});
