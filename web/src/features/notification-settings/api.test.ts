import { describe, expect, it, vi } from 'vitest';
import { loadNotificationSettings, saveNotificationSettings } from './api';
import { DEFAULT_NOTIFICATION_SETTINGS } from './model';

const reply = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('notification settings api', () => {
  it('reads the saved value', async () => {
    const fetcher = reply(DEFAULT_NOTIFICATION_SETTINGS);
    await expect(loadNotificationSettings(fetcher)).resolves.toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/notification-settings');
  });

  it('sends a PUT with the patch as JSON', async () => {
    const fetcher = reply(DEFAULT_NOTIFICATION_SETTINGS);
    const periodic = { enabled: true, intervalMinutes: 30 } as const;
    await saveNotificationSettings({ periodic }, fetcher);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ periodic });
  });

  it('fails on a refusal, a body of another shape, and no answer', async () => {
    await expect(loadNotificationSettings(reply({}, 422))).rejects.toMatchObject({ status: 422 });
    await expect(loadNotificationSettings(reply({ kinds: 1 }))).rejects.toBeTruthy();
    await expect(
      loadNotificationSettings(vi.fn().mockRejectedValue(new Error('offline'))),
    ).rejects.toMatchObject({ status: 0 });
  });
});
