import { useCallback, useEffect, useState } from 'react';
import { getPushStatus } from './api';
import {
  pushView,
  readSupport,
  type PushPermission,
  type PushStatus,
  type PushSupport,
  type PushView,
} from './state';
import { disablePush, enablePush, hasBrowserSubscription } from './subscribe';

export interface PushController {
  view: PushView;
  support: PushSupport;
  busy: boolean;
  /** The last turn-on or turn-off failed. */
  failed: boolean;
  enable: () => void;
  disable: () => void;
}

function readPermission(): PushPermission {
  return 'Notification' in window ? Notification.permission : 'default';
}

/** The notification row's state, read from the browser and the PC, with its two actions. */
export function usePushNotifications(): PushController {
  const [support] = useState(readSupport);
  const [permission, setPermission] = useState<PushPermission>(readPermission);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getPushStatus();
      // A subscription kept on the PC is only useful while the browser still holds its own.
      const held = next.subscribed === true ? await hasBrowserSubscription() : false;
      setStatus({ ...next, subscribed: held });
      setPublicKey(next.publicKey ?? null);
    } catch {
      setStatus(null);
    }
    setPermission(readPermission());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(() => {
    if (publicKey === null || busy) return;
    setBusy(true);
    setFailed(false);
    void enablePush(publicKey).then(async (result) => {
      setFailed(result === 'failed');
      await refresh();
      setBusy(false);
    });
  }, [publicKey, busy, refresh]);

  const disable = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    void disablePush().then(async (done) => {
      setFailed(!done);
      await refresh();
      setBusy(false);
    });
  }, [busy, refresh]);

  return {
    view: pushView(support, permission, status),
    support,
    busy,
    failed,
    enable,
    disable,
  };
}
