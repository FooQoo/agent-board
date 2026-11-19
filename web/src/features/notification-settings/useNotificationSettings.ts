import { useCallback, useEffect, useRef, useState } from 'react';
import { loadNotificationSettings, saveNotificationSettings } from './api';
import type { NotificationSettings, NotificationSettingsPatch } from './model';

export type NotificationSettingsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; settings: NotificationSettings; saveFailed: boolean };

/**
 * Reads the saved settings when the section appears, and saves each change. A change is shown at
 * once; saves go out one at a time in the order they were made, and a failed save goes back to
 * the last saved value and says so.
 */
export function useNotificationSettings(
  load: () => Promise<NotificationSettings> = loadNotificationSettings,
  save: (patch: NotificationSettingsPatch) => Promise<NotificationSettings> = (patch) =>
    saveNotificationSettings(patch),
) {
  const [state, setState] = useState<NotificationSettingsState>({ status: 'loading' });
  const saved = useRef<NotificationSettings | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    load().then(
      (settings) => {
        if (!alive.current) return;
        saved.current = settings;
        setState({ status: 'ready', settings, saveFailed: false });
      },
      () => alive.current && setState({ status: 'failed' }),
    );
    return () => {
      alive.current = false;
    };
  }, [load]);

  const change = useCallback(
    (patch: NotificationSettingsPatch) => {
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', settings: { ...current.settings, ...patch }, saveFailed: false }
          : current,
      );
      pending.current += 1;
      queue.current = queue.current.then(() =>
        save(patch).then(
          (settings) => {
            pending.current -= 1;
            saved.current = settings;
            if (alive.current && pending.current === 0) {
              setState({ status: 'ready', settings, saveFailed: false });
            }
          },
          () => {
            pending.current -= 1;
            const last = saved.current;
            if (alive.current && last && pending.current === 0) {
              setState({ status: 'ready', settings: last, saveFailed: true });
            }
          },
        ),
      );
    },
    [save],
  );

  return { state, change };
}
