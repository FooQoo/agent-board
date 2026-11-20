/**
 * The phone notification settings as the server saves them (`/api/notification-settings`). The
 * kinds and defaults are defined once on the server (`notification_settings` module);
 * this file mirrors them for the screen. The removed periodic and state-change groups that an older
 * server may still send are ignored.
 */

export const KIND_KEYS = ['results', 'questions', 'history', 'summary'] as const;
export type KindKey = (typeof KIND_KEYS)[number];

/** The minutes between periodic summaries; 0 records none. */
export const SUMMARY_INTERVALS = [0, 30, 60, 120, 240] as const;
export type SummaryInterval = (typeof SUMMARY_INTERVALS)[number];

export interface NotificationSettings {
  kinds: Record<KindKey, boolean>;
  summary: { intervalMinutes: SummaryInterval };
  revision: number;
}

/** What a save sends: the groups that change, each with all of its fields. */
export type NotificationSettingsPatch = Partial<Omit<NotificationSettings, 'revision'>>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  kinds: { results: true, questions: false, history: false, summary: true },
  summary: { intervalMinutes: 60 },
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
  const interval = isRecord(value.summary) ? value.summary.intervalMinutes : undefined;
  const intervalMinutes = SUMMARY_INTERVALS.find((minutes) => minutes === interval);
  if (intervalMinutes === undefined) return null;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return null;
  return { kinds, summary: { intervalMinutes }, revision };
}
