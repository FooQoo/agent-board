import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_SETTINGS, parseNotificationSettings } from './model';

describe('parseNotificationSettings', () => {
  it('accepts the shape the server sends, and the defaults', () => {
    expect(parseNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });

  it('has the defaults results on, questions on, state changes off, history off', () => {
    const { kinds, periodic } = DEFAULT_NOTIFICATION_SETTINGS;
    expect(kinds).toEqual({
      results: true,
      questions: true,
      stateChanges: false,
      history: false,
    });
    expect(periodic).toEqual({ enabled: false, intervalMinutes: 60 });
  });

  it('rejects a missing flag, an interval that is not offered, and a bad revision', () => {
    const base = DEFAULT_NOTIFICATION_SETTINGS;
    expect(parseNotificationSettings(null)).toBeNull();
    expect(parseNotificationSettings({ ...base, kinds: { results: true } })).toBeNull();
    expect(
      parseNotificationSettings({ ...base, periodic: { enabled: true, intervalMinutes: 45 } }),
    ).toBeNull();
    expect(parseNotificationSettings({ ...base, revision: -1 })).toBeNull();
  });
});
