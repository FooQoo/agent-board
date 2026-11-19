import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_SETTINGS, parseNotificationSettings } from './model';

describe('parseNotificationSettings', () => {
  it('accepts the shape the server sends, and the defaults', () => {
    expect(parseNotificationSettings(DEFAULT_NOTIFICATION_SETTINGS)).toEqual(
      DEFAULT_NOTIFICATION_SETTINGS,
    );
  });

  it('has the defaults results on, questions on, history off', () => {
    const { kinds } = DEFAULT_NOTIFICATION_SETTINGS;
    expect(kinds).toEqual({
      results: true,
      questions: true,
      history: false,
    });
  });

  it('rejects a missing flag and a bad revision', () => {
    const base = DEFAULT_NOTIFICATION_SETTINGS;
    expect(parseNotificationSettings(null)).toBeNull();
    expect(parseNotificationSettings({ ...base, kinds: { results: true } })).toBeNull();
    expect(parseNotificationSettings({ ...base, revision: -1 })).toBeNull();
  });

  it('ignores the removed groups an older server may still send', () => {
    const old = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      stateChanges: { started: true, pending: true, done: true },
      periodic: { enabled: true, intervalMinutes: 60 },
    };
    expect(parseNotificationSettings(old)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });
});
