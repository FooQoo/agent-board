/**
 * The phone notification settings as the server saves them (`/api/notification-settings`). The
 * kinds, defaults, and intervals are defined once on the server (`notification_settings` module);
 * this file mirrors them for the screen.
 */

export const KIND_KEYS = ['results', 'questions', 'stateChanges', 'history'] as const;
export type KindKey = (typeof KIND_KEYS)[number];

export const STATE_CHANGE_KEYS = ['started', 'pending', 'done'] as const;
export type StateChangeKey = (typeof STATE_CHANGE_KEYS)[number];

/** The intervals of the periodic status notification, in minutes. */
export const PERIODIC_INTERVALS = [30, 60, 120, 240] as const;
export type PeriodicInterval = (typeof PERIODIC_INTERVALS)[number];

export interface NotificationSettings {
  kinds: Record<KindKey, boolean>;
  stateChanges: Record<StateChangeKey, boolean>;
  periodic: { enabled: boolean; intervalMinutes: PeriodicInterval };
  revision: number;
}

/** What a save sends: the groups that change, each with all of its fields. */
export type NotificationSettingsPatch = Partial<Omit<NotificationSettings, 'revision'>>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  kinds: { results: true, questions: true, stateChanges: false, history: false },
  stateChanges: { started: true, pending: true, done: true },
  periodic: { enabled: false, intervalMinutes: 60 },
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
  const stateChanges = flags(value.stateChanges, STATE_CHANGE_KEYS);
  const { periodic, revision } = value;
  if (!kinds || !stateChanges || !isRecord(periodic)) return null;
  const { enabled, intervalMinutes } = periodic;
  if (typeof enabled !== 'boolean') return null;
  const interval = PERIODIC_INTERVALS.find((minutes) => minutes === intervalMinutes);
  if (interval === undefined) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  return { kinds, stateChanges, periodic: { enabled, intervalMinutes: interval }, revision };
}
