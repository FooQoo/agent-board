import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../shared/i18n';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../model';
import { NotificationDialogView } from './NotificationDialogView';

afterEach(cleanup);

const ready = {
  status: 'ready',
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  saveFailed: false,
} as const;

describe('NotificationDialogView', () => {
  it('shows the choices under the dialog title and saves a change at once', () => {
    const onChange = vi.fn();
    render(
      <NotificationDialogView kind="dialog" onClose={vi.fn()} state={ready} onChange={onChange} />,
    );
    expect(screen.getByRole('dialog', { name: 'Phone notifications' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: /^History additions/ }));
    expect(onChange).toHaveBeenCalledWith({
      kinds: { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, history: true },
    });
  });

  it('shows the phone control only when one is given, and closes from the close button', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <NotificationDialogView kind="dialog" onClose={onClose} state={ready} onChange={vi.fn()} />,
    );
    expect(screen.queryByText('Enable control')).toBeNull();
    rerender(
      <NotificationDialogView
        kind="dialog"
        onClose={onClose}
        state={ready}
        onChange={vi.fn()}
        push={<button type="button">Enable control</button>}
      />,
    );
    expect(screen.getByText('Enable control')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
