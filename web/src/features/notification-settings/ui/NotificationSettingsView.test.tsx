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
  it('shows the three kinds with their defaults', () => {
    render(<NotificationSettingsView state={ready} onChange={vi.fn()} />);
    const on = (name: string) =>
      screen.getByRole('checkbox', { name: new RegExp(name) }).getAttribute('aria-checked');
    expect(on('^Results')).toBe('true');
    expect(on('^Questions that need')).toBe('false');
    expect(on('^History additions')).toBe('false');
  });

  it('sends the whole group when a flag changes', () => {
    const onChange = vi.fn();
    render(<NotificationSettingsView state={ready} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /^History additions/ }));
    expect(onChange).toHaveBeenCalledWith({
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, history: true },
    });
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
