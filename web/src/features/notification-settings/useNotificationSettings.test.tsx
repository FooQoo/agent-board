import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from './model';
import { useNotificationSettings } from './useNotificationSettings';

const saved = (patch: Partial<NotificationSettings>): NotificationSettings => ({
  ...DEFAULT_NOTIFICATION_SETTINGS,
  ...patch,
});

describe('useNotificationSettings', () => {
  it('loads the saved value and keeps a saved choice', async () => {
    const load = vi.fn().mockResolvedValue(DEFAULT_NOTIFICATION_SETTINGS);
    const kinds = { ...DEFAULT_NOTIFICATION_SETTINGS.kinds, history: true };
    const save = vi.fn().mockResolvedValue(saved({ kinds, revision: 5 }));
    const { result } = renderHook(() => useNotificationSettings(load, save));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => result.current.change({ kinds }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ kinds }));
    await waitFor(() => {
      const { state } = result.current;
      expect(state.status === 'ready' && state.settings.revision).toBe(5);
    });
  });

  it('goes back to the saved value and says so when a save fails', async () => {
    const load = vi.fn().mockResolvedValue(DEFAULT_NOTIFICATION_SETTINGS);
    const save = vi.fn().mockRejectedValue(new Error('no'));
    const { result } = renderHook(() => useNotificationSettings(load, save));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    act(() => result.current.change({ periodic: { enabled: true, intervalMinutes: 30 } }));
    await waitFor(() => {
      const { state } = result.current;
      expect(state.status === 'ready' && state.saveFailed).toBe(true);
    });
    const { state } = result.current;
    expect(state.status === 'ready' && state.settings.periodic.enabled).toBe(false);
  });

  it('reports a failed read', async () => {
    const load = vi.fn().mockRejectedValue(new Error('no'));
    const { result } = renderHook(() => useNotificationSettings(load, vi.fn()));
    await waitFor(() => expect(result.current.state.status).toBe('failed'));
  });
});
