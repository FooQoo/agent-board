/**
 * The phone notification settings as the server saves them (`/api/notification-settings`). The
 * kinds and defaults are defined once on the server (`notification_settings` module);
 * this file mirrors them for the screen. The removed periodic and state-change groups that an older
 * server may still send are ignored.
 */

export const KIND_KEYS = ['results', 'questions', 'history'] as const;
export type KindKey = (typeof KIND_KEYS)[number];

export interface NotificationSettings {
  kinds: Record<KindKey, boolean>;
  revision: number;
}

/** What a save sends: the groups that change, each with all of its fields. */
export type NotificationSettingsPatch = Partial<Omit<NotificationSettings, 'revision'>>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  kinds: { results: true, questions: false, history: false },
  revision: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function flags<K extends string>(value: unknown, keys: readonly K[]): Record<K, boolean> | null {
  if (!isRecord(value)) return null;
  const result = {} as Record<K, boolean>;
  for (const key of keys) {
    const flag = value[key];
    if (typeof flag !== 'boolean') return null;
    result[key] = flag;
  }
  return result;
}

/** Checks the shape the server sends. Anything else is null, never a partial value. */
export function parseNotificationSettings(value: unknown): NotificationSettings | null {
  if (!isRecord(value)) return null;
  const kinds = flags(value.kinds, KIND_KEYS);
  const { revision } = value;
  if (!kinds) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  return { kinds, revision };
}
