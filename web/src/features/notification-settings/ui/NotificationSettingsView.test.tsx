import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/i18n';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../model';
import { NotificationSettingsView } from './NotificationSettingsView';

afterEach(cleanup);

const ready = {
  status: 'ready',
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  saveFailed: false,
} as const;

describe('NotificationSettingsView', () => {
  it('shows the four kinds with the defaults, the picks, and the periodic choice', () => {
    render(<NotificationSettingsView state={ready} onChange={vi.fn()} />);
    const on = (name: string) =>
      screen.getByRole('checkbox', { name: new RegExp(name) }).getAttribute('aria-checked');
    expect(on('^Results')).toBe('true');
    expect(on('^Questions that need')).toBe('true');
    expect(on('^Card state changes')).toBe('false');
    expect(on('^History additions')).toBe('false');
    expect(screen.getByRole('checkbox', { name: 'Started' }).hasAttribute('disabled')).toBe(true);
    expect(on('^Periodic status')).toBe('false');
    expect(screen.getByRole('radio', { name: '1 hour' }).hasAttribute('disabled')).toBe(true);
  });

  it('sends the whole group when a flag changes', () => {
    const onChange = vi.fn();
    render(<NotificationSettingsView state={ready} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^History additions/ }));
    expect(onChange).toHaveBeenCalledWith({
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, history: true },
    });
  });

  it('lets the state changes and the interval be picked once their switches are on', () => {
    const onChange = vi.fn();
    const settings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, stateChanges: true },
      periodic: { enabled: true, intervalMinutes: 60 as const },
    };
    render(
      <NotificationSettingsView
        state={{ status: 'ready', settings, saveFailed: false }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Started' }));
    expect(onChange).toHaveBeenCalledWith({
      stateChanges: { ...settings.stateChanges, started: false },
    });
    fireEvent.mouseDown(screen.getByRole('radio', { name: '4 hours' }));
    fireEvent.click(screen.getByRole('radio', { name: '4 hours' }));
    expect(onChange).toHaveBeenCalledWith({ periodic: { enabled: true, intervalMinutes: 240 } });
  });

  it('shows a failed read and a failed save as alerts', () => {
    const { rerender } = render(
      <NotificationSettingsView state={{ status: 'failed' }} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not read');
    rerender(
      <NotificationSettingsView state={{ ...ready, saveFailed: true }} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
